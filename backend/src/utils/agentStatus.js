function isAgentRemoved(vm) {
  if (!vm) return false;
  return vm.agentStatus === 'removed' || vm.version === 'removed';
}

function isAgentActive(vm) {
  return !isAgentRemoved(vm);
}

/** VMs eligible for automatic background monitoring (removed agents are manual-check only). */
function getMonitorableVmQuery() {
  return {
    excluded: false,
    status: { $ne: 'in_progress' },
    agentStatus: { $ne: 'removed' },
    version: { $ne: 'removed' },
  };
}

module.exports = { isAgentRemoved, isAgentActive, getMonitorableVmQuery };
