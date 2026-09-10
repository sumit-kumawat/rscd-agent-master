const VM = require('../models/VM');
const agentProbe = require('./agentProbe');
const { isValidIpv4 } = require('../utils/hosts');
const { toVmPlain } = require('../utils/vmPlain');

/**
 * Probe a VM via WMI — connectivity and agent status are separate.
 * Connectivity = WMI session succeeds.
 * Agent status = detected on host during probe (only updated when WMI succeeds).
 */
async function checkVm(vm) {
  const plain = toVmPlain(vm);
  const probe = await agentProbe.probeWithDedup(plain);

  return {
    connectivity: probe.connectivity,
    agentStatus: probe.agentStatus,
    ip: probe.ip,
    version: probe.version,
    installRoot: probe.installRoot,
    wmiUser: probe.wmiUser,
    error: probe.error,
    checkedAt: probe.checkedAt,
  };
}

async function checkAndUpdate(vm) {
  const plain = toVmPlain(vm);
  const probe = await agentProbe.probeWithDedup(plain);

  const updates = {
    lastCheck: probe.checkedAt,
    lastProbeError: probe.error || '',
    osType: 'windows',
    os: 'Windows',
  };

  if (probe.connectivity === 'online') {
    updates.status = plain.excluded ? 'excluded' : 'online';
    updates.wmiReachable = true;
    updates.connectivityMethod = 'wmi';
    updates.lastProbeError = '';
    updates.agentStatus = probe.agentStatus;
    updates.version = probe.agentStatus === 'removed' ? 'removed' : probe.version;
    if (probe.installRoot) updates.installRoot = probe.installRoot;
    if (probe.ip && isValidIpv4(probe.ip)) updates.ip = probe.ip;
    if (probe.wmiUser) updates.wmiUsername = probe.wmiUser;
    if (probe.wmiDomain) updates.wmiDomain = probe.wmiDomain;
  } else {
    if (!plain.excluded && plain.status !== 'in_progress') {
      updates.status = 'offline';
    }
    updates.wmiReachable = false;
    updates.connectivityMethod = 'none';
    updates.lastProbeError = probe.error || '';
    // Do not change agentStatus when WMI fails — keep last verified value
  }

  const updated = await VM.findByIdAndUpdate(vm._id, { $set: updates }, { new: true });
  return { result: probe, vm: updated };
}

module.exports = { checkVm, checkAndUpdate };
