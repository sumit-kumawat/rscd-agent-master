const { isIp } = require('./hosts');
const wmiConfig = require('../config/wmi');

/** Connectivity states returned by probes — distinct from VM operational status. */
const CONNECTIVITY_STATES = {
  ONLINE: 'online',
  AUTH_FAILED: 'auth_failed',
  TIMEOUT: 'timeout',
  UNREACHABLE: 'unreachable',
  RELAY_UNAVAILABLE: 'relay_unavailable',
  WMI_UNAVAILABLE: 'wmi_unavailable',
  PERMISSION_DENIED: 'permission_denied',
  DNS_FAILED: 'dns_failed',
  OFFLINE: 'offline',
  UNKNOWN: 'unknown',
};

const FAILURE_CATEGORY_TO_KIND = {
  AUTHENTICATION_FAILED: 'auth_failed',
  AUTHORIZATION_FAILED: 'permission_denied',
  WMI_TIMEOUT: 'timeout',
  WMI_SERVICE_UNAVAILABLE: 'wmi_unavailable',
  RPC_UNREACHABLE: 'wmi_unavailable',
  SMB_UNREACHABLE: 'unreachable',
  SMB_TIMEOUT: 'timeout',
  TCP_TIMEOUT: 'unreachable',
  DNS_FAILURE: 'dns_failed',
  NETWORK_UNREACHABLE: 'unreachable',
  COMMAND_FAILED: 'unknown',
  UNKNOWN: 'unknown',
  auth_failed: 'auth_failed',
  permission_denied: 'permission_denied',
  wmi_timeout: 'timeout',
  wmi_unavailable: 'wmi_unavailable',
  unreachable: 'unreachable',
  rpc_unavailable: 'wmi_unavailable',
  smb_failed: 'auth_failed',
};

const { getPlatformCredentialChain } = require('../config/platformCredentials');

/**
 * Default platform credentials — used when RSCD_OS_USERS is unset.
 * Order: rdsroot → rdsmon → Administrator (Helix@dm1n, bmcAdm1n, #D3Pl0y_M3nT$)
 */
const DEFAULT_CREDENTIALS = getPlatformCredentialChain();

function parseCredentialPair(pair) {
  const i = pair.indexOf(':');
  if (i === -1) return null;
  const userPart = pair.slice(0, i).trim();
  const password = pair.slice(i + 1);
  if (!userPart || !password) return null;
  return normalizeIdentity({ raw: userPart, password });
}

function parseCredentials() {
  const raw = process.env.RSCD_OS_USERS;
  if (!raw) return DEFAULT_CREDENTIALS.map((c) => normalizeIdentity(c));
  const parsed = raw.split(',').map(parseCredentialPair).filter(Boolean);
  return parsed.length ? parsed : DEFAULT_CREDENTIALS.map((c) => normalizeIdentity(c));
}

/**
 * Normalize a Windows identity once — supports DOMAIN\user, DOMAIN/user, user@domain, or plain user.
 */
function normalizeIdentity({ raw, username, password, domain }) {
  let user = (username || raw || '').trim();
  let dom = (domain || '').trim() || null;

  if (user.includes('\\')) {
    const idx = user.indexOf('\\');
    dom = user.slice(0, idx).trim() || dom;
    user = user.slice(idx + 1).trim();
  } else if (user.includes('/')) {
    const idx = user.indexOf('/');
    dom = user.slice(0, idx).trim() || dom;
    user = user.slice(idx + 1).trim();
  } else if (user.includes('@')) {
    const idx = user.lastIndexOf('@');
    const maybeDomain = user.slice(idx + 1).trim();
    user = user.slice(0, idx).trim();
    if (maybeDomain && !isIp(maybeDomain)) dom = maybeDomain;
  }

  if (!dom && wmiConfig.defaultDomain) dom = wmiConfig.defaultDomain;

  const label = dom ? `${dom}\\${user}` : user;
  return {
    username: user,
    password: password || '',
    domain: dom || null,
    label,
  };
}

function resolveCredentialForVm(vm, globalCredentials) {
  const globals = globalCredentials || parseCredentials();

  if (vm?.wmiUsername && vm?.wmiPassword) {
    return normalizeIdentity({
      username: vm.wmiUsername,
      password: vm.wmiPassword,
      domain: vm.wmiDomain || null,
    });
  }

  if (vm?.wmiUsername) {
    const match = globals.find((c) => c.username.toLowerCase() === String(vm.wmiUsername).toLowerCase());
    if (match) {
      return normalizeIdentity({
        username: match.username,
        password: match.password,
        domain: vm.wmiDomain || match.domain || null,
      });
    }
    throw new Error(
      `No password configured for WMI user "${vm.wmiUsername}" — set password in Edit VM or RSCD_OS_USERS`,
    );
  }

  if (!globals.length) {
    throw new Error('No WMI credentials configured — set RSCD_OS_USERS or per-VM credentials in Edit VM');
  }

  return { ...globals[0] };
}

