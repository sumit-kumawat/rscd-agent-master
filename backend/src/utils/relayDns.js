const dns = require('dns').promises;
const { expandHostCandidates, isIp } = require('./hosts');

/**
 * Resolve a WMI target on the relay host (Mac with VPN) — not inside Docker.
 * Expands short names with WMI_DNS_SUFFIXES before lookup.
 */
async function resolveRelayTarget(host) {
  const raw = String(host || '').trim();
  if (!raw) {
    return { host: raw, resolvedHost: raw, resolvedIp: null, candidates: [] };
  }

  const candidates = expandHostCandidates(raw);
  for (const cand of candidates) {
    if (isIp(cand)) {
      return { host: raw, resolvedHost: cand, resolvedIp: cand, candidates };
    }
    try {
      const { address } = await dns.lookup(cand);
      if (address) {
        return { host: raw, resolvedHost: cand, resolvedIp: address, candidates };
      }
    } catch {
      // try next DNS suffix variant
    }
  }

  return { host: raw, resolvedHost: raw, resolvedIp: null, candidates };
}

module.exports = { resolveRelayTarget };
