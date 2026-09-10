const { expandHostCandidates, isSimpleHostname, isIp } = require('./hosts');

const CREDENTIALS = [
  { username: 'rdsroot', password: process.env.RDSROOT_PASSWORD || '1Rs50U$D' },
  { username: 'rdsmon', password: process.env.RDSMON_PASSWORD || 'D0N0harm' },
  { username: 'Administrator', password: 'bmcAdm1n' },
  { username: 'Administrator', password: '#D3Pl0y_M3nT$' },
  { username: 'Administrator', password: 'bmcAdm1n@123' },
];

function parseCredentials() {
  const raw = process.env.RSCD_OS_USERS;
  if (!raw) return CREDENTIALS;
  const parsed = raw.split(',').map((pair) => {
    const i = pair.indexOf(':');
    if (i === -1) return null;
    const userPart = pair.slice(0, i).trim();
    const password = pair.slice(i + 1);
    const slash = userPart.indexOf('\\');
    const slashFwd = userPart.indexOf('/');
    if (slash > 0) {
      return { domain: userPart.slice(0, slash), username: userPart.slice(slash + 1), password };
    }
    if (slashFwd > 0) {
      return { domain: userPart.slice(0, slashFwd), username: userPart.slice(slashFwd + 1), password };
    }
    return { username: userPart, password };
  }).filter(Boolean);
  return parsed.length ? parsed : CREDENTIALS;
}

/** At most 2 domain variants — fewer WMI retries = faster checks. */
function getCredentialDomains(vm) {
  const domains = [];
  if (vm?.wmiDomain) domains.push(vm.wmiDomain);
  else if (process.env.WMI_DEFAULT_DOMAIN) domains.push(process.env.WMI_DEFAULT_DOMAIN);

  const fqdn = vm?.fqdn || (vm?.name?.includes('.') ? vm.name : '');
  if (!vm?.wmiDomain && fqdn && fqdn.includes('.')) {
    const parts = fqdn.toLowerCase().split('.').filter(Boolean);
    if (parts[1]) domains.push(parts[1].toUpperCase());
  }

  return [...new Set(domains.filter(Boolean))].slice(0, 2);
}

function expandCredentialVariants(credentials, vm) {
  const domains = getCredentialDomains(vm);
  const seen = new Set();
  const variants = [];

  const add = (cred) => {
    const key = `${cred.domain || ''}|${cred.username}|${cred.password}`;
    if (seen.has(key)) return;
    seen.add(key);
    variants.push(cred);
  };

  for (const cred of credentials) {
    if (cred.domain) {
      add({ ...cred, label: `${cred.domain}\\${cred.username}` });
      continue;
    }
    add({ ...cred, label: cred.username });
    for (const domain of domains) {
      add({ ...cred, domain, label: `${domain}\\${cred.username}` });
    }
  }

  return variants;
}

/**
 * Build WMI attempts: for each credential, try hostname then IP immediately.
 * Fixes hosts where FQDN fails (stringBinding) but IP works (e.g. spectrocloud-ic).
 */
function buildWmiAttempts(wmiTargets, credVariants, resolvedMap) {
  const hostnames = [];
  const ips = new Set();
  const seen = new Set();

  const track = (t) => {
    const v = String(t || '').trim();
    if (!v || seen.has(v.toLowerCase())) return;
    seen.add(v.toLowerCase());
    if (isIp(v)) ips.add(v);
    else hostnames.push(v);
  };

  for (const t of wmiTargets) track(t);
  for (const ip of Object.values(resolvedMap || {})) track(ip);

  const ipList = [...ips];
  const attempts = [];
  const attemptKeys = new Set();

  const push = (host, cred) => {
    const key = `${cred.domain || ''}|${cred.username}|${host}`;
    if (attemptKeys.has(key)) return;
    attemptKeys.add(key);
    attempts.push({ host, cred });
  };

  // IP-first when available — faster on hosts where FQDN stringBinding fails
  for (const cred of credVariants) {
    for (const ip of ipList) push(ip, cred);
    for (const host of hostnames) push(host, cred);
  }

  const max = parseInt(process.env.WMI_MAX_ATTEMPTS || '12', 10);
  return attempts.slice(0, max);
}

function classifyWmiError(message) {
  const msg = String(message || '');
  if (/STATUS_ACCOUNT_DISABLED/i.test(msg)) return 'account_disabled';
  if (/stringBinding/i.test(msg)) return 'string_binding';
  if (/LOGON_FAILURE|STATUS_LOGON_FAILURE/i.test(msg)) return 'logon_failure';
  if (/Access is denied/i.test(msg)) return 'access_denied';
  return 'other';
}

function summarizeWmiFailure(label, errors) {
  const types = errors.map((e) => classifyWmiError(e));
  const allDisabled = errors.length > 0 && types.every((t) => t === 'account_disabled');
  if (allDisabled) {
    return `WMI accounts disabled on ${label} — rdsroot/rdsmon cannot log on. `
      + 'Enable the account on the host, or set per-VM WMI credentials under Edit VM.';
  }

  const disabledUsers = new Set();
  for (const e of errors) {
    if (!/STATUS_ACCOUNT_DISABLED/i.test(e)) continue;
    const m = e.match(/^([^@\\]+(?:\\[^@]+)?)@/);
    if (m) disabledUsers.add(m[1]);
  }
  if (disabledUsers.size > 0) {
    const users = [...disabledUsers].join(', ');
    return `WMI failed for ${label} — account(s) disabled: ${users}. `
      + 'Use Edit VM → WMI credentials override, or enable the account on the host.';
  }

  const detail = errors.slice(-2).join('; ') || 'no reachable WMI endpoint';
  return `WMI authentication failed for ${label} — ${detail}`;
}

/** Prefer FQDN/hostname for WMI auth (SPN); fall back to resolved IP. */
function getWmiConnectTargets(vm, resolvedByTarget) {
  const seeds = [];
  if (vm?.name) seeds.push(vm.name);
  if (vm?.fqdn) seeds.push(vm.fqdn);
  if (vm?.ip && isIp(vm.ip)) seeds.push(vm.ip);

  for (const [target, resolved] of Object.entries(resolvedByTarget || {})) {
    seeds.push(target);
    if (resolved) seeds.push(resolved);
  }

  const expanded = expandHostCandidates(...seeds);
  const hostnames = [];
  const ips = [];
  const seen = new Set();

  const add = (t, bucket) => {
    const v = String(t || '').trim();
    if (!v || seen.has(v.toLowerCase())) return;
    seen.add(v.toLowerCase());
    bucket.push(v);
  };

  for (const t of expanded) {
    if (isIp(t)) add(t, ips);
    else add(t, hostnames);
  }

  return [...hostnames, ...ips];
}

module.exports = {
  parseCredentials,
  getCredentialDomains,
  expandCredentialVariants,
  getWmiConnectTargets,
  buildWmiAttempts,
  classifyWmiError,
  summarizeWmiFailure,
};
