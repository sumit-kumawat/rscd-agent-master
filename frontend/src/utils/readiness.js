/** Client-side ready state (matches backend readinessSummary). */

export function isEndpointReady(vm) {
  if (!vm) return null;
  if (vm.readiness?.allPass === true) return true;
  if (vm.readiness?.allPass === false) return false;

  const rscdRemoved = vm.agentStatus === 'removed' || vm.version === 'removed' || vm.rscdStatus === 'absent';
  const rscdInstalled = vm.rscdStatus === 'installed'
    || (vm.agentStatus === 'active' && vm.version && vm.version !== 'unknown' && vm.version !== 'removed');

  const required = vm.localUsers?.required || 3;
  const usersOk = (vm.localUsers?.present ?? 0) >= required;
  const vcOk = vm.vcRedist2015X64?.status === 'installed';
  const vcMissing = vm.vcRedist2015X64?.status === 'missing';

  if (rscdInstalled) return false;
  if (!usersOk) return false;
  if (vcMissing) return false;
  if (rscdRemoved && usersOk && vcOk) return true;
  if (rscdRemoved && usersOk && !vcMissing && vm.vcRedist2015X64?.status !== 'installed') return null;
  return null;
}

export function readyLabel(vm) {
  const state = isEndpointReady(vm);
  if (state === true) return 'Ready';
  if (state === false) return 'Not ready';
  return '—';
}
