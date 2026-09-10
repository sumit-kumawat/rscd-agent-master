const logger = require('../utils/logger');
const { isValidIpv4, DEFAULT_INSTALL_ROOT } = require('../utils/hosts');
const { resolveAllTargetsFast } = require('../utils/dnsCache');
const { runWmiPowershell, runWmiCmd, WMI_CONNECT_TIMEOUT } = require('../utils/wmiExec');
const {
  parseCredentials,
  expandCredentialVariants,
  getWmiConnectTargets,
  buildWmiAttempts,
  classifyWmiError,
  summarizeWmiFailure,
} = require('../utils/wmiCredentials');
const { toVmPlain } = require('../utils/vmPlain');

const RSCD_ROOT = DEFAULT_INSTALL_ROOT;
const CANDIDATE_ROOTS = [
  RSCD_ROOT,
  'C:\\Program Files\\BMC Software\\BladeLogic\\NSH',
  'C:\\Program Files\\BMC Software\\BladeLogic',
  'C:\\Program Files\\RSCD',
];

/** Lightweight probe — no registry uninstall scan, no Get-NetAdapter (much faster over WMI). */
const PROBE_SCRIPT = [
  '$ErrorActionPreference="SilentlyContinue"',
  '$ip=""',
  '$cfg=Get-CimInstance Win32_NetworkAdapterConfiguration -Filter "IPEnabled=True" -EA 0 | Select-Object -First 3',
  'foreach($c in $cfg){ foreach($a in $c.IPAddress){ if($a -match "^\\d+\\.\\d+\\.\\d+\\.\\d+$" -and $a -notmatch "^127\\." -and $a -notmatch "^169\\.254\\."){ $ip=$a; break } } if($ip){break} }',
  'Write-Output ("IP:" + $ip)',
  '$installed=$false; $version="unknown"; $installRoot=""',
  'if(Get-Service -Name RSCD -EA 0){ $installed=$true }',
  `$roots=@('${CANDIDATE_ROOTS.map((r) => r.replace(/'/g, "''")).join("','")}')`,
  'foreach($r in $roots){ if(Test-Path $r){ $installRoot=$r; $vf=Join-Path $r "VERSION"; if(Test-Path $vf){ $v=(Get-Content $vf -Raw -EA 0).Trim(); if($v){ $version=$v; $installed=$true } } elseif(-not $installed){ $installed=$true }; break } }',
  'foreach($k in "HKLM:\\SOFTWARE\\BladeLogic\\RSCD Agent","HKLM:\\SOFTWARE\\WOW6432Node\\BladeLogic\\RSCD Agent"){ $p=Get-ItemProperty $k -EA 0; if($p){ $installed=$true; if($p.InstallDir){ $installRoot=$p.InstallDir } } }',
  'if($installed){ Write-Output "AGENT:active"; Write-Output ("VERSION:" + $version); Write-Output ("INSTALLROOT:" + $installRoot) } else { Write-Output "AGENT:removed" }',
].join('\n');

const CONNECT_SCRIPT = 'echo WMI_OK';

function parseProbeOutput(stdout) {
  const result = {
    ip: '',
    agentStatus: 'removed',
    version: 'unknown',
    installRoot: '',
  };
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('IP:')) result.ip = t.slice(3).trim();
    else if (t.startsWith('AGENT:')) result.agentStatus = t.slice(6).trim() === 'active' ? 'active' : 'removed';
    else if (t.startsWith('VERSION:')) result.version = t.slice(8).trim() || 'unknown';
    else if (t.startsWith('INSTALLROOT:')) result.installRoot = t.slice(12).trim();
  }
  if (result.ip && !isValidIpv4(result.ip)) result.ip = '';
  return result;
}

class AgentProbeService {
  constructor() {
    this.credentials = parseCredentials();
    this.inFlight = new Map();
    /** @type {Map<string, {host,username,password,domain}>} */
    this.sessionCache = new Map();
    this.cacheTtl = parseInt(process.env.WMI_SESSION_CACHE_MS || '600000', 10);
    this.cacheExpiry = new Map();
  }

  _cacheKey(vm) {
    return String(vm._id || vm.id || vm.name || '').toLowerCase();
  }

  _getCachedSession(vm) {
    const key = this._cacheKey(vm);
    const exp = this.cacheExpiry.get(key);
    if (!exp || exp < Date.now()) {
      this.sessionCache.delete(key);
      this.cacheExpiry.delete(key);
      return null;
    }
    return this.sessionCache.get(key) || null;
  }

  _cacheSession(vm, session) {
    const key = this._cacheKey(vm);
    this.sessionCache.set(key, session);
    this.cacheExpiry.set(key, Date.now() + this.cacheTtl);
  }

