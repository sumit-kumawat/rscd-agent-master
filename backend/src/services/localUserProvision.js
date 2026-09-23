/**
 * Login-triggered local user provisioning across managed Windows VMs.
 */
const VM = require('../models/VM');
const Job = require('../models/Job');
const agentProbe = require('./agentProbe');
const activityLog = require('./activityLog');
const { parseProvisionUsers } = require('../config/localUsers');
const { runWmiPowershell } = require('../utils/wmiExec');
const { runPool } = require('../utils/pool');
const { toVmPlain } = require('../utils/vmPlain');
const { isAgentRemoved } = require('../utils/agentStatus');
const { sanitizeErrorMessage } = require('../utils/wmiCredentials');
const wmiConfig = require('../config/wmi');
const logger = require('../utils/logger');
const audit = require('../utils/audit');
const endpointOps = require('./endpointOps');

const CONCURRENCY = parseInt(process.env.PROVISION_CONCURRENCY || '5', 10);
const ENABLED = process.env.PROVISION_ON_LOGIN !== 'false';
const DEBOUNCE_MS = parseInt(process.env.PROVISION_LOGIN_DEBOUNCE_MS || '30000', 10);

let inFlight = false;
let lastTriggeredAt = 0;

function psEscape(str) {
  return String(str || '').replace(/'/g, "''");
}

function buildProvisionScript(users) {
  const lines = [
    '$ErrorActionPreference = "Continue"',
    '$out = @()',
  ];

  for (const u of users) {
    const isAdmin = u.username.toLowerCase() === 'administrator';
    const winName = isAdmin ? 'Administrator' : u.username;
    const name = psEscape(winName);
    const pass = psEscape(u.password);
    const group = psEscape(u.group || 'Administrators');

    if (isAdmin) {
      lines.push(`
try {
  $n = 'Administrator'
  $grp = '${group}'
  $adm = Get-LocalUser -Name $n -ErrorAction SilentlyContinue
  if ($adm -and -not $adm.Enabled) {
    Enable-LocalUser -Name $n -ErrorAction Stop
    $out += "$n:ENABLED"
  } elseif ($adm) {
    $out += "$n:EXISTS"
  }
  $sec = ConvertTo-SecureString '${pass}' -AsPlainText -Force
  Set-LocalUser -Name $n -Password $sec -ErrorAction Stop
  $members = Get-LocalGroupMember -Group $grp -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "*\\$n" }
  if (-not $members) {
    Add-LocalGroupMember -Group $grp -Member $n -ErrorAction Stop
    $out += "$n:ADDED_TO_GROUP"
  }
} catch {
  $out += "Administrator:FAILED:$($_.Exception.Message)"
}
`);
      continue;
    }

    lines.push(`
try {
  $n = '${name}'
  $grp = '${group}'
  $existing = Get-LocalUser -Name $n -ErrorAction SilentlyContinue
  if ($existing) {
    $out += "$n:EXISTS"
  } else {
    $sec = ConvertTo-SecureString '${pass}' -AsPlainText -Force
    New-LocalUser -Name $n -Password $sec -FullName $n -PasswordNeverExpires -ErrorAction Stop | Out-Null
    $out += "$n:CREATED"
  }
  $members = Get-LocalGroupMember -Group $grp -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "*\\$n" -or $_.Name -eq $n }
  if (-not $members) {
    Add-LocalGroupMember -Group $grp -Member $n -ErrorAction Stop
    $out += "$n:ADDED_TO_GROUP"
  }
} catch {
  $out += "$n:FAILED:$($_.Exception.Message)"
}
`);
  }

  lines.push('$out | ForEach-Object { Write-Output $_ }');
  return lines.join('\n');
}

function parseProvisionOutput(stdout) {
  const results = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || !t.includes(':')) continue;
    const idx = t.indexOf(':');
    const user = t.slice(0, idx);
    const status = t.slice(idx + 1);
    results.push({ user, status });
  }
  return results;
}

