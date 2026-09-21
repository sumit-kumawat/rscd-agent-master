const VM = require('../models/VM');
const agentProbe = require('./agentProbe');
const { isValidIpv4 } = require('../utils/hosts');
const { toVmPlain } = require('../utils/vmPlain');
const { CONNECTIVITY_STATES } = require('../utils/wmiCredentials');
const wmiConfig = require('../config/wmi');

function mapConnectivityToStatus(probe, plain) {
  if (plain.excluded) return 'excluded';
  if (probe.connectivityState === CONNECTIVITY_STATES.ONLINE) return 'online';
  if (plain.status === 'in_progress') return 'in_progress';
  return 'offline';
}

/**
 * Probe a VM via WMI — connectivity and agent status are separate.
 * Connectivity = WMI session succeeds.
 * Agent status = detected on host during probe (only updated when WMI succeeds).
 */
async function checkVm(vm, options = {}) {
  const plain = toVmPlain(vm);
  const lightweight = options.lightweight ?? wmiConfig.monitorLightweight;
  const probe = await agentProbe.probeWithDedup(plain, { lightweight });

  return {
    connectivity: probe.connectivity,
    connectivityState: probe.connectivityState,
    agentStatus: probe.agentStatus,
    ip: probe.ip,
    version: probe.version,
    installRoot: probe.installRoot,
    wmiUser: probe.wmiUser,
    error: probe.error,
    errorKind: probe.errorKind,
    diagnostics: probe.diagnostics,
    checkedAt: probe.checkedAt,
  };
}

async function checkAndUpdate(vm, options = {}) {
  const plain = toVmPlain(vm);
  const lightweight = options.lightweight ?? wmiConfig.monitorLightweight;
  const probe = await agentProbe.probeWithDedup(plain, { lightweight });

  const updates = {
    lastCheck: probe.checkedAt,
    lastProbeError: probe.error || '',
    connectivityState: probe.connectivityState || CONNECTIVITY_STATES.UNKNOWN,
    osType: 'windows',
    os: 'Windows',
  };

  if (probe.connectivityState === CONNECTIVITY_STATES.ONLINE) {
    updates.status = plain.excluded ? 'excluded' : 'online';
    updates.powerState = 'on';
    updates.lastSeenAt = new Date();
    updates.wmiReachable = true;
    updates.authStatus = 'allowed';
    updates.connectivityMethod = 'wmi';
    updates.lastProbeError = probe.lightweight ? '' : (probe.error || '');
    updates.agentStatus = probe.agentStatus;
    updates.version = probe.agentStatus === 'removed' ? 'removed' : probe.version;
    if (probe.installRoot) updates.installRoot = probe.installRoot;
    if (probe.ip && isValidIpv4(probe.ip)) updates.ip = probe.ip;
    if (probe.wmiUser) updates.wmiUsername = probe.wmiUser;
    if (probe.wmiDomain) updates.wmiDomain = probe.wmiDomain;
    if (probe.wmiHost && probe.wmiHost.includes('.') && !plain.fqdn) {
      updates.fqdn = probe.wmiHost;
    }
  } else {
    updates.status = mapConnectivityToStatus(probe, plain);
    const offStates = ['unreachable', 'timeout', 'offline', 'dns_failed'];
    const onStates = ['auth_failed', 'permission_denied', 'wmi_unavailable', 'relay_unavailable', 'in_progress'];
    if (offStates.includes(probe.connectivityState)) {
      updates.powerState = 'off';
    } else if (onStates.includes(probe.connectivityState)) {
      updates.powerState = 'on';
    } else if (updates.status === 'offline') {
      updates.powerState = 'off';
    }
    updates.wmiReachable = false;
    updates.authStatus = (probe.connectivityState === CONNECTIVITY_STATES.AUTH_FAILED || probe.connectivityState === CONNECTIVITY_STATES.PERMISSION_DENIED)
      ? 'denied'
      : (plain.authStatus || 'unknown');
    updates.connectivityMethod = 'none';
    updates.lastProbeError = probe.error || '';
  }

  const updated = await VM.findByIdAndUpdate(vm._id, { $set: updates }, { new: true });
  return { result: probe, vm: updated };
}

module.exports = { checkVm, checkAndUpdate };
