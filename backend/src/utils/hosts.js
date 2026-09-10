const dns = require('dns').promises;

const DEFAULT_INSTALL_ROOT = 'C:\\Program Files\\BMC Software\\BladeLogic\\RSCD';
const DEFAULT_DNS_SUFFIXES = ['corp.helixops.ai', 'bmc.com'];

function isIp(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(String(host || '').trim());
}

function isValidIpv4(ip) {
  if (!isIp(ip)) return false;
  const parts = ip.split('.').map(Number);
  return parts.every((n) => n >= 0 && n <= 255);
}

function isSimpleHostname(host) {
  const h = String(host || '').trim();
  return h && !isIp(h) && !h.includes('.');
}

function getDnsSuffixes() {
  const raw = process.env.WMI_DNS_SUFFIXES || process.env.WMI_DNS_SUFFIX || '';
  const fromEnv = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return fromEnv.length ? fromEnv : DEFAULT_DNS_SUFFIXES;
}

/** Expand short hostnames with DNS suffixes (e.g. ome → ome.corp.helixops.ai). */
function expandHostCandidates(...hosts) {
  const seen = new Set();
  const out = [];

  const add = (h) => {
    const v = String(h || '').trim();
    if (!v || v === 'None' || seen.has(v.toLowerCase())) return;
    seen.add(v.toLowerCase());
    out.push(v);
  };

  for (const host of hosts) {
    const h = String(host || '').trim();
    if (!h) continue;
    add(h);
    if (isSimpleHostname(h)) {
      for (const suffix of getDnsSuffixes()) {
        add(`${h}.${suffix}`);
      }
    }
  }

  return out;
}

function getConnectTargets(vm) {
  if (typeof vm === 'string') {
    return expandHostCandidates(vm);
  }

  const seeds = [];
  if (vm?.ip && isValidIpv4(vm.ip)) seeds.push(vm.ip);
  if (vm?.fqdn) seeds.push(vm.fqdn);
  if (vm?.name) seeds.push(vm.name);
  return expandHostCandidates(...seeds);
}

async function resolveHost(host) {
  const candidates = expandHostCandidates(host);
  for (const target of candidates) {
    if (!target || target === 'None') continue;
    if (isIp(target)) return target;
    try {
      const { address } = await dns.lookup(target);
      if (address) return address;
    } catch {
      // try next suffix variant
    }
  }
  return null;
}

/** Resolve every connect target; map each seed to its first resolved address. */
async function resolveAllTargets(vm) {
  const targets = getConnectTargets(vm);
  const resolvedMap = {};
  for (const t of targets) {
    if (resolvedMap[t] !== undefined) continue;
    resolvedMap[t] = await resolveHost(t);
  }
  return { targets, resolvedMap };
}

function normalizeVmIdentity(name, ip, fqdn) {
  const n = String(name || '').trim();
  const i = String(ip || '').trim();
  const f = String(fqdn || '').trim();

  if (!n && !i) {
    return { error: 'hostname or ip is required' };
  }

  const resolvedName = n || i;
  let resolvedIp = '';
  if (i && isValidIpv4(i)) resolvedIp = i;
  else if (n && isValidIpv4(n)) resolvedIp = n;

  // FQDN only when dotted or explicitly provided — short names stay hostname-only
  const resolvedFqdn = f || (n && n.includes('.') && !isIp(n) ? n : '');

  return { name: resolvedName, ip: resolvedIp, fqdn: resolvedFqdn };
}

module.exports = {
  getConnectTargets,
  expandHostCandidates,
  resolveHost,
  resolveAllTargets,
  isIp,
  isValidIpv4,
  isSimpleHostname,
  getDnsSuffixes,
  normalizeVmIdentity,
  DEFAULT_INSTALL_ROOT,
};
