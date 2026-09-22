const path = require('path');
const { runWmiPowershell } = require('../utils/wmiExec');
const agentProbe = require('./agentProbe');
const { vmPlain } = require('../utils/remoteCredential');
const registrySoftware = require('./registrySoftware');
const deployConfig = require('../config/deployConfig');
const packageStore = require('./packageStore');

async function sessionFromVm(vm) {
  return agentProbe.connectWmi(vmPlain(vm));
}

async function wmiPs(session, script, timeoutMs) {
  const r = await runWmiPowershell(
    session.host, session.username, session.password, script, session.domain, timeoutMs,
  );
  if (r.stderr && /access is denied|logon failure/i.test(r.stderr)) {
    throw new Error('Authentication failed');
  }
  return r.stdout || '';
}

async function transferPackage(session, jobId, pkg, buffer, onLog) {
  const staging = `${deployConfig.stagingPath}\\${jobId}`;
  const remoteFile = `${staging}\\${pkg.fileName}`;
  onLog('transferring', `Staging to ${remoteFile}`);
  const b64 = buffer.toString('base64');
  const chunkSize = 48000;
  const chunks = [];
  for (let i = 0; i < b64.length; i += chunkSize) chunks.push(b64.slice(i, i + chunkSize));

  const initScript = [
    '$ErrorActionPreference="Stop"',
    `$dir="${staging.replace(/\\/g, '\\\\')}"`,
    'New-Item -ItemType Directory -Force -Path $dir | Out-Null',
    `$path="${remoteFile.replace(/\\/g, '\\\\')}"`,
    'if(Test-Path $path){ Remove-Item $path -Force }',
    'Set-Content -Path $path -Value "" -Encoding Byte',
  ].join('\n');
  await wmiPs(session, initScript, deployConfig.stepTimeoutMs);

  for (let i = 0; i < chunks.length; i += 1) {
    const part = chunks[i].replace(/'/g, "''");
    const appendScript = [
      '$ErrorActionPreference="Stop"',
      `$path="${remoteFile.replace(/\\/g, '\\\\')}"`,
      `$bytes=[Convert]::FromBase64String('${part}')`,
      '$fs=[IO.File]::Open($path,[IO.FileMode]::Append,[IO.FileAccess]::Write,[IO.FileShare]::None)',
      '$fs.Write($bytes,0,$bytes.Length); $fs.Close()',
    ].join('\n');
    await wmiPs(session, appendScript, deployConfig.stepTimeoutMs);
  }

  const verifyScript = [
    '$ErrorActionPreference="Stop"',
    `$path="${remoteFile.replace(/\\/g, '\\\\')}"`,
    'if(-not (Test-Path $path)){ throw "Staged file missing" }',
    `$hash=(Get-FileHash -Path $path -Algorithm SHA256).Hash.ToLower()`,
    `if($hash -ne "${pkg.sha256.toLowerCase()}"){ throw "SHA256 mismatch" }`,
    'Write-Output "OK"',
  ].join('\n');
  const out = await wmiPs(session, verifyScript, deployConfig.stepTimeoutMs);
  if (!/OK/.test(out)) throw new Error('Remote SHA-256 verification failed');
  onLog('verifying', 'Remote checksum verified');
  return remoteFile;
}

async function runInstaller(session, remoteFile, pkg, args, onLog) {
  const ext = path.extname(pkg.fileName).toLowerCase();
  let cmd;
  if (ext === '.msi') {
    const msiArgs = args || '/qn /norestart';
    cmd = `msiexec.exe /i "${remoteFile}" ${msiArgs}`;
  } else {
    const exeArgs = args || '';
    cmd = `"${remoteFile}" ${exeArgs}`.trim();
  }
  onLog('installing', `Executing installer`);
  const script = [
    '$ErrorActionPreference="SilentlyContinue"',
    `Start-Process cmd.exe -ArgumentList '/c ${cmd.replace(/'/g, "''")}' -Wait -WindowStyle Hidden`,
    'Write-Output "EXIT:0"',
  ].join('\n');
  await wmiPs(session, script, deployConfig.endpointTimeoutMs);
}

async function verifyProduct(session, productName, expectedVersion, onLog) {
  onLog('verifying', 'Verifying installation');
  const cred = session;
  const { programs } = await registrySoftware.fetchInstalledPrograms(cred, deployConfig.stepTimeoutMs);
  const match = programs.find((p) => {
    if (!productName) return false;
    if (!p.displayName.toLowerCase().includes(String(productName).toLowerCase())) return false;
    if (expectedVersion && p.version && p.version !== expectedVersion) return false;
    return true;
  });
  return { installed: !!match, program: match };
}

async function cleanupStaging(session, jobId) {
  const staging = `${deployConfig.stagingPath}\\${jobId}`.replace(/\\/g, '\\\\');
  const script = [
    '$ErrorActionPreference="SilentlyContinue"',
    `if(Test-Path "${staging}"){ Remove-Item "${staging}" -Recurse -Force }`,
  ].join('\n');
  await wmiPs(session, script, deployConfig.stepTimeoutMs);
}

async function installOnEndpoint(vm, jobId, pkgDoc, options, hooks) {
  const { onLog = () => {}, onStatus = () => {} } = hooks;
  const productName = options.productName || pkgDoc.name;

  try {
    const session = await sessionFromVm(vm);
    const buffer = packageStore.readPackageBytes(pkgDoc);
    onStatus('connecting');
    onLog('connecting', `Connecting to ${vm.name}`);

    const { programs, agents } = await registrySoftware.fetchInstalledPrograms(session);
    onStatus('detecting');
    if (options.idempotent !== false) {
      const existing = programs.find((p) => p.displayName.toLowerCase().includes(productName.toLowerCase())
        && (!options.expectedVersion || p.version === options.expectedVersion));
      if (existing) {
        return { ok: true, skipped: true, message: 'Already installed', agentName: existing.displayName, agentVersion: existing.version };
      }
    }

    const remoteFile = await transferPackage(session, jobId, pkgDoc, buffer, (step, msg) => {
      onStatus(step);
      onLog(step, msg);
    });

    await runInstaller(session, remoteFile, pkgDoc, options.installArgs, (step, msg) => {
      onStatus(step);
      onLog(step, msg);
    });

    const verify = await verifyProduct(session, productName, options.expectedVersion, (step, msg) => {
      onStatus(step);
      onLog(step, msg);
    });
    if (!verify.installed) {
      throw new Error('Installation verification failed — product not found in registry');
    }

    await cleanupStaging(session, jobId);
    onStatus('done');
    return {
      ok: true,
      agentName: verify.program.displayName,
      agentVersion: verify.program.version,
      message: 'Installed successfully',
    };
  } catch (err) {
    try { await cleanupStaging(session, jobId); } catch { /* ignore */ }
    onStatus('failed');
    return { ok: false, message: err.message };
  }
}

module.exports = {
  installOnEndpoint,
  sessionFromVm,
};
