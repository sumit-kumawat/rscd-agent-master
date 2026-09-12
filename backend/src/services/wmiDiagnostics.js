const { resolveAllTargetsFast } = require('../utils/dnsCache');
const { getWmiRelayStatus } = require('../utils/wmiExec');
const {
  resolveCredentialForVm,
  resolveWmiTarget,
  classifyWmiError,
  kindFromFailureCategory,
  sanitizeErrorMessage,
  CONNECTIVITY_STATES,
} = require('../utils/wmiCredentials');
const { parseCredentials } = require('../utils/wmiCredentials');
const wmiConfig = require('../config/wmi');
const { toVmPlain } = require('../utils/vmPlain');
const { isIp } = require('../utils/hosts');

function step(status, detail = '', durationMs = 0) {
  return {
    status,
    detail: sanitizeErrorMessage(detail),
    durationMs: durationMs || 0,
  };
}

function mergeStageProbe(diagnostics, stageProbe) {
  if (!stageProbe) return diagnostics;
  const s = stageProbe.stages || {};
  if (s.target) diagnostics.wmiTarget = s.target;
  if (s.tcp445) diagnostics.network = mapStage(s.tcp445, diagnostics.network, 'network');
  if (s.network) diagnostics.network = mapStage(s.network, diagnostics.network, 'network');
  if (s.tcp135 || s.rpc) diagnostics.rpc = mapStage(s.rpc || s.tcp135, diagnostics.rpc, 'rpc');
  if (s.smb) diagnostics.smb = mapStage(s.smb, diagnostics.smb, 'smb');
  if (s.wmi) diagnostics.wmi = mapStage(s.wmi, diagnostics.wmi, 'wmi');
  if (s.authentication) diagnostics.authentication = mapStage(s.authentication, diagnostics.authentication, 'auth');
  if (s.authorization) diagnostics.authorization = mapStage(s.authorization, diagnostics.authorization, 'authz');
  if (s.command) diagnostics.command = mapStage(s.command, diagnostics.command, 'cmd');
  if (stageProbe.overall) diagnostics.overall = mapStage(stageProbe.overall, diagnostics.overall, 'overall');
  if (stageProbe.failureCategory) diagnostics.failureCategory = stageProbe.failureCategory;
  if (stageProbe.durationMs) diagnostics.probeDurationMs = stageProbe.durationMs;
  if (stageProbe.timeoutMs) diagnostics.timeoutMs = stageProbe.timeoutMs;
  return diagnostics;
}

function mapStage(next, prev) {
  if (!next || next.status === 'SKIP') return prev || step('SKIP');
  return step(next.status, next.detail || '', next.durationMs || 0);
}

async function buildDiagnosticsPreflight(vm, globalCredentials) {
  const plain = toVmPlain(vm);
  const label = plain.name || plain.fqdn || 'VM';
  const diagnostics = {
    target: label,
    resolvedIp: '',
    dns: step('SKIP'),
    network: step('PENDING', 'Tested during staged probe on relay host'),
    relay: step('SKIP'),
    smb: step('PENDING', 'Tested during staged probe'),
    rpc: step('PENDING', 'Tested during staged probe'),
    wmi: step('PENDING', 'Tested during staged probe'),
    authentication: step('PENDING', 'Tested during staged probe'),
    authorization: step('SKIP'),
    command: step('SKIP'),
    overall: step('PENDING'),
    connectivity: CONNECTIVITY_STATES.UNKNOWN,
    error: null,
    wmiTarget: '',
    identity: '',
    timeoutMs: wmiConfig.connectTimeoutMs,
    failureCategory: null,
    probeDurationMs: 0,
  };

  try {
    const cred = resolveCredentialForVm(plain, globalCredentials);
    diagnostics.identity = cred.label;
  } catch (err) {
    diagnostics.authentication = step('FAIL', err.message);
    diagnostics.overall = step('FAIL', err.message);
    diagnostics.failureCategory = 'AUTHENTICATION_FAILED';
    diagnostics.connectivity = CONNECTIVITY_STATES.AUTH_FAILED;
    diagnostics.error = err.message;
    return diagnostics;
  }

  let resolvedMap = {};
  try {
    const resolved = await resolveAllTargetsFast(plain);
    resolvedMap = resolved.resolvedMap || {};
    const ips = Object.values(resolvedMap).filter(isIp);
    diagnostics.resolvedIp = ips[0] || (isIp(plain.ip) ? plain.ip : '');
    diagnostics.dns = diagnostics.resolvedIp || isIp(plain.ip)
      ? step('PASS', diagnostics.resolvedIp || plain.ip)
      : step('WARN', 'No IP resolved — using hostname');
  } catch (err) {
    diagnostics.dns = step('FAIL', err.message);
    diagnostics.failureCategory = 'DNS_FAILURE';
  }

  try {
    const { primary } = resolveWmiTarget(plain, resolvedMap);
    diagnostics.wmiTarget = primary;
  } catch (err) {
    diagnostics.overall = step('FAIL', err.message);
    diagnostics.failureCategory = 'DNS_FAILURE';
    diagnostics.error = err.message;
    return diagnostics;
  }

  if (wmiConfig.relayUrl) {
    const relayStatus = await getWmiRelayStatus();
    diagnostics.relay = relayStatus.reachable
      ? step('PASS', `${wmiConfig.relayUrl} (resolved ${relayStatus.dnsResolved || 'n/a'})`)
      : step('FAIL', relayStatus.error || relayStatus.dnsError || 'Relay health check failed');
    if (!relayStatus.reachable) {
      diagnostics.connectivity = CONNECTIVITY_STATES.RELAY_UNAVAILABLE;
      diagnostics.failureCategory = 'UNKNOWN';
      diagnostics.overall = step('FAIL', 'WMI relay unavailable');
      diagnostics.error = relayStatus.error || 'WMI relay unavailable';
      return diagnostics;
    }
  } else {
    diagnostics.relay = step('SKIP', 'Direct WMI (no relay)');
  }

  return diagnostics;
}

