/** Tab payloads from MongoDB inventory — no WMI (instant response). */

function isOnline(vm) {
  return vm.status === 'online' || vm.connectivityState === 'online';
}

function inventoryForTab(vm, tab) {
  const online = isOnline(vm);
  switch (tab) {
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
        health: online ? 'healthy' : (vm.connectivityState || vm.status || 'unknown'),
        powerState: vm.powerState || (online ? 'on' : 'unknown'),
        connectivity: vm.connectivityState || vm.status,
        agentVersion: vm.version || 'unknown',
        source: 'inventory',
      };
    case 'system':
      return {
        cpu: null,
        cores: null,
        ramGb: null,
        disks: [],
        networkInterfaces: [],
        model: vm.hardwareModel || '',
        osVersion: vm.osVersion || '',
        source: 'inventory',
        offline: !online,
      };
    case 'local-users':
      return {
        required: vm.localUsers?.required || 3,
        present: vm.localUsers?.present ?? 0,
        users: vm.localUsers?.users || [],
        checkedAt: vm.localUsers?.checkedAt,
        source: 'inventory',
      };
    case 'software': {
      const programs = (vm.softwareSnapshot?.programs || []).map((p) => ({
        name: p.name,
        version: p.version,
        publisher: p.publisher,
      }));
      return { programs, capturedAt: vm.softwareSnapshot?.capturedAt, source: 'inventory' };
    }
    case 'rscd':
      return {
        serviceInstalled: vm.rscdStatus === 'installed' || vm.agentStatus === 'active',
        agentStatus: vm.agentStatus || 'unknown',
        agentVersion: vm.rscdVersion || vm.version || 'unknown',
        source: 'inventory',
      };
    case 'power':
      return { state: vm.powerState || 'unknown', source: 'inventory' };
    case 'console': {
      const host = vm.fqdn || vm.name || vm.ip;
      return {
        supported: !!host,
        protocol: 'rdp',
        url: host ? `rdp://full%20address=s:${host}` : null,
        instructions: host ? `Open Remote Desktop Connection to ${host}.` : 'No hostname available.',
        source: 'inventory',
      };
    }
    default:
      return null;
  }
}

module.exports = { inventoryForTab, isOnline };
