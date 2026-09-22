const { runWmiPowershell, runWmiCmdAsync } = require('../utils/wmiExec');
const deployInstall = require('./deployInstall');
const registrySoftware = require('./registrySoftware');
const deployConfig = require('../config/deployConfig');
const winRemote = require('./winRemote');


async function wmiPs(session, script, timeoutMs) {
  const r = await runWmiPowershell(
    session.host, session.username, session.password, script, session.domain, timeoutMs,
  );
  return r.stdout || '';
}

function pickSilentUninstall(program, silentPreferred = true) {
  if (silentPreferred && program.quietUninstallString) return program.quietUninstallString;
  if (program.uninstallString) return program.uninstallString;
  return '';
}

function matchesTarget(program, { productName, productVersions, target }) {
  const cls = registrySoftware.classifyProgram(program);
  if (target === 'rscd' && cls === 'rscd') {
    if (!productVersions?.length) return true;
    return productVersions.includes(program.version || '(unknown)');
  }
  if (target === 'crowdstrike' && cls === 'crowdstrike') {
    if (!productVersions?.length) return true;
    return productVersions.includes(program.version || '(unknown)');
  }
  if (productName) {
    if (!program.displayName.toLowerCase().includes(productName.toLowerCase())) return false;
    if (productVersions?.length) return productVersions.includes(program.version || '(unknown)');
    return true;
  }
  return false;
}

async function uninstallProgramOnEndpoint(vm, jobId, spec, options, hooks) {
  const { onLog = () => {}, onStatus = () => {} } = hooks;
  const target = spec.target || 'custom';

  if (target === 'rscd') {
    onStatus('uninstalling');
    onLog('uninstalling', 'Using RSCD uninstall pipeline');
    const result = await winRemote.runUninstall(vm, {
      onLog: (level, msg) => onLog('uninstalling', msg, level),
      onPhase: ({ phase }) => onStatus(phase),
    });
    if (result.alreadyRemoved || result.notPresent) {
      return { ok: true, skipped: true, message: 'RSCD already absent', agentName: 'RSCD Agent', agentVersion: '' };
    }
    return {
      ok: result.success,
      message: result.success ? 'RSCD removed' : (result.error || 'Uninstall failed'),
      agentName: 'RSCD Agent',
      agentVersion: vm.rscdVersion || vm.version || '',
      rebootRequired: result.rebootRequired,
    };
  }

  const session = await deployInstall.sessionFromVm(vm);
  try {
    onStatus('connecting');
    const { programs } = await registrySoftware.fetchInstalledPrograms(session);
    onStatus('detecting');
    const matches = programs.filter((p) => matchesTarget(p, spec));
    if (!matches.length) {
      return { ok: true, skipped: true, message: 'Product not installed', agentName: spec.productName || target, agentVersion: '' };
    }
    if (registrySoftware.isProtectedProduct(matches[0])) {
      return { ok: false, message: 'Protected product — uninstall blocked' };
    }

    const program = matches[0];
    if (target === 'crowdstrike' && spec.environment === 'prod' && !options.confirmedProd) {
      return { ok: false, message: 'PROD CrowdStrike uninstall requires explicit confirmation' };
    }

    const uninstallCmd = pickSilentUninstall(program, options.silent !== false);
    if (!uninstallCmd) return { ok: false, message: 'No uninstall command found in registry' };

    if (options.stopService) {
      onStatus('stopping');
      onLog('stopping', 'Stopping related services if present');
      const stopScript = [
        '$ErrorActionPreference="SilentlyContinue"',
        'Get-Service|Where-Object{$_.DisplayName -match "CrowdStrike|Falcon|RSCD|BMC"}|ForEach-Object{ Stop-Service $_.Name -Force -EA 0 }',
      ].join('\n');
      await wmiPs(session, stopScript, deployConfig.stepTimeoutMs);
    }

    onStatus('uninstalling');
    onLog('uninstalling', `Running uninstall for ${program.displayName}`);
    await runWmiCmdAsync(
      session.host, session.username, session.password, uninstallCmd, session.domain,
      deployConfig.endpointTimeoutMs,
    );

    onStatus('verifying');
    const after = await registrySoftware.fetchInstalledPrograms(session);
    const still = after.programs.some((p) => matchesTarget(p, spec));
    if (still) throw new Error('Verification failed — product still present');

    onStatus('done');
    return {
      ok: true,
      agentName: program.displayName,
      agentVersion: program.version,
      message: 'Uninstalled successfully',
    };
  } catch (err) {
    onStatus('failed');
    return { ok: false, message: err.message };
  }
}

module.exports = { uninstallProgramOnEndpoint, matchesTarget };