function applyProbeResult(diagnostics, err, success) {
  if (success) {
    diagnostics.network = diagnostics.network?.status === 'PENDING' ? step('PASS') : diagnostics.network;
    diagnostics.smb = diagnostics.smb?.status === 'PENDING' ? step('PASS') : diagnostics.smb;
    diagnostics.rpc = diagnostics.rpc?.status === 'PENDING' ? step('PASS') : diagnostics.rpc;
    diagnostics.wmi = diagnostics.wmi?.status === 'PENDING' ? step('PASS') : diagnostics.wmi;
    diagnostics.authentication = diagnostics.authentication?.status === 'PENDING'
      ? step('PASS')
      : diagnostics.authentication;
    diagnostics.authorization = diagnostics.authorization?.status === 'SKIP'
      ? step('PASS')
      : diagnostics.authorization;
    diagnostics.command = step('PASS');
    diagnostics.overall = step('PASS');
    diagnostics.connectivity = CONNECTIVITY_STATES.ONLINE;
    diagnostics.error = null;
    diagnostics.failureCategory = null;
    return diagnostics;
  }

  const category = diagnostics.failureCategory || null;
  const kind = kindFromFailureCategory(category) || classifyWmiError(err?.message || String(err));
  const msg = sanitizeErrorMessage(err?.message || String(err));
  if (!diagnostics.failureCategory) {
    diagnostics.failureCategory = category || (kind === 'timeout' ? 'WMI_TIMEOUT' : 'UNKNOWN');
  }

  if (kind === 'auth_failed') {
    if (diagnostics.authentication?.status === 'PENDING') {
      diagnostics.authentication = step('FAIL', msg);
    }
    diagnostics.connectivity = CONNECTIVITY_STATES.AUTH_FAILED;
  } else if (kind === 'timeout') {
    if (diagnostics.wmi?.status === 'PENDING') diagnostics.wmi = step('FAIL', msg);
    diagnostics.connectivity = CONNECTIVITY_STATES.TIMEOUT;
  } else if (kind === 'permission_denied') {
    diagnostics.authentication = diagnostics.authentication?.status === 'PASS'
      ? diagnostics.authentication
      : step('PASS');
    diagnostics.authorization = step('FAIL', msg);
    diagnostics.connectivity = CONNECTIVITY_STATES.PERMISSION_DENIED;
  } else if (kind === 'relay_unavailable') {
    diagnostics.relay = step('FAIL', msg);
    diagnostics.connectivity = CONNECTIVITY_STATES.RELAY_UNAVAILABLE;
  } else if (kind === 'dns_failed') {
    diagnostics.dns = step('FAIL', msg);
    diagnostics.connectivity = CONNECTIVITY_STATES.DNS_FAILED;
  } else if (kind === 'unreachable') {
    if (diagnostics.network?.status === 'PENDING') diagnostics.network = step('FAIL', msg);
    diagnostics.connectivity = CONNECTIVITY_STATES.UNREACHABLE;
  } else if (kind === 'wmi_unavailable') {
    diagnostics.wmi = step('FAIL', msg);
    diagnostics.connectivity = CONNECTIVITY_STATES.WMI_UNAVAILABLE;
  } else {
    diagnostics.wmi = diagnostics.wmi?.status === 'PENDING' ? step('FAIL', msg) : diagnostics.wmi;
    diagnostics.connectivity = CONNECTIVITY_STATES.UNKNOWN;
  }

  diagnostics.overall = step('FAIL', msg);
  diagnostics.error = msg;
  return diagnostics;
}

module.exports = {
  buildDiagnosticsPreflight,
  applyProbeResult,
  mergeStageProbe,
  parseCredentials,
  getWmiRelayStatus,
};
