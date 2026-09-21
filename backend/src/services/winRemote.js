const logger = require('../utils/logger');
const agentProbe = require('./agentProbe');
const wmiConfig = require('../config/wmi');
const {
  runWmiPowershell,
  runWmiCmd,
  runWmiCmdAsync,
  WMI_TIMEOUT,
} = require('../utils/wmiExec');
const { toVmPlain } = require('../utils/vmPlain');
const { isAgentRemoved } = require('../utils/agentStatus');
const { DEFAULT_INSTALL_ROOT } = require('../utils/hosts');
const { detectRscd } = require('./rscdDetection');

const STEP_TIMEOUTS = wmiConfig.stepTimeouts;
const POLL_INTERVAL_MS = wmiConfig.pollIntervalMs;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RSCD_ROOT = DEFAULT_INSTALL_ROOT;
const DEFAULT_CLEANUP_ROOTS = [
  RSCD_ROOT,
  'C:\\Program Files\\BMC Software',
  'C:\\Program Files (x86)\\BMC Software',
  'C:\\ProgramData\\BMC',
];

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

  /** Fixed Administrator credential for RSCD uninstall — not VM-stored creds. */
  connectForUninstall(vm) {
    const uninstallCred = require('../config/uninstallCredential');
    const plain = toVmPlain(vm);
    return this.connectWmi({
      ...plain,
      wmiUsername: uninstallCred.username,
      wmiPassword: uninstallCred.password,
      wmiDomain: uninstallCred.domain || '',
    });
  }

  async _wmiCmd(session, cmdLine, options = {}) {
    const timeoutMs = options.timeoutMs ?? STEP_TIMEOUTS.cmd;
    const execOpts = {};
    if (options.async) {
      execOpts.silent = true;
      execOpts.noOutput = true;
    }
    const runner = options.async ? runWmiCmdAsync : runWmiCmd;
    return runner(
      session.host,
      session.username,
      session.password,
      cmdLine,
      session.domain || null,
      timeoutMs,
      execOpts,
    );
  }

  async _wmiPs(session, script, timeoutMs = STEP_TIMEOUTS.cmd) {
    return runWmiPowershell(
      session.host,
      session.username,
      session.password,
      script,
      session.domain || null,
      timeoutMs,
    );
  }

  async _pollMsiRemoval(session, code, onLog, timeoutMs = STEP_TIMEOUTS.msi) {
    const bare = code.replace(/[{}]/g, '');
    const started = Date.now();
    let lastHeartbeat = 0;

    while (Date.now() - started < timeoutMs) {
      try {
        const r = await this._wmiCmd(
          session,
          `reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${code}" /v DisplayName`,
          { timeoutMs: STEP_TIMEOUTS.cmd },
        );
        if (!String(r.stdout || '').toLowerCase().includes(bare.toLowerCase())) {
          onLog(`MSI product removed from registry — ${code}`, 'success');
          return true;
        }
      } catch {
        onLog(`MSI product removed from registry — ${code}`, 'success');
        return true;
      }

      const elapsed = Math.round((Date.now() - started) / 1000);
      if (elapsed - lastHeartbeat >= 30) {
        lastHeartbeat = elapsed;
        onLog(`MSI uninstall in progress… (${elapsed}s elapsed)`, 'info');
      }
      await sleep(POLL_INTERVAL_MS);
    }

    onLog(`MSI uninstall poll timed out after ${Math.round(timeoutMs / 1000)}s — ${code}`, 'warning');
    return false;
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

  /** Step 1 — Parallel RSCD detection (service, registry, paths). */
  async _detectServiceState(session, onLog) {
    onLog('Step 1 — Detecting RSCD (parallel sub-queries)…');
    const state = await detectRscd(session, onLog, {
      stepTimeoutMs: STEP_TIMEOUTS.detect,
      queryTimeoutMs: wmiConfig.queryTimeoutMs,
      passwords: [session.password],
    });

    if (state.serviceInstalled) {
      onLog(`RSCD service found — status: ${state.serviceStatus}`, 'info');
    } else {
      onLog('RSCD Windows service not registered', 'info');
    }

    if (state.programs.length) {
      state.programs.forEach((p) => onLog(`Programs & Features entry found: ${p}`, 'info'));
    }

    if (state.installPaths?.length) {
      state.installPaths.forEach((p) => onLog(`Installation path found: ${p}`, 'info'));
    }

    if (state.productCodes.length) {
      onLog(`MSI product code(s): ${state.productCodes.join(', ')}`, 'info');
    } else {
      onLog('No MSI product code found in registry', 'warning');
    }

    if (state.partial) {
      onLog(`Detection partial — some sub-queries failed: ${state.errors.join('; ')}`, 'warning');
    }
    if (state.detectionFailed) {
      onLog('Detection failed — manual review required; continuing with available findings', 'warning');
    }

    return {
      serviceInstalled: state.serviceInstalled,
      serviceStatus: state.serviceStatus,
      productCodes: state.productCodes,
      programs: state.programs,
    };
  }

  /** Step 2 — Stop service and processes if running. */
  async _stopServiceIfRunning(session, serviceState, onLog) {
    onLog('Step 2 — Stopping RSCD service and processes…');
    const running = serviceState.serviceStatus === 'Running';

    if (running) {
      onLog('RSCD service is Running — issuing stop command');
      try {
        await this._wmiCmd(session, 'net stop RSCD /y', { async: true, timeoutMs: STEP_TIMEOUTS.stop });
        await sleep(5000);
        onLog('RSCD stop command issued', 'success');
      } catch (err) {
        onLog(`net stop RSCD failed: ${err.message} — attempting taskkill`, 'warning');
      }
    } else if (serviceState.serviceInstalled) {
      onLog(`RSCD service is ${serviceState.serviceStatus} — no stop required`);
    }

    try {
      await this._wmiCmd(
        session,
        'taskkill /F /IM RSCD.exe /IM agentctl.exe /IM blagent.exe',
        { async: true, timeoutMs: STEP_TIMEOUTS.stop },
      );
      onLog('RSCD processes terminated (if any were running)');
    } catch {
      onLog('No RSCD processes required termination');
    }
  }

  async _disableService(session, onLog) {
    onLog('Disabling RSCD service startup…');
    try {
      await this._wmiCmd(session, 'sc config RSCD start= disabled', { async: true, timeoutMs: STEP_TIMEOUTS.stop });
      onLog('RSCD service start mode set to Disabled', 'success');
    } catch (err) {
      onLog(`Could not disable RSCD service: ${err.message}`, 'warning');
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
        await this._wmiCmd(
          session,
          `msiexec /qn /x ${code} REBOOT=ReallySuppress /norestart`,
          { async: true, timeoutMs: STEP_TIMEOUTS.cmd },
        );
        const removed = await this._pollMsiRemoval(session, code, onLog, STEP_TIMEOUTS.msi);
        if (removed) {
          onLog(`Programs & Features uninstall completed — ${code}`, 'success');
          results.push(`msi:${code}:ok`);
        } else {
          onLog(`msiexec may still be running — ${code}`, 'warning');
          results.push(`msi:${code}:pending`);
        }
      } catch (err) {
        onLog(`msiexec uninstall failed — ${code}: ${err.message}`, 'error');
        results.push(`msi:${code}:fail`);
      }
    }
    return results;
  }

  async _removeServiceRegistration(session, onLog) {
    try {
      await this._wmiCmd(session, 'sc delete RSCD', { async: true, timeoutMs: STEP_TIMEOUTS.cmd });
      onLog('RSCD service registration removed');
    } catch {
      // service may already be removed by MSI
    }
  }

  /** Step 4 — Remove registry keys (Programs & Features + BladeLogic). */
  async _cleanupRegistry(session, onLog) {
    onLog('Step 4 — Removing registry entries…');
    try {
      await this._wmiCmd(session, 'reg delete "HKLM\\SOFTWARE\\BladeLogic" /f', { async: true });
    } catch { /* */ }
    try {
      await this._wmiCmd(session, 'reg delete "HKLM\\SOFTWARE\\WOW6432Node\\BladeLogic" /f', { async: true });
    } catch { /* */ }
    try {
      await this._wmiCmd(session, 'reg delete "HKLM\\SOFTWARE\\BMC Software" /f', { async: true });
    } catch { /* */ }
    try {
      await this._wmiCmd(session, 'reg delete "HKLM\\SOFTWARE\\WOW6432Node\\BMC Software" /f', { async: true });
    } catch { /* */ }
    const script = [
      '$ErrorActionPreference="SilentlyContinue"',
      'foreach($u in "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall","HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall"){',
      '  Get-ChildItem $u -EA 0|ForEach-Object{',
      '    $p=Get-ItemProperty $_.PSPath -EA 0',
      '    if($p.DisplayName -match "RSCD|BladeLogic|TrueSight|BMC"){ Remove-Item $_.PSPath -Recurse -Force -EA 0 }',
      '  }',
      '}',
    ].join('\n');
    await this._wmiPs(session, script, STEP_TIMEOUTS.registry);
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
        await this._wmiCmd(session, `if exist "${root}" rmdir /s /q "${root}"`, {
          async: true,
          timeoutMs: STEP_TIMEOUTS.directory,
        });
        await sleep(3000);
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
    const r = await this._wmiPs(session, script, STEP_TIMEOUTS.verify);
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
    const onPhase = (phase, detail = {}) => {
      if (options.onPhase) options.onPhase({ phase, ...detail });
    };
    const onStep = (step, total, label) => {
      if (options.onStep) options.onStep({ step, total, label, percent: Math.round(((step - 1) / total) * 100) });
    };
    const TOTAL_STEPS = 7;

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

    onPhase('detecting');
    onLog('Connecting via WMI (Administrator credential)…');
    const session = await this.connectForUninstall(plain);
    onLog(`WMI connection successful (${session.username}@${session.host})`, 'success');

    onStep(1, TOTAL_STEPS, 'Detect agent');
    let agent;
    try {
      agent = await this.detectAgent(session, plain.installRoot);
    } catch (err) {
      logger.debug(`Agent inventory skipped for ${plain.name}: ${err.message}`);
      agent = {
        installed: true,
        version: plain.version || 'unknown',
        installRoot: plain.installRoot || RSCD_ROOT,
        installRoots: [plain.installRoot || RSCD_ROOT],
        codes: [],
      };
    }
    const serviceState = await this._detectServiceState(session, onLog);

    const codes = [...new Set([...agent.codes, ...serviceState.productCodes])];
    const hasAgent = agent.installed || serviceState.serviceInstalled || codes.length > 0;

    if (!hasAgent) {
      const verified = await this._verifyRemoved(session, agent.installRoots);
      if (verified.success) {
        onLog('No RSCD agent found — host already clean', 'success');
        onPhase('done', { result: 'not_present' });
        return {
          success: true,
          notPresent: true,
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

    const cleanupRoots = [...new Set([
      ...(agent.installRoots || []),
      agent.installRoot,
      ...DEFAULT_CLEANUP_ROOTS,
    ].filter(Boolean))];
    agent.installRoots = cleanupRoots;

    onPhase('stopping');
    onStep(2, TOTAL_STEPS, 'Stop service');
    await this._stopServiceIfRunning(session, serviceState, onLog);
    onStep(3, TOTAL_STEPS, 'Disable service');
    await this._disableService(session, onLog);
    onPhase('uninstalling');
    onStep(4, TOTAL_STEPS, 'MSI uninstall');
    const msiResults = await this._msiUninstall(session, codes, onLog);
    await this._removeServiceRegistration(session, onLog);
    onPhase('cleaning');
    onStep(5, TOTAL_STEPS, 'Registry cleanup');
    await this._cleanupRegistry(session, onLog);
    onStep(6, TOTAL_STEPS, 'Directory cleanup');
    await this._cleanupDirectories(session, cleanupRoots, onLog);

    onPhase('verifying');
    onStep(7, TOTAL_STEPS, 'Verify removal');
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

    const rebootRequired = /reboot|restart required|pendingfile/i.test(String(verified.message || ''));
    const message = [...msiResults, verified.message].filter(Boolean).join('\n');
    const success = verified.success && !verified.partial;
    onPhase(success ? 'done' : 'failed', { result: success ? 'removed' : 'partial', rebootRequired });
    return {
      success,
      partial: verified.partial,
      rebootRequired,
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