function summarizeResults(parsed) {
  const summary = { created: [], exists: [], failed: [] };
  for (const row of parsed) {
    if (/^FAILED/i.test(row.status) || /FAILED/i.test(row.status)) {
      summary.failed.push(row);
    } else if (row.status === 'EXISTS' || row.status === 'ADDED_TO_GROUP') {
      summary.exists.push(row);
    } else if (row.status === 'CREATED' || row.status === 'ENABLED') {
      summary.created.push(row);
    } else {
      summary.exists.push(row);
    }
  }
  return summary;
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

async function provisionVm(vm, users, jobLogger, passwords, options = {}) {
  const plain = toVmPlain(vm);
  if (vm.excluded) {
    await jobLogger.log('info', 'Skipped — excluded', plain.name);
    return { ok: true, skipped: true };
  }
  if (!options.allowRemoved && isAgentRemoved(plain)) {
    await jobLogger.log('info', 'Skipped — agent removed', plain.name);
    return { ok: true, skipped: true };
  }

  let session;
  try {
    session = await agentProbe.connectWmi(plain);
  } catch (err) {
    const msg = sanitizeErrorMessage(err.message, passwords);
    await jobLogger.log('error', `WMI connect failed: ${msg}`, plain.name);
    return { ok: false, error: msg };
  }

  const script = buildProvisionScript(users);
  try {
    const r = await runWmiPowershell(
      session.host,
      session.username,
      session.password,
      script,
      session.domain || null,
      wmiConfig.queryTimeoutMs * 2,
    );
    const parsed = parseProvisionOutput(r.stdout);
    const summary = summarizeResults(parsed);

    for (const row of summary.created) {
      await jobLogger.log('success', `User ${row.user}: ${row.status}`, plain.name);
    }
    for (const row of summary.exists) {
      await jobLogger.log('info', `User ${row.user}: already exists`, plain.name);
    }
    for (const row of summary.failed) {
      const msg = sanitizeErrorMessage(row.status, passwords);
      await jobLogger.log('error', `User ${row.user}: ${msg}`, plain.name);
    }

    if (!parsed.length) {
      await jobLogger.log('warning', 'No provision output returned from host', plain.name);
      return { ok: false, error: 'empty output' };
    }

    const failed = summary.failed.length > 0;
    await audit.log({
      action: 'provision.users',
      status: failed ? 'failed' : 'success',
      vmId: vm._id,
      vmName: plain.name,
      message: `Provision ${plain.name}: ${summary.created.length} created, ${summary.exists.length} existed, ${summary.failed.length} failed`,
      meta: {
        created: summary.created.map((x) => x.user),
        exists: summary.exists.map((x) => x.user),
        failed: summary.failed.map((x) => x.user),
      },
    }, null);
    try {
      const lu = await endpointOps.fetchLocalUsers(vm);
      await VM.findByIdAndUpdate(vm._id, { localUsers: { ...lu, checkedAt: new Date() } });
    } catch { /* cache update optional */ }

    return { ok: !failed, failed };
  } catch (err) {
    const msg = sanitizeErrorMessage(err.message, passwords);
    await jobLogger.log('error', `Provision script failed: ${msg}`, plain.name);
    await activityLog.write({
      category: 'provision',
      level: 'error',
      message: `Provision failed on ${plain.name}: ${msg}`,
      vmId: vm._id,
      vmName: plain.name,
    });
    return { ok: false, error: msg };
  }
}

async function runProvision(io, options = {}) {
  if (!ENABLED) {
    logger.debug('Login provisioning disabled (PROVISION_ON_LOGIN=false)');
    return null;
  }

  const now = Date.now();
  if (inFlight) {
    logger.debug('Provision already running — skipping duplicate trigger');
    return null;
  }
  if (!options.force && now - lastTriggeredAt < DEBOUNCE_MS) {
    logger.debug('Provision debounced — recent run');
    return null;
  }

  inFlight = true;
  lastTriggeredAt = now;

  const users = parseProvisionUsers();
  const passwords = users.map((u) => u.password);

  const vms = await VM.find({
    excluded: false,
    osType: { $in: ['windows', null] },
  }).select('+wmiPassword');

  const job = await Job.create({
    name: `Local user provisioning — ${new Date().toLocaleString()}`,
    status: 'running',
    startedAt: new Date(),
    vms: vms.map((v) => v._id),
    config: { type: 'provision', trigger: options.reason || 'login' },
    statistics: { total: vms.length, success: 0, failed: 0, skipped: 0 },
    progress: 0,
  });

  const jobId = job._id.toString();
  const jobLogger = createJobLogger(jobId, io);
  io?.emit('job:started', { jobId, status: 'running', progress: 0, statistics: job.statistics });

  await jobLogger.log('info', `Provisioning ${users.length} local user(s) on ${vms.length} endpoint(s) (concurrency ${CONCURRENCY})`);
  await activityLog.write({
    category: 'provision',
    level: 'info',
    message: `Login provisioning started for ${vms.length} VM(s)`,
    jobId: job._id,
    meta: { users: users.map((u) => u.username), total: vms.length },
  }, io);

  const stats = { total: vms.length, success: 0, failed: 0, skipped: 0 };
  let done = 0;

  try {
    await runPool(vms, CONCURRENCY, async (vm) => {
      const result = await provisionVm(vm, users, jobLogger, passwords);
      if (result.skipped) stats.skipped++;
      else if (result.ok) stats.success++;
      else stats.failed++;
      done++;
      const progress = stats.total ? Math.round((done / stats.total) * 100) : 100;
      await jobLogger.progress(progress, stats);
    });

    const finalStatus = stats.failed > 0 && stats.success === 0 ? 'failed' : 'completed';
    await Job.findByIdAndUpdate(jobId, {
      $set: {
        status: finalStatus,
        progress: 100,
        statistics: stats,
        completedAt: new Date(),
      },
    });

    await jobLogger.log(
      finalStatus === 'failed' ? 'error' : 'success',
      `Provisioning complete — ✓${stats.success} ✗${stats.failed} ⊘${stats.skipped}`,
    );

    io?.emit('job:completed', { jobId, status: finalStatus, progress: 100, statistics: stats });
    await activityLog.write({
      category: 'provision',
      level: finalStatus === 'failed' ? 'error' : 'success',
      message: `Login provisioning ${finalStatus}: ✓${stats.success} ✗${stats.failed} ⊘${stats.skipped}`,
      jobId: job._id,
      meta: stats,
    }, io);

    if (options.reason !== 'login') {
      const endpointReadiness = require('./endpointReadiness');
      endpointReadiness.queueFleetReadiness(io, {
        reason: 'post-provision',
        onlineOnly: true,
        remediateUsers: false,
        remediateVc: true,
        actor: options.actor,
      });
    }

    return job;
  } finally {
    inFlight = false;
  }
}

function queueProvisionOnLogin(io, options = {}) {
  setImmediate(() => {
    runProvision(io, { ...options, reason: 'login' }).catch((err) => {
      logger.error(`Login provisioning failed: ${err.message}`);
      inFlight = false;
    });
  });
}

module.exports = {
  runProvision,
  queueProvisionOnLogin,
  buildProvisionScript,
  provisionVm,
};
