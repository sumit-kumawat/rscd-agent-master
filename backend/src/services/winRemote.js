const logger = require('../utils/logger');
const agentProbe = require('./agentProbe');
const { runWmiPowershell, runWmiCmd } = require('../utils/wmiExec');
const { toVmPlain } = require('../utils/vmPlain');
const { isAgentRemoved } = require('../utils/agentStatus');
const { DEFAULT_INSTALL_ROOT } = require('../utils/hosts');

const RSCD_ROOT = DEFAULT_INSTALL_ROOT;

const SERVICE_DETECT_SCRIPT = [
  '$ErrorActionPreference="SilentlyContinue"',
  '$svc=Get-Service -Name RSCD -EA 0',
  'if($svc){ Write-Output ("SERVICE:installed"); Write-Output ("SERVICE_STATUS:" + $svc.Status) }',
  'else { Write-Output "SERVICE:not_installed" }',
  'foreach($k in "HKLM:\\SOFTWARE\\BladeLogic\\RSCD Agent","HKLM:\\SOFTWARE\\WOW6432Node\\BladeLogic\\RSCD Agent"){',
  '  $p=Get-ItemProperty $k -EA 0',
  '  if($p.ProductCode){ Write-Output ("PRODUCTCODE:" + $p.ProductCode) }',
  '}',
  'foreach($u in "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall","HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall"){',
  '  Get-ChildItem $u -EA 0 | ForEach-Object {',
  '    $p=Get-ItemProperty $_.PSPath -EA 0',
  '    if($p.DisplayName -match "RSCD|BladeLogic|TrueSight Server Automation|BMC BladeLogic"){',
  '      Write-Output ("PROGRAMS:" + $p.DisplayName)',
  '      if($_.PSChildName -match "^\\{"){ Write-Output ("PRODUCTCODE:" + $_.PSChildName) }',
  '      elseif($p.UninstallString -match "\\{[0-9A-Fa-f-]{36}\\}"){',
  '        Write-Output ("PRODUCTCODE:" + ([regex]::Match($p.UninstallString,"\\{[0-9A-Fa-f-]{36}\\}")).Value)',
  '      }',
  '    }',
  '  }',
  '}',
].join('\n');

function parseUninstallOutput(stdout) {
  const text = String(stdout || '');
  if (/PARTIAL:/i.test(text)) {
    return { success: false, partial: true, message: text };
  }
  if (/^OK:/im.test(text) || /OK:removed/i.test(text)) {
    return { success: true, partial: false, message: text };
  }
  return { success: false, partial: false, message: text || 'Verification failed' };
}

function parseServiceDetect(stdout) {
  const result = {
    serviceInstalled: false,
    serviceStatus: 'NotFound',
    productCodes: [],
    programs: [],
  };
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const t = line.trim();
    if (t === 'SERVICE:installed') result.serviceInstalled = true;
    else if (t.startsWith('SERVICE_STATUS:')) result.serviceStatus = t.slice(15).trim();
    else if (t === 'SERVICE:not_installed') result.serviceInstalled = false;
    else if (t.startsWith('PRODUCTCODE:')) {
      const code = t.slice(12).trim();
      if (/^\{[0-9A-Fa-f-]{36}\}$/.test(code) && !result.productCodes.includes(code)) {
        result.productCodes.push(code);
      }
    } else if (t.startsWith('PROGRAMS:')) result.programs.push(t.slice(9).trim());
  }
  return result;
}

function getManualUninstallSteps(installRoot) {
  const root = installRoot || RSCD_ROOT;
  return [
    'WMI uninstall failed — manual steps on the Windows host:',
    '1. Open PowerShell as Administrator',
    '2. Stop-Service RSCD -Force',
    '3. msiexec /QN /X "{ProductCode}" REBOOT=ReallySuppress',
    `4. Remove-Item "${root}" -Recurse -Force`,
    '5. Remove BladeLogic keys from Programs & Features registry',
  ].join('\n');
}

class WinRemoteService {
  connectWmi(vm) {
    return agentProbe.connectWmi(vm);
  }

  async _wmiCmd(session, cmdLine) {
    return runWmiCmd(session.host, session.username, session.password, cmdLine, session.domain || null);
  }

  async _wmiPs(session, script) {
    return runWmiPowershell(session.host, session.username, session.password, script, session.domain || null);
  }

  async detectAgent(session, hintRoot) {
    const data = await agentProbe.probeOnSession(session);
    const installRoot = data.installRoot || hintRoot || RSCD_ROOT;
    return {
      installed: data.installed,
      version: data.version,
      installRoot,
      installRoots: data.installRoots,
      codes: data.codes,
    };
  }

