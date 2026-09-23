/**
 * Verify / install Microsoft Visual C++ 2015 x64 redistributable on Windows endpoints.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const VM = require('../models/VM');
const Job = require('../models/Job');
const agentProbe = require('./agentProbe');
const registrySoftware = require('./registrySoftware');
const deployInstall = require('./deployInstall');
const deployConfig = require('../config/deployConfig');
const vcRedistConfig = require('../config/vcRedistConfig');
const activityLog = require('./activityLog');
const audit = require('../utils/audit');
const { runPool } = require('../utils/pool');
const { runWmiPowershell } = require('../utils/wmiExec');
const { toVmPlain } = require('../utils/vmPlain');
const { isAgentRemoved } = require('../utils/agentStatus');
const { sanitizeErrorMessage } = require('../utils/wmiCredentials');
const wmiConfig = require('../config/wmi');
const logger = require('../utils/logger');

/** Display names for VC++ 2015 runtime (x64). Includes 2015–2022 bundle. */
const VC_REDIST_2015_X64_NAME = /Microsoft Visual C\+\+ (2015|2015-2017|2015-2019|2015-2022) Redistributable \(x64\)/i;

let fleetInFlight = false;

function isVcRedist2015X64Installed(programs) {
  if (!Array.isArray(programs)) return false;
  return programs.some((p) => {
    const name = String(p.displayName || p.name || '');
    if (!VC_REDIST_2015_X64_NAME.test(name)) return false;
    if (p.architecture === 'x86') return false;
    return true;
  });
}

function findVcRedist2015X64(programs) {
  if (!Array.isArray(programs)) return null;
  return programs.find((p) => {
    const name = String(p.displayName || p.name || '');
    return VC_REDIST_2015_X64_NAME.test(name) && p.architecture !== 'x86';
  }) || null;
}

function loadLocalInstaller() {
  const p = vcRedistConfig.localInstallerPath;
  if (!p || !fs.existsSync(p)) return null;
  const buffer = fs.readFileSync(p);
  const fileName = path.basename(p);
  return {
    fileName,
    buffer,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    packageType: 'exe',
  };
}

