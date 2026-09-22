import { resolvePowerState } from './endpointDisplay';

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export function displayIp(ip) {
  const v = String(ip || '').trim();
  return IPV4.test(v) ? v : '—';
}

export function displayOs(vm) {
  return vm?.osVersion || vm?.os || 'Windows';
}

const RSCD_PATH_MARKERS = [
  'bladelogic\\rscd',
  'bladelogic\\nsh',
  'bladelogic26.2',
  'bladelogic244p1',
  'progra~1\\bmcsof~1\\bladel~1\\nsh',
];

function installRootIndicatesRscd(vm) {
  const root = String(vm?.installRoot || '').trim().toLowerCase();
  if (!root) return false;
  return RSCD_PATH_MARKERS.some((m) => root.includes(m));
}

export function rscdActiveLabel(vm) {
  if (vm?.agentStatus === 'removed' || vm?.version === 'removed') return 'Inactive';
  if (vm?.rscdStatus === 'installed') return 'Active';
  if (installRootIndicatesRscd(vm)) return 'Active';
  if (vm?.status === 'online' && vm?.version && vm.version !== 'unknown' && vm.version !== 'removed') {
    return 'Active';
  }
  return 'Inactive';
}

export function crowdStrikeActiveLabel(vm) {
  return vm?.crowdStrikeStatus === 'installed' ? 'Active' : 'Inactive';
}

export function powerIsUp(vm) {
  const p = resolvePowerState(vm);
  if (p === 'on') return true;
  if (p === 'off') return false;
  return vm?.status === 'online';
}

export function isRemoved(vm) {
  return vm?.agentStatus === 'removed' || vm?.version === 'removed';
}