  /** Step 1 — Detect RSCD service and Programs & Features entries. */
  async _detectServiceState(session, onLog) {
    onLog('Step 1 — Detecting RSCD service and Programs & Features entries…');
    const r = await this._wmiPs(session, SERVICE_DETECT_SCRIPT);
    const state = parseServiceDetect(r.stdout);

    if (state.serviceInstalled) {
      onLog(`RSCD service found — status: ${state.serviceStatus}`, 'info');
    } else {
      onLog('RSCD Windows service not registered', 'info');
    }

    if (state.programs.length) {
      state.programs.forEach((p) => onLog(`Programs & Features entry found: ${p}`, 'info'));
    }

    if (state.productCodes.length) {
      onLog(`MSI product code(s): ${state.productCodes.join(', ')}`, 'info');
    } else {
      onLog('No MSI product code found in registry', 'warning');
    }

    return state;
  }

  /** Step 2 — Stop service and processes if running. */
  async _stopServiceIfRunning(session, serviceState, onLog) {
    onLog('Step 2 — Stopping RSCD service and processes…');
    const running = serviceState.serviceStatus === 'Running';

    if (running) {
      onLog('RSCD service is Running — issuing stop command');
      try {
        await this._wmiCmd(session, 'net stop RSCD /y');
        onLog('RSCD service stopped', 'success');
      } catch (err) {
        onLog(`net stop RSCD failed: ${err.message} — attempting taskkill`, 'warning');
      }
    } else if (serviceState.serviceInstalled) {
      onLog(`RSCD service is ${serviceState.serviceStatus} — no stop required`);
    }

    try {
      await this._wmiCmd(session, 'taskkill /F /IM RSCD.exe /IM agentctl.exe /IM blagent.exe');
      onLog('RSCD processes terminated (if any were running)');
    } catch {
      onLog('No RSCD processes required termination');
    }
  }

  /** Step 3 — Uninstall via Programs & Features (msiexec). */
  async _msiUninstall(session, codes, onLog) {
    onLog('Step 3 — Uninstalling from Programs & Features (msiexec)…');
    const results = [];
    if (!codes.length) {
      onLog('No MSI product code — skipping msiexec (will clean registry/directory manually)', 'warning');
      return results;
    }
    for (const code of codes) {
      onLog(`msiexec /qn /x ${code} — uninstall initiated`);
      try {
        await this._wmiCmd(session, `msiexec /qn /x ${code} REBOOT=ReallySuppress /norestart`);
        onLog(`Programs & Features uninstall completed — ${code}`, 'success');
        results.push(`msi:${code}:ok`);
      } catch (err) {
        onLog(`msiexec uninstall failed — ${code}: ${err.message}`, 'error');
        results.push(`msi:${code}:fail`);
      }
    }
    return results;
  }

  async _removeServiceRegistration(session, onLog) {
    try {
      await this._wmiCmd(session, 'sc delete RSCD');
      onLog('RSCD service registration removed');
    } catch {
      // service may already be removed by MSI
    }
  }

  /** Step 4 — Remove registry keys (Programs & Features + BladeLogic). */
  async _cleanupRegistry(session, onLog) {
    onLog('Step 4 — Removing registry entries…');
    try { await this._wmiCmd(session, 'reg delete "HKLM\\SOFTWARE\\BladeLogic" /f'); } catch { /* */ }
    try { await this._wmiCmd(session, 'reg delete "HKLM\\SOFTWARE\\WOW6432Node\\BladeLogic" /f'); } catch { /* */ }
    const script = [
      '$ErrorActionPreference="SilentlyContinue"',
      'foreach($u in "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall","HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall"){',
      '  Get-ChildItem $u -EA 0|ForEach-Object{',
      '    $p=Get-ItemProperty $_.PSPath -EA 0',
      '    if($p.DisplayName -match "RSCD|BladeLogic|TrueSight|BMC"){ Remove-Item $_.PSPath -Recurse -Force -EA 0 }',
      '  }',
      '}',
    ].join('\n');
    await this._wmiPs(session, script);
    onLog('Registry cleanup completed', 'success');
  }

  /** Step 5 — Remove installation directories. */
  async _cleanupDirectories(session, roots, onLog) {
    onLog('Step 5 — Removing installation directories…');
    const unique = [...new Set(roots.filter(Boolean))];
    for (const root of unique) {
      try {
        const verify = await this._wmiPs(session, `if(Test-Path '${root.replace(/'/g, "''")}'){Write-Output 'EXISTS'}else{Write-Output 'GONE'}`);
        if (!/EXISTS/i.test(verify.stdout)) {
          onLog(`Directory already absent: ${root}`);
          continue;
        }
        await this._wmiCmd(session, `if exist "${root}" rmdir /s /q "${root}"`);
        const after = await this._wmiPs(session, `if(Test-Path '${root.replace(/'/g, "''")}'){Write-Output 'EXISTS'}else{Write-Output 'GONE'}`);
        if (/GONE/i.test(after.stdout)) {
          onLog(`Directory removed: ${root}`, 'success');
        } else {
          onLog(`Directory still present after cleanup: ${root}`, 'warning');
        }
      } catch (err) {
        onLog(`Directory cleanup failed for ${root}: ${err.message}`, 'warning');
      }
    }
  }

