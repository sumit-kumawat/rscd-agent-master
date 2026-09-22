/** Derive display power state from VM record when powerState is stale or unknown. */
export function resolvePowerState(vm) {
  if (vm?.status === 'online' || vm?.connectivityState === 'online') return 'on';

  const raw = vm?.powerState;
  if (raw === 'on' || raw === 'off') return raw;

  const state = vm?.connectivityState || vm?.status;
  if (['unreachable', 'timeout', 'offline', 'dns_failed'].includes(state)) return 'off';
  if (['auth_failed', 'permission_denied', 'wmi_unavailable', 'relay_unavailable', 'in_progress'].includes(state)) {
    return 'on';
  }
  if (vm?.status === 'offline' || vm?.status === 'excluded') return 'off';
  return raw || 'unknown';
}

export function isRscdAgentActive(vm) {
  if (vm?.excluded) return false;
  return vm?.agentStatus === 'active' && vm?.version !== 'removed' && vm?.version !== 'unknown';
}

export function rscdAgentLabel(vm) {
  if (vm?.excluded) return 'excluded';
  if (vm?.status === 'in_progress') return 'checking';
  return isRscdAgentActive(vm) ? 'active' : 'inactive';
}