  _credentialsForVm(vm) {
    const list = [];
    if (vm?.wmiUsername && vm?.wmiPassword) {
      list.push({
        username: vm.wmiUsername,
        password: vm.wmiPassword,
        domain: vm.wmiDomain || null,
        label: vm.wmiDomain ? `${vm.wmiDomain}\\${vm.wmiUsername}` : vm.wmiUsername,
      });
    }
    // Prioritize last-known working user from prior probe
    if (vm?.wmiUsername && !vm?.wmiPassword) {
      const match = this.credentials.find((c) => c.username === vm.wmiUsername);
      if (match) {
        list.push({ ...match, domain: vm.wmiDomain || match.domain || null, label: vm.wmiUsername });
      }
    }
    for (const cred of this.credentials) {
      if (!list.some((c) => c.username === cred.username && c.password === cred.password)) {
        list.push(cred);
      }
    }
    return list.length ? list : this.credentials;
  }

  async _trySession(host, cred) {
    await runWmiCmd(host, cred.username, cred.password, CONNECT_SCRIPT, cred.domain || null, WMI_CONNECT_TIMEOUT);
    return {
      host,
      username: cred.username,
      password: cred.password,
      domain: cred.domain || null,
    };
  }

  async connectWmi(vm) {
    const plain = toVmPlain(vm);
    const label = plain.name || plain.fqdn || 'VM';

    const cached = this._getCachedSession(plain);
    if (cached) {
      try {
        await runWmiCmd(cached.host, cached.username, cached.password, CONNECT_SCRIPT, cached.domain, WMI_CONNECT_TIMEOUT);
        return cached;
      } catch {
        this.sessionCache.delete(this._cacheKey(plain));
      }
    }

    const errors = [];
    const { resolvedMap } = await resolveAllTargetsFast(plain);
    const wmiTargets = getWmiConnectTargets(plain, resolvedMap);
    const credVariants = expandCredentialVariants(this._credentialsForVm(plain), plain);
    const attempts = buildWmiAttempts(wmiTargets, credVariants, resolvedMap);
    const blockedUsers = new Set();

    for (const { host, cred } of attempts) {
      if (blockedUsers.has(cred.username)) continue;
      try {
        const session = await this._trySession(host, cred);
        this._cacheSession(plain, session);
        logger.info(`WMI connected to ${label} as ${cred.label}@${host}`);
        return session;
      } catch (err) {
        const kind = classifyWmiError(err.message);
        if (kind === 'account_disabled') blockedUsers.add(cred.username);
        errors.push(`${cred.label}@${host}: ${err.message}`);
        logger.debug(`WMI ${label} ${errors[errors.length - 1]}`);
      }
    }

    throw new Error(summarizeWmiFailure(label, errors));
  }

  async _probeSession(session) {
    const r = await runWmiPowershell(
      session.host,
      session.username,
      session.password,
      PROBE_SCRIPT,
      session.domain || null,
    );
    return parseProbeOutput(r.stdout);
  }

  async probe(vm) {
    const plain = toVmPlain(vm);
    const label = plain.name || plain.fqdn || 'VM';

    try {
      const session = await this.connectWmi(plain);
      const data = await this._probeSession(session);

      return {
        connectivity: 'online',
        agentStatus: data.agentStatus,
        ip: data.ip || (isValidIpv4(plain.ip) ? plain.ip : ''),
        version: data.agentStatus === 'removed' ? 'removed' : data.version,
        installRoot: data.installRoot || plain.installRoot || RSCD_ROOT,
        wmiUser: session.username,
        wmiHost: session.host,
        wmiDomain: session.domain || '',
        error: null,
        checkedAt: new Date(),
      };
    } catch (err) {
      logger.debug(`Probe failed for ${label}: ${err.message}`);
      return {
        connectivity: 'offline',
        agentStatus: plain.agentStatus || 'active',
        ip: isValidIpv4(plain.ip) ? plain.ip : '',
        version: plain.version,
        installRoot: plain.installRoot,
        wmiUser: null,
        wmiHost: null,
        wmiDomain: '',
        error: err.message,
        checkedAt: new Date(),
      };
    }
  }

  probeWithDedup(vm) {
    const id = String(vm._id || vm.id || vm.name);
    if (this.inFlight.has(id)) return this.inFlight.get(id);
    const promise = this.probe(vm).finally(() => this.inFlight.delete(id));
    this.inFlight.set(id, promise);
    return promise;
  }

  async probeOnSession(session) {
    const data = await this._probeSession(session);
    const codes = await this._getProductCodes(session);
    return {
      ...data,
      installed: data.agentStatus === 'active',
      codes,
      installRoots: data.installRoot ? [data.installRoot] : CANDIDATE_ROOTS,
    };
  }

  async _getProductCodes(session) {
    const codes = new Set();
    const regKeys = [
      'HKLM\\SOFTWARE\\BladeLogic\\RSCD Agent',
      'HKLM\\SOFTWARE\\WOW6432Node\\BladeLogic\\RSCD Agent',
    ];
    const domain = session.domain || null;
    for (const key of regKeys) {
      try {
        const r = await runWmiCmd(session.host, session.username, session.password, `reg query "${key}" /v ProductCode`, domain, WMI_CONNECT_TIMEOUT);
        const matches = String(r.stdout || '').match(/\{[0-9A-Fa-f-]{36}\}/g) || [];
        matches.forEach((g) => codes.add(g));
      } catch {
        // key may not exist
      }
    }
    return [...codes];
  }
}

module.exports = new AgentProbeService();