  async _verifyRemoved(session, roots) {
    const script = [
      '$ErrorActionPreference="SilentlyContinue"',
      `$roots=@('${roots.map((r) => r.replace(/'/g, "''")).join("','")}')`,
      'foreach($r in $roots){ if(Test-Path $r){ Write-Output "PARTIAL:directory:$r"; exit } }',
      'foreach($u in "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall","HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall"){',
      '  Get-ChildItem $u -EA 0|ForEach-Object{',
      '    $d=(Get-ItemProperty $_.PSPath -EA 0).DisplayName',
      '    if($d -match "RSCD|BladeLogic|TrueSight|BMC"){ Write-Output "PARTIAL:registry"; exit }',
      '  }',
      '}',
      'if(Get-Service *rsc*,*bladelogic* -EA 0){ Write-Output "PARTIAL:service"; exit }',
      'Write-Output "OK:removed"',
    ].join('\n');
    const r = await this._wmiPs(session, script);
    return parseUninstallOutput(r.stdout || '');
  }

  async checkAgent(vm) {
    const probe = await agentProbe.probe(vm);
    return {
      connectivity: probe.connectivity,
      agentStatus: probe.agentStatus,
      ip: probe.ip,
      version: probe.version,
      installRoot: probe.installRoot,
      wmiUser: probe.wmiUser,
      error: probe.error,
    };
  }

  async runUninstall(vm, options = {}) {
    const plain = toVmPlain(vm);
    const onLog = (message, level = 'info') => {
      if (options.onLog) options.onLog(level, message);
    };

    if (isAgentRemoved(plain)) {
      onLog('Agent already marked Removed in database — skipping uninstall', 'info');
      return {
        success: true,
        alreadyRemoved: true,
        username: null,
        host: null,
        method: 'wmi',
        version: 'removed',
        installRoot: plain.installRoot || RSCD_ROOT,
        uninstallMessage: 'OK:already_removed',
        steps: [],
      };
    }

    onLog('Connecting via WMI…');
    const session = await this.connectWmi(plain);
    onLog(`WMI connection successful (${session.username}@${session.host})`, 'success');

    const agent = await this.detectAgent(session, plain.installRoot);
    const serviceState = await this._detectServiceState(session, onLog);

    const codes = [...new Set([...agent.codes, ...serviceState.productCodes])];
    const hasAgent = agent.installed || serviceState.serviceInstalled || codes.length > 0;

    if (!hasAgent) {
      const verified = await this._verifyRemoved(session, agent.installRoots);
      if (verified.success) {
        onLog('No RSCD agent found — host already clean', 'success');
        return {
          success: true,
          username: session.username,
          host: session.host,
          method: 'wmi',
          version: 'removed',
          installRoot: agent.installRoot,
          uninstallMessage: 'OK:already_removed',
          steps: [],
        };
      }
      onLog('No RSCD agent discovered — proceeding with cleanup anyway', 'warning');
    } else {
      onLog(`Agent discovered — v${agent.version} @ ${agent.installRoot || RSCD_ROOT}`);
    }

    await this._stopServiceIfRunning(session, serviceState, onLog);
    const msiResults = await this._msiUninstall(session, codes, onLog);
    await this._removeServiceRegistration(session, onLog);
    await this._cleanupRegistry(session, onLog);
    await this._cleanupDirectories(session, agent.installRoots, onLog);

    onLog('Verifying remote removal state…');
    let verified = await this._verifyRemoved(session, agent.installRoots);
    if (!verified.success) {
      onLog('Verification failed — retrying directory and registry cleanup…', 'warning');
      await this._stopServiceIfRunning(session, { serviceStatus: 'Stopped', serviceInstalled: false }, onLog);
      await this._cleanupDirectories(session, agent.installRoots, onLog);
      await this._cleanupRegistry(session, onLog);
      verified = await this._verifyRemoved(session, agent.installRoots);
    }

    if (verified.success) {
      onLog('Remote verification passed — RSCD fully removed from host', 'success');
      onLog('Step 6 — Database will be updated to Removed', 'info');
    } else {
      onLog(`Remote verification failed — ${verified.message}`, 'error');
    }

    const message = [...msiResults, verified.message].filter(Boolean).join('\n');
    return {
      success: verified.success && !verified.partial,
      username: session.username,
      host: session.host,
      method: 'wmi',
      version: agent.version,
      installRoot: agent.installRoot,
      uninstallMessage: message,
      steps: msiResults,
    };
  }

  async connect(vm) {
    return this.connectWmi(vm);
  }

  async uninstall(vm) {
    return this.runUninstall(vm);
  }
}

module.exports = new WinRemoteService();
module.exports.getManualUninstallSteps = getManualUninstallSteps;