/**
 * Ordered credential list for a VM — tries each on authentication failure (no domain permutation).
 */
function resolveCredentialsForVm(vm, globalCredentials) {
  const globals = globalCredentials || parseCredentials();

  if (vm?.wmiUsername && vm?.wmiPassword) {
    return [normalizeIdentity({
      username: vm.wmiUsername,
      password: vm.wmiPassword,
      domain: vm.wmiDomain || null,
    })];
  }

  if (!globals.length) {
    throw new Error('No WMI credentials configured — set RSCD_OS_USERS or per-VM credentials in Edit VM');
  }

  if (vm?.wmiUsername) {
    const preferred = String(vm.wmiUsername).toLowerCase();
    const ordered = [];
    const seen = new Set();

    const pushCred = (c) => {
      const norm = normalizeIdentity({
        username: c.username,
        password: c.password,
        domain: vm.wmiDomain || c.domain || null,
      });
      const key = `${norm.domain || ''}\\${norm.username}:${norm.password}`;
      if (seen.has(key)) return;
      seen.add(key);
      ordered.push(norm);
    };

    for (const c of globals) {
      if (c.username.toLowerCase() === preferred) pushCred(c);
    }
    for (const c of globals) pushCred(c);

    if (!ordered.length) {
      throw new Error(
        `No password configured for WMI user "${vm.wmiUsername}" — set password in Edit VM or RSCD_OS_USERS`,
      );
    }
    return ordered;
  }

  return globals.map((c) => ({ ...c }));
}

function resolveWmiTarget(vm, resolvedMap = {}) {
  const fqdn = (vm?.fqdn || '').trim();
  const name = (vm?.name || '').trim();
  const ip = (vm?.ip || '').trim();

  let primary = fqdn || (name.includes('.') ? name : '');

  if (!primary && name) {
    for (const [cand, resolvedIp] of Object.entries(resolvedMap)) {
      if (cand.toLowerCase().startsWith(`${name.toLowerCase()}.`) && resolvedIp && isIp(resolvedIp)) {
        primary = cand;
        break;
      }
    }
    if (!primary) primary = name;
  }

  if (!primary && isIp(ip)) primary = ip;

  if (!primary) {
    throw new Error('VM has no hostname, FQDN, or IP for WMI target');
  }

  let fallbackIp = null;
  if (isIp(ip) && ip !== primary) {
    fallbackIp = ip;
  } else {
    for (const [cand, resolved] of Object.entries(resolvedMap)) {
      if (resolved && isIp(resolved) && resolved !== primary) {
        fallbackIp = resolved;
        break;
      }
    }
  }

  if (!wmiConfig.allowIpFallback) fallbackIp = null;
  if (fallbackIp && fallbackIp === primary) fallbackIp = null;

  return { primary, fallbackIp, label: primary };
}

/** Ordered WMI targets — FQDN variants before bare short names, IP last. */
function listWmiTargetCandidates(vm, resolvedMap = {}) {
  const { getConnectTargets } = require('./hosts');
  const seeds = getConnectTargets(vm);
  const { primary, fallbackIp } = resolveWmiTarget(vm, resolvedMap);
  const ordered = [];
  const seen = new Set();

  const add = (h) => {
    const v = String(h || '').trim();
    const key = v.toLowerCase();
    if (!v || seen.has(key)) return;
    seen.add(key);
    ordered.push(v);
  };

  add(primary);
  for (const c of seeds) {
    if (c.includes('.') && resolvedMap[c]) add(c);
  }
  for (const c of seeds) add(c);
  if (fallbackIp) add(fallbackIp);

  return ordered.length ? ordered : [primary];
}

