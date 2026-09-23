/** Fleet-ready: RSCD uninstalled, local users, VC++ 2015 x64 (inventory or stored readiness). */

function isRscdUninstalled(vm) {
  if (!vm) return false;
  if (vm.agentStatus === 'removed' || vm.version === 'removed') return true;
  if (vm.rscdStatus === 'absent') return true;
  if (vm.rscdStatus === 'installed') return false;
  if (vm.agentStatus === 'active' && vm.version && vm.version !== 'unknown' && vm.version !== 'removed') {
    return false;
  }
  return null;
}

function localUsersReady(vm, required = 3) {
  const present = vm.localUsers?.present ?? 0;
  if (present >= required) {
    const users = vm.localUsers?.users || [];
    if (!users.length) return true;
    return users.filter((u) => u.present).length >= required;
  }
  return false;
}

function vcRedistReady(vm) {
  if (vm.vcRedist2015X64?.status === 'installed') return true;
  if (vm.vcRedist2015X64?.status === 'missing') return false;
  return null;
}

function computeEndpointReady(vm) {
  if (vm?.readiness?.allPass === true) return true;
  if (vm?.readiness?.allPass === false) return false;

  const rscd = isRscdUninstalled(vm);
  const users = localUsersReady(vm);
  const vc = vcRedistReady(vm);

  if (rscd === true && users && vc === true) return true;
  if (rscd === false || !users || vc === false) return false;
  return null;
}

function countFleetReady(vms) {
  let ready = 0;
  let notReady = 0;
  let unknown = 0;
  for (const vm of vms) {
    const state = computeEndpointReady(vm);
    if (state === true) ready++;
    else if (state === false) notReady++;
    else unknown++;
  }
  return { ready, notReady, unknown, total: vms.length };
}

module.exports = {
  computeEndpointReady,
  countFleetReady,
};
