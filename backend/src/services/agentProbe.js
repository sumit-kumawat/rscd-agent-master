const logger = require('../utils/logger');
const { isValidIpv4, DEFAULT_INSTALL_ROOT } = require('../utils/hosts');
const { resolveAllTargetsFast } = require('../utils/dnsCache');
const {
  runWmiPowershell,
  runWmiCmd,
  checkWmiRelay,
  runWmiProbe,
  WMI_CONNECT_TIMEOUT,
  WMI_TIMEOUT,
} = require('../utils/wmiExec');
const {
  parseCredentials,
  resolveCredentialForVm,
  resolveCredentialsForVm,
  resolveWmiTarget,
  listWmiTargetCandidates,
  classifyWmiError,
  kindFromFailureCategory,
  connectivityFromErrorKind,
  formatUserFacingError,
  isRetryableWithIpFallback,
  sanitizeErrorMessage,
  CONNECTIVITY_STATES,
} = require('../utils/wmiCredentials');
const { buildDiagnosticsPreflight, applyProbeResult, mergeStageProbe } = require('./wmiDiagnostics');
const wmiConfig = require('../config/wmi');
const { toVmPlain } = require('../utils/vmPlain');

const RSCD_ROOT = DEFAULT_INSTALL_ROOT;
const CANDIDATE_ROOTS = [
  RSCD_ROOT,
  'C:\\Program Files\\BMC Software\\BladeLogic\\NSH',
  'C:\\Program Files\\BMC Software\\BladeLogic',
  'C:\\Program Files\\RSCD',
];

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

function shouldSkipIpFallback(primary, fallbackIp, resolvedMap) {
  if (!fallbackIp || fallbackIp === primary) return true;
  const resolvedPrimary = resolvedMap[primary];
  if (resolvedPrimary && resolvedPrimary === fallbackIp) return true;
  return false;
}

function errorFromStageProbe(probeResult, label) {
  const category = probeResult.failureCategory || 'UNKNOWN';
  const kind = kindFromFailureCategory(category) || classifyWmiError(probeResult.error || '');
  const msg = probeResult.error || probeResult.overall?.detail || formatUserFacingError(kind, label, probeResult.error);
  return { kind, msg, category, probeResult };
}

class AgentProbeService {
  constructor() {
    this.credentials = parseCredentials();
    this.inFlight = new Map();
    /** @type {Map<string, {host,username,password,domain}>} */
    this.sessionCache = new Map();
    this.cacheTtl = wmiConfig.sessionCacheMs;
    this.cacheExpiry = new Map();
    this.relayOk = true;
    this.relayCheckedAt = 0;
  }

  async _ensureRelay() {
    if (!wmiConfig.relayUrl) return;
    const now = Date.now();
    if (now - this.relayCheckedAt < 15000) {
      if (!this.relayOk) {
        throw new Error('WMI relay unavailable — run ./scripts/start-wmi-relay.sh on the host');
      }
      return;
    }
    this.relayCheckedAt = now;
    this.relayOk = await checkWmiRelay();
    if (!this.relayOk) {
      throw new Error('WMI relay unavailable — run ./scripts/start-wmi-relay.sh on the host');
    }
  }

  _cacheKey(vm) {
    return String(vm._id || vm.id || vm.name || '').toLowerCase();
  }