function classifyWmiError(message) {
  const msg = String(message || '');
  if (/relay unreachable|relay connection lost|relay timed out|ECONNREFUSED.*19500/i.test(msg)) {
    return 'relay_unavailable';
  }
  if (/ENOTFOUND|getaddrinfo|DNS|could not resolve|name resolution/i.test(msg)) return 'dns_failed';
  if (/ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|network unreachable|No route to host|TCP timeout/i.test(msg)) {
    return 'unreachable';
  }
  if (/timed out|timeout after \d+ms/i.test(msg)) return 'timeout';
  if (/STATUS_ACCOUNT_DISABLED|account.*disabled/i.test(msg)) return 'account_disabled';
  if (/STATUS_ACCOUNT_LOCKED|account.*locked/i.test(msg)) return 'account_locked';
  if (/LOGON_FAILURE|STATUS_LOGON_FAILURE|invalid logon|authentication failed|SMB authentication failed/i.test(msg)) {
    return 'auth_failed';
  }
  if (/Access is denied|STATUS_ACCESS_DENIED|permission denied|authorization failed|insufficient privileges/i.test(msg)) {
    return 'permission_denied';
  }
  if (/stringBinding|RPC_S_|RPC unavailable|DCOM|WMI.*unavailable|dynamic ports/i.test(msg)) {
    return 'wmi_unavailable';
  }
  if (/SMB SessionError|connection reset|broken pipe/i.test(msg)) return 'wmi_unavailable';
  return 'unknown';
}

function kindFromFailureCategory(category) {
  if (!category) return null;
  return FAILURE_CATEGORY_TO_KIND[String(category).toUpperCase()]
    || FAILURE_CATEGORY_TO_KIND[String(category).toLowerCase()]
    || null;
}

function connectivityFromErrorKind(kind) {
  const map = {
    auth_failed: CONNECTIVITY_STATES.AUTH_FAILED,
    account_disabled: CONNECTIVITY_STATES.AUTH_FAILED,
    account_locked: CONNECTIVITY_STATES.AUTH_FAILED,
    timeout: CONNECTIVITY_STATES.TIMEOUT,
    unreachable: CONNECTIVITY_STATES.UNREACHABLE,
    relay_unavailable: CONNECTIVITY_STATES.RELAY_UNAVAILABLE,
    dns_failed: CONNECTIVITY_STATES.DNS_FAILED,
    wmi_unavailable: CONNECTIVITY_STATES.WMI_UNAVAILABLE,
    permission_denied: CONNECTIVITY_STATES.PERMISSION_DENIED,
    unknown: CONNECTIVITY_STATES.UNKNOWN,
  };
  return map[kind] || CONNECTIVITY_STATES.UNKNOWN;
}

function sanitizeErrorMessage(message, passwords = []) {
  let out = String(message || '');
  for (const pw of passwords) {
    if (pw && pw.length > 0) out = out.split(pw).join('***');
  }
  out = out.replace(/:[^@\s]+@/g, ':***@');
  return out.slice(0, 500);
}

function formatUserFacingError(kind, vmLabel, detail) {
  const safeDetail = sanitizeErrorMessage(detail);
  switch (kind) {
    case 'auth_failed':
    case 'account_disabled':
    case 'account_locked':
      return `WMI authentication failed for ${vmLabel} — invalid Windows credentials or domain`;
    case 'timeout':
      return `WMI/DCOM timed out for ${vmLabel} — SMB may work but remote WMI did not respond within the configured timeout`;
    case 'unreachable':
      return `WMI target unreachable for ${vmLabel} — TCP/SMB ports not reachable from relay host`;
    case 'relay_unavailable':
      return 'WMI relay unavailable — run ./scripts/start-wmi-relay.sh on the host';
    case 'dns_failed':
      return `DNS resolution failed for ${vmLabel}`;
    case 'wmi_unavailable':
      return `WMI/DCOM unavailable on ${vmLabel} — check Windows Firewall and DCOM dynamic RPC ports (49152-65535)`;
    case 'permission_denied':
      return `WMI access denied on ${vmLabel} — credentials accepted but insufficient privileges`;
    default:
      return safeDetail ? `WMI failed for ${vmLabel} — ${safeDetail}` : `WMI failed for ${vmLabel}`;
  }
}

function isRetryableWithIpFallback(kind) {
  return ['timeout', 'wmi_unavailable', 'dns_failed', 'unreachable', 'unknown'].includes(kind);
}

function credentialLogLabel(cred) {
  return `${cred.label}@${cred.host || 'target'}`;
}

module.exports = {
  CONNECTIVITY_STATES,
  FAILURE_CATEGORY_TO_KIND,
  parseCredentials,
  normalizeIdentity,
  resolveCredentialForVm,
  resolveCredentialsForVm,
  resolveWmiTarget,
  listWmiTargetCandidates,
  classifyWmiError,
  kindFromFailureCategory,
  connectivityFromErrorKind,
  sanitizeErrorMessage,
  formatUserFacingError,
  isRetryableWithIpFallback,
  credentialLogLabel,
};
