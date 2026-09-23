import { resolvePowerState } from './endpointDisplay';

export function isAgentRemoved(vm) {
  return vm?.agentStatus === 'removed' || vm?.version === 'removed';
}

/** Readiness task list from Mongo inventory (before live WMI check). */
export function buildReadinessFromVm(vm) {
  if (!vm) return { tasks: [], allPass: false, stale: true };
  if (vm.readiness?.tasks?.length) {
    return {
      tasks: vm.readiness.tasks,
      allPass: vm.readiness.allPass,
      checkedAt: vm.readiness.checkedAt,
      stale: true,
    };
  }
  const users = vm.localUsers?.users || [];
  const expected = 3;
  const usersOk = (vm.localUsers?.present ?? 0) >= expected
    && users.filter((u) => u.present).length >= expected;
  const rscdOk = isAgentRemoved(vm) || vm.rscdStatus === 'absent';
  const vcOk = vm.vcRedist2015X64?.status === 'installed';
  const tasks = [
    {
      id: 'rscd_uninstalled',
      label: 'RSCD agent uninstalled',
      status: rscdOk ? 'pass' : (vm.rscdStatus === 'installed' || vm.agentStatus === 'active' ? 'fail' : 'unknown'),
      message: rscdOk ? 'Inventory indicates removed' : 'Verify on host',
    },
    {
      id: 'local_users',
      label: 'Provision local users',
      status: usersOk ? 'pass' : (vm.localUsers?.checkedAt ? 'fail' : 'unknown'),
      message: usersOk ? `${vm.localUsers.present}/${expected} users` : 'Not all users present',
    },
    {
      id: 'vcredist_2015_x64',
      label: 'Microsoft Visual C++ 2015 Redistributable (x64)',
      status: vcOk ? 'pass' : (vm.vcRedist2015X64?.status === 'missing' ? 'fail' : 'unknown'),
      message: vcOk ? 'Installed' : 'Verify on host',
    },
  ];
  return { tasks, allPass: tasks.every((t) => t.status === 'pass'), stale: true };
}

/** Build display-ready tab payload from VM inventory (no WMI required). */
export function buildCachedTabData(vm, tabId) {
  if (!vm) return null;
  const power = resolvePowerState(vm);
  const online = vm.status === 'online' || vm.connectivityState === 'online';

  switch (tabId) {
    case 'overview':
      return {
        hostname: vm.name,
        ip: vm.ip || '',
        fqdn: vm.fqdn || '',
        os: vm.os || 'Windows',
        osVersion: vm.osVersion || '',
        model: vm.hardwareModel || '',
        serviceTag: vm.serviceTag || '',
        lastSeen: vm.lastSeenAt || vm.lastCheck,
        lastBoot: null,
        health: online ? 'healthy' : (vm.connectivityState || vm.status || 'unknown'),
        powerState: power,
        connectivity: vm.connectivityState || vm.status,
        agentVersion: vm.version || 'unknown',
      };
    case 'system':
      return {
        cpu: vm.cpuModel || null,
        cores: vm.cpuCores || null,
        ramGb: vm.ramGb || null,
        disks: vm.disks || [],
        networkInterfaces: vm.networkInterfaces || [],
        model: vm.hardwareModel || '',
        osVersion: vm.osVersion || '',
      };
    case 'local-users':
      return {
        required: vm.localUsers?.required || 3,
        present: vm.localUsers?.present ?? 0,
        users: vm.localUsers?.users || [],
        checkedAt: vm.localUsers?.checkedAt,
      };
    case 'software': {
      const programs = (vm.softwareSnapshot?.programs || []).map((p) => ({
        name: p.name,
        version: p.version,
        publisher: p.publisher,
      }));
      return { programs, capturedAt: vm.softwareSnapshot?.capturedAt };
    }
    case 'rscd':
      return {
        serviceInstalled: vm.agentStatus === 'active' && !isAgentRemoved(vm),
        serviceStatus: vm.agentStatus === 'active' ? 'running' : 'stopped',
        agentStatus: isAgentRemoved(vm) ? 'removed' : (vm.agentStatus || 'unknown'),
        agentVersion: vm.version || 'unknown',
        productCodes: vm.productCodes || [],
        programs: vm.rscdPrograms || [],
        installPaths: vm.installRoot ? [vm.installRoot] : [],
        errors: [],
      };
    case 'power':
      return { state: power, source: 'inventory' };
    case 'console': {
      const host = vm.fqdn || vm.name || vm.ip;
      return {
        supported: !!host,
        protocol: 'rdp',
        url: host ? `rdp://full%20address=s:${host}` : null,
        instructions: host
          ? `Open Remote Desktop Connection to ${host} using the RDSROOT account.`
          : 'No hostname available for console launch.',
      };
    }
    case 'logs':
    case 'audit':
      return [];
    default:
      return null;
  }
}

export function mergeTabData(vm, tabId, live) {
  const cached = buildCachedTabData(vm, tabId);
  if (!cached && !live) return null;
  if (!cached) return live;
  if (!live) return cached;
  if (Array.isArray(cached)) return live.length ? live : cached;
  return { ...cached, ...live };
}