function buildDownloadInstallScript(downloadUrl) {
  const url = String(downloadUrl).replace(/'/g, "''");
  const args = vcRedistConfig.installArgs.replace(/'/g, "''");
  return [
    '$ErrorActionPreference = "Stop"',
    `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12`,
    `$url = '${url}'`,
    '$dest = Join-Path $env:TEMP "vc_redist.x64.exe"',
    'Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing',
    'if (-not (Test-Path $dest)) { throw "VC++ redistributable download failed" }',
    `$args = '${args}'`,
    '$p = Start-Process -FilePath $dest -ArgumentList $args -Wait -PassThru',
    'if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) { throw ("VC++ installer exit code " + $p.ExitCode) }',
    'Write-Output "VC_REDIST:OK"',
  ].join('\n');
}

async function runInstallScript(session, script, timeoutMs) {
  const r = await runWmiPowershell(
    session.host,
    session.username,
    session.password,
    script,
    session.domain || null,
    timeoutMs,
  );
  if (r.stderr && /access is denied|logon failure/i.test(r.stderr)) {
    throw new Error('Authentication failed');
  }
  if (!/VC_REDIST:OK/.test(r.stdout || '')) {
    const hint = (r.stderr || r.stdout || '').trim().slice(0, 400);
    throw new Error(hint || 'VC++ install did not complete successfully');
  }
}

async function installVcRedist(session, jobId, onLog) {
  const local = loadLocalInstaller();
  if (local) {
    onLog?.('transferring', 'Using bundled vc_redist.x64.exe from manager');
    const remoteFile = await deployInstall.transferPackage(
      session,
      jobId,
      local,
      local.buffer,
      (step, msg) => onLog?.(step, msg),
    );
    const ext = path.extname(local.fileName).toLowerCase();
    const args = vcRedistConfig.installArgs;
    if (ext === '.msi') {
      await deployInstall.runInstaller(session, remoteFile, local, args, (s, m) => onLog?.(s, m));
    } else {
      const cmd = `"${remoteFile}" ${args}`.trim();
      const script = [
        '$ErrorActionPreference="Stop"',
        `Start-Process cmd.exe -ArgumentList '/c ${cmd.replace(/'/g, "''")}' -Wait -WindowStyle Hidden`,
        'Write-Output "VC_REDIST:OK"',
      ].join('\n');
      await runInstallScript(session, script, deployConfig.endpointTimeoutMs);
    }
    return;
  }

  onLog?.('installing', `Downloading and installing from ${vcRedistConfig.installUrl}`);
  await runInstallScript(
    session,
    buildDownloadInstallScript(vcRedistConfig.installUrl),
    deployConfig.endpointTimeoutMs,
  );
}

async function updateVmVcRedistFields(vmId, { status, version }) {
  await VM.findByIdAndUpdate(vmId, {
    $set: {
      vcRedist2015X64: {
        status,
        version: version || '',
        checkedAt: new Date(),
      },
    },
  });
}

async function ensureOnEndpoint(vm, options = {}) {
  const { install = true, jobId = `vcredist-${Date.now()}` } = options;
  const plain = toVmPlain(vm);

  if (vm.excluded) {
    return { ok: true, skipped: true, status: 'skipped', message: 'Excluded' };
  }
  if (!options.allowRemoved && isAgentRemoved(plain)) {
    return { ok: true, skipped: true, status: 'skipped', message: 'Agent removed (skipped)' };
  }

  let session;
  try {
    session = await deployInstall.sessionFromVm(vm);
  } catch (err) {
    return { ok: false, status: 'failed', message: sanitizeErrorMessage(err.message) };
  }

  try {
    const { programs } = await registrySoftware.fetchInstalledPrograms(
      session,
      deployConfig.stepTimeoutMs,
    );
    const existing = findVcRedist2015X64(programs);
    if (existing) {
      await updateVmVcRedistFields(vm._id, { status: 'installed', version: existing.version });
      return {
        ok: true,
        skipped: true,
        status: 'installed',
        version: existing.version,
        message: 'Already installed',
      };
    }

    if (!install) {
      await updateVmVcRedistFields(vm._id, { status: 'missing', version: '' });
      return { ok: true, status: 'missing', message: 'Not installed (verify-only)' };
    }

    await installVcRedist(session, jobId, () => {});

    const after = await registrySoftware.fetchInstalledPrograms(session, deployConfig.stepTimeoutMs);
    if (!isVcRedist2015X64Installed(after.programs)) {
      await updateVmVcRedistFields(vm._id, { status: 'failed', version: '' });
      return { ok: false, status: 'failed', message: 'Install finished but VC++ 2015 x64 not found in registry' };
    }
    const prog = findVcRedist2015X64(after.programs);
    await updateVmVcRedistFields(vm._id, { status: 'installed', version: prog?.version || '' });
    return {
      ok: true,
      status: 'installed',
      version: prog?.version || '',
      message: 'Installed successfully',
    };
  } catch (err) {
    await updateVmVcRedistFields(vm._id, { status: 'failed', version: '' });
    return { ok: false, status: 'failed', message: sanitizeErrorMessage(err.message) };
  }
}

function createJobLogger(jobId, io) {
  const log = async (level, message, vm = '') => {
    const entry = { timestamp: new Date(), level, message, vm };
    io?.emit('log:new', { jobId, entry });
    await Job.findByIdAndUpdate(jobId, { $push: { logs: entry } });
  };
  const progress = async (progressPct, statistics) => {
    io?.emit('job:progress', { jobId, progress: progressPct, statistics });
    await Job.findByIdAndUpdate(jobId, { $set: { progress: progressPct, statistics } });
  };
  return { log, progress };
}

async function resolveTargetVms({ endpointIds, onlineOnly }) {
  const query = { excluded: false, osType: 'windows' };
  if (onlineOnly) query.status = 'online';
  if (Array.isArray(endpointIds) && endpointIds.length) {
    query._id = { $in: endpointIds };
  }
  return VM.find(query).select('+wmiPassword');
}

async function runFleetEnsure(io, options = {}) {
  const {
    install = true,
    onlineOnly = false,
    endpointIds,
    actor = 'system',
    reason = 'manual',
  } = options;

  if (fleetInFlight) {
    return { alreadyRunning: true };
  }
  fleetInFlight = true;

  const vms = await resolveTargetVms({ endpointIds, onlineOnly });
  const job = await Job.create({
    name: `VC++ 2015 x64 ${install ? 'install' : 'verify'} — ${new Date().toLocaleString()}`,
    type: 'vcredist_2015',
    status: 'running',
    startedAt: new Date(),
    vms: vms.map((v) => v._id),
    config: { options: { install, onlineOnly, reason } },
    statistics: { total: vms.length, success: 0, failed: 0, skipped: 0 },
    progress: 0,
  });

  const jobId = job._id.toString();
  const jobLogger = createJobLogger(jobId, io);
  io?.emit('job:started', { jobId, status: 'running', progress: 0, statistics: job.statistics });

  const stats = { total: vms.length, success: 0, failed: 0, skipped: 0 };
  let done = 0;

  await jobLogger.log(
    'info',
    `${install ? 'Installing' : 'Verifying'} VC++ 2015 x64 on ${vms.length} endpoint(s) (concurrency ${vcRedistConfig.concurrency})`,
  );

  try {
    await runPool(vms, vcRedistConfig.concurrency, async (vm) => {
      const result = await ensureOnEndpoint(vm, { install, jobId });
      if (result.skipped && result.status === 'installed') {
        stats.skipped++;
        await jobLogger.log('info', `Already installed${result.version ? ` (${result.version})` : ''}`, vm.name);
      } else if (result.ok && result.status === 'missing') {
        stats.skipped++;
        await jobLogger.log('warning', 'Missing (verify-only)', vm.name);
      } else if (result.ok) {
        stats.success++;
        await jobLogger.log('success', result.message || 'OK', vm.name);
      } else {
        stats.failed++;
        await jobLogger.log('error', result.message || 'Failed', vm.name);
      }
      done++;
      await jobLogger.progress(stats.total ? Math.round((done / stats.total) * 100) : 100, stats);
    });

    const finalStatus = stats.failed > 0 && stats.success === 0 && stats.skipped === 0
      ? 'failed'
      : 'completed';

    await Job.findByIdAndUpdate(jobId, {
      $set: {
        status: finalStatus,
        progress: 100,
        statistics: stats,
        completedAt: new Date(),
      },
    });

    await audit.log({
      action: 'system.vcredist_2015',
      status: finalStatus === 'failed' ? 'failed' : 'success',
      actor,
      message: `VC++ 2015 x64 fleet ${install ? 'install' : 'verify'}: ✓${stats.success} ✗${stats.failed} ⊘${stats.skipped}`,
      meta: stats,
    }, io);

    await activityLog.write({
      category: 'system',
      level: finalStatus === 'failed' ? 'error' : 'success',
      message: `VC++ 2015 x64: ✓${stats.success} installed/verified, ✗${stats.failed} failed, ⊘${stats.skipped} skipped`,
      jobId: job._id,
      meta: stats,
    }, io);

    io?.emit('job:completed', { jobId, status: finalStatus, progress: 100, statistics: stats });
    return { job, statistics: stats, status: finalStatus };
  } catch (err) {
    logger.error(`VC++ 2015 fleet job failed: ${err.message}`);
    await Job.findByIdAndUpdate(jobId, {
      $set: { status: 'failed', completedAt: new Date() },
    });
    throw err;
  } finally {
    fleetInFlight = false;
  }
}

function queueFleetEnsure(io, options = {}) {
  setImmediate(() => {
    runFleetEnsure(io, options).catch((err) => {
      logger.error(`VC++ 2015 fleet ensure: ${err.message}`);
      fleetInFlight = false;
    });
  });
}

module.exports = {
  isVcRedist2015X64Installed,
  findVcRedist2015X64,
  ensureOnEndpoint,
  runFleetEnsure,
  queueFleetEnsure,
  VC_REDIST_2015_X64_NAME,
};