  clearSession(vm) {
    const key = this._cacheKey(vm);
    this.sessionCache.delete(key);
    this.cacheExpiry.delete(key);
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

  async _stageProbe(host, cred, timeoutMs, options = {}) {
    return runWmiProbe(host, cred.username, cred.password, cred.domain || null, {
      timeoutMs,
      smbOnly: !!options.smbOnly,
      wmi: options.wmi !== false,
    });
  }

  /**
   * Validate WMI via staged DCOM probe (fast, ~1s). wmiexec SMB output capture often hangs
   * on BMC hosts even when DCOM login works — use wmiexec only for command execution (uninstall).
   */
  async _tryConnect(host, cred, timeoutMs = WMI_CONNECT_TIMEOUT) {
    const stage = await this._stageProbe(host, cred, timeoutMs, { wmi: true });
    if (!stage.ok) {
      const { kind, msg } = errorFromStageProbe(stage, host);
      const err = new Error(formatUserFacingError(kind, host, msg));
      err.errorKind = kind;
      throw err;
    }
    return {
      host,
      username: cred.username,
      password: cred.password,
      domain: cred.domain || null,
    };
  }

  async _connectAtHost(host, creds, timeoutMs, label) {
    let lastAuthErr = null;
    for (const cred of creds) {
      try {
        return await this._tryConnect(host, cred, timeoutMs);
      } catch (err) {
        const kind = classifyWmiError(err.message);
        if (kind === 'auth_failed') {
          logger.debug(`WMI ${label}: auth failed as ${cred.label}@${host}`);
          lastAuthErr = err;
          continue;
        }
        throw err;
      }
    }
    throw lastAuthErr || new Error(`WMI authentication failed for ${label}`);
  }

  _sessionLabel(session) {
    const who = session.domain ? `${session.domain}\\${session.username}` : session.username;
    return `${who}@${session.host}`;
  }

  async connectWmi(vm) {
    const plain = toVmPlain(vm);
    const label = plain.name || plain.fqdn || 'VM';

    await this._ensureRelay();

    const creds = resolveCredentialsForVm(plain, this.credentials);
    const timeoutMs = WMI_CONNECT_TIMEOUT;

    const cached = this._getCachedSession(plain);
    if (cached) {
      try {
        await this._tryConnect(cached.host, cached, timeoutMs);
        return cached;
      } catch {
        this.sessionCache.delete(this._cacheKey(plain));
      }
    }

    const { resolvedMap } = await resolveAllTargetsFast(plain);
    const targets = listWmiTargetCandidates(plain, resolvedMap);

    logger.debug(
      `WMI connect ${label}: ${creds.length} credential(s), targets [${targets.join(', ')}] `
      + `(timeout ${timeoutMs}ms)`,
    );

    let lastErr = null;
    for (const targetHost of targets) {
      try {
        const session = await this._connectAtHost(targetHost, creds, timeoutMs, label);
        this._cacheSession(plain, session);
        logger.info(`WMI connected to ${label} as ${this._sessionLabel(session)}`);
        return session;
      } catch (err) {
        lastErr = err;
        const kind = classifyWmiError(err.message);
        if (kind === 'auth_failed') break;
        if (targetHost !== targets[targets.length - 1]) {
          logger.debug(`WMI ${label}: ${targetHost} failed (${kind}), trying next target`);
        }
      }
    }

    const kind = classifyWmiError(lastErr?.message || '');
    if (kind === 'relay_unavailable') {
      this.relayOk = false;
    }
    throw new Error(formatUserFacingError(kind, label, lastErr?.message || 'WMI connection failed'));
  }

  async _probeSession(session, timeoutMs = wmiConfig.agentInventoryTimeoutMs) {
    const r = await runWmiPowershell(
      session.host,
      session.username,
      session.password,
      PROBE_SCRIPT,
      session.domain || null,
      timeoutMs,
    );
    return parseProbeOutput(r.stdout);
  }

  async probe(vm, options = {}) {
    const plain = toVmPlain(vm);
    const label = plain.name || plain.fqdn || 'VM';
    const lightweight = options.lightweight ?? wmiConfig.monitorLightweight;
    let diagnostics = await buildDiagnosticsPreflight(plain, this.credentials);
    const { resolvedMap } = await resolveAllTargetsFast(plain);
    const resolvedIp = Object.values(resolvedMap).find((v) => isValidIpv4(v)) || '';

    try {
      const session = await this.connectWmi(plain);
      let data;
      if (lightweight) {
        data = {
          agentStatus: plain.agentStatus || 'active',
          ip: resolvedIp || (isValidIpv4(plain.ip) ? plain.ip : ''),
          version: plain.version || 'unknown',
          installRoot: plain.installRoot || RSCD_ROOT,
        };
      } else {
        try {
          data = await this._probeSession(session);
        } catch (invErr) {
          logger.debug(`Inventory script warning for ${label}: ${invErr.message}`);
          data = {
            agentStatus: plain.agentStatus || 'active',
            ip: resolvedIp || (isValidIpv4(plain.ip) ? plain.ip : ''),
            version: plain.version || 'unknown',
            installRoot: plain.installRoot || RSCD_ROOT,
          };
        }
      }
      diagnostics = applyProbeResult(diagnostics, null, true);

      return {
        connectivity: CONNECTIVITY_STATES.ONLINE,
        connectivityState: CONNECTIVITY_STATES.ONLINE,
        agentStatus: data.agentStatus,
        ip: data.ip || resolvedIp || (isValidIpv4(plain.ip) ? plain.ip : ''),
        version: data.agentStatus === 'removed' ? 'removed' : data.version,
        installRoot: data.installRoot || plain.installRoot || RSCD_ROOT,
        wmiUser: session.username,
        wmiHost: session.host,
        wmiDomain: session.domain || '',
        error: null,
        errorKind: null,
        diagnostics,
        checkedAt: new Date(),
        lightweight,
      };
    } catch (err) {
      const safeMsg = sanitizeErrorMessage(err.message, [plain.wmiPassword]);
      const kind = classifyWmiError(safeMsg);
      const connectivityState = connectivityFromErrorKind(kind);
      diagnostics = applyProbeResult(diagnostics, err, false);

      logger.debug(`Probe failed for ${label}: ${safeMsg}`);

      return {
        connectivity: connectivityState,
        connectivityState,
        agentStatus: plain.agentStatus || 'active',
        ip: isValidIpv4(plain.ip) ? plain.ip : '',
        version: plain.version,
        installRoot: plain.installRoot,
        wmiUser: null,
        wmiHost: null,
        wmiDomain: '',
        error: safeMsg,
        errorKind: kind,
        diagnostics,
        checkedAt: new Date(),
      };
    }
  }

  async diagnose(vm) {
    const plain = toVmPlain(vm);
    const label = plain.name || plain.fqdn || 'VM';
    const cred = resolveCredentialForVm(plain, this.credentials);
    const { resolvedMap } = await resolveAllTargetsFast(plain);
    const { primary, fallbackIp } = resolveWmiTarget(plain, resolvedMap);

    let diagnostics = await buildDiagnosticsPreflight(plain, this.credentials);
    diagnostics.wmiTarget = primary;
    diagnostics.resolvedIp = resolvedMap[primary] || (isValidIpv4(plain.ip) ? plain.ip : diagnostics.resolvedIp);

    const runStage = async (targetHost, targetLabel) => {
      logger.debug(`WMI diagnose ${targetLabel}: staged probe on ${targetHost}`);
      const stage = await this._stageProbe(targetHost, cred, WMI_CONNECT_TIMEOUT, { wmi: true });
      return { stage, targetHost, targetLabel };
    };

    try {
      await this._ensureRelay();
      let { stage, targetHost } = await runStage(primary, label);

      if (!stage.ok) {
        const { kind } = errorFromStageProbe(stage, label);
        const skipIp = shouldSkipIpFallback(primary, fallbackIp, resolvedMap);
        if (!skipIp && fallbackIp && isRetryableWithIpFallback(kind)) {
          logger.debug(`WMI diagnose ${label}: retry staged probe via IP ${fallbackIp}`);
          const fallback = await runStage(fallbackIp, label);
          stage = fallback.stage;
          targetHost = fallback.targetHost;
          diagnostics.wmiTarget = fallbackIp;
        }
      }

      diagnostics = mergeStageProbe(diagnostics, stage);

      if (!stage.ok) {
        const { kind, msg, category } = errorFromStageProbe(stage, label);
        diagnostics.failureCategory = category;
        diagnostics = applyProbeResult(diagnostics, new Error(msg), false);
        return {
          diagnostics,
          connectivity: connectivityFromErrorKind(kind),
          error: msg,
          errorKind: kind,
          failureCategory: category,
          attemptedTarget: targetHost,
        };
      }

      diagnostics = applyProbeResult(diagnostics, null, true);
      return {
        diagnostics,
        connectivity: CONNECTIVITY_STATES.ONLINE,
        error: null,
        errorKind: null,
        failureCategory: null,
        attemptedTarget: targetHost,
      };
    } catch (err) {
      const safeMsg = sanitizeErrorMessage(err.message, [plain.wmiPassword]);
      const kind = err.errorKind || classifyWmiError(safeMsg);
      if (err.stageProbe) diagnostics = mergeStageProbe(diagnostics, err.stageProbe);
      diagnostics.failureCategory = diagnostics.failureCategory || 'UNKNOWN';
      diagnostics = applyProbeResult(diagnostics, err, false);
      return {
        diagnostics,
        connectivity: connectivityFromErrorKind(kind),
        error: safeMsg,
        errorKind: kind,
        failureCategory: diagnostics.failureCategory,
        attemptedTarget: primary,
        fallbackIp: shouldSkipIpFallback(primary, fallbackIp, resolvedMap) ? null : fallbackIp,
      };
    }
  }

  probeWithDedup(vm, options = {}) {
    const id = String(vm._id || vm.id || vm.name);
    const key = `${id}:${options.lightweight ? 'lite' : 'full'}`;
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const promise = this.probe(vm, options).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
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
        const r = await runWmiCmd(
          session.host,
          session.username,
          session.password,
          `reg query "${key}" /v ProductCode`,
          domain,
          WMI_TIMEOUT,
        );
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
