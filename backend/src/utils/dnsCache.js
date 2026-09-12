const dns = require('dns').promises;
const { expandHostCandidates, isIp } = require('./hosts');

const TTL_MS = parseInt(process.env.DNS_CACHE_TTL_MS || '300000', 10);
const cache = new Map();

function getCached(host) {
  const key = String(host || '').toLowerCase();
  const hit = cache.get(key);
  if (!hit || hit.expires < Date.now()) return null;
  return hit.value;
}

function setCached(host, value) {
  const key = String(host || '').toLowerCase();
  cache.set(key, { value, expires: Date.now() + TTL_MS });
}

async function resolveHostCached(host) {
  const candidates = expandHostCandidates(host);
  for (const target of candidates) {
    if (!target || target === 'None') continue;
    if (isIp(target)) return target;

    const cached = getCached(target);
    if (cached) return cached;

    try {
      const { address } = await dns.lookup(target);
      if (address) {
        setCached(target, address);
        return address;
      }
    } catch {
      setCached(target, null);
    }
  }
  return null;
}

/** Resolve targets in parallel with TTL cache. */
async function resolveAllTargetsFast(vm) {
  const { getConnectTargets } = require('./hosts');
  const targets = getConnectTargets(vm);
  const unique = [...new Set(targets.map((t) => String(t).trim()).filter(Boolean))];
  const toResolve = unique.filter((t) => !isIp(t));

  const resolved = await Promise.all(
    toResolve.map(async (t) => [t, await resolveHostCached(t)])
  );

  const resolvedMap = {};
  for (const t of unique) {
    if (isIp(t)) resolvedMap[t] = t;
  }
  for (const [t, ip] of resolved) {
    resolvedMap[t] = ip;
  }
  return { targets: unique, resolvedMap };
}

module.exports = { resolveHostCached, resolveAllTargetsFast, getCached, setCached };
