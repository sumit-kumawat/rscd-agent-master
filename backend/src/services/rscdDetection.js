/**
 * Parallel RSCD detection — small fast WMI/PowerShell sub-queries with per-query retry.
 */
const wmiConfig = require('../config/wmi');
const { runWmiCmd, runWmiPowershell } = require('../utils/wmiExec');
const { sanitizeErrorMessage } = require('../utils/wmiCredentials');

const RETRY_BACKOFF = wmiConfig.queryRetryBackoffMs || [2000, 5000, 10000];
const QUERY_TIMEOUT = wmiConfig.queryTimeoutMs;
const STEP_TIMEOUT = wmiConfig.stepTimeoutMs;

const BMC_PF = 'C:\\Program Files\\BMC Software';
const BMC_PF86 = 'C:\\Program Files (x86)\\BMC Software';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function mergeDetectResults(parts) {
  const state = {
    serviceInstalled: false,
    serviceStatus: 'NotFound',
    productCodes: [],
    programs: [],
    installPaths: [],
    partial: false,
    errors: [],
    subResults: [],
  };

  for (const part of parts) {
    if (!part) continue;
    state.subResults.push(part);
    if (!part.ok && part.error) state.errors.push(`${part.name}: ${part.error}`);
    const r = part.result || {};
    if (r.serviceInstalled) state.serviceInstalled = true;
    if (r.serviceStatus) state.serviceStatus = r.serviceStatus;
    for (const c of r.productCodes || []) {
      if (!state.productCodes.includes(c)) state.productCodes.push(c);
    }
    for (const p of r.programs || []) {
      if (!state.programs.includes(p)) state.programs.push(p);
    }
    for (const d of r.installPaths || []) {
      if (!state.installPaths.includes(d)) state.installPaths.push(d);
    }
  }

  state.partial = state.errors.length > 0 && (
    state.serviceInstalled || state.productCodes.length || state.programs.length || state.installPaths.length
  );
  return state;
}

function parseServiceSc(stdout) {
  const text = String(stdout || '');
  const installed = /SERVICE_NAME:\s*RSCD/i.test(text) || /\bRSCD\b/i.test(text);
  let status = 'NotFound';
  const stateMatch = text.match(/STATE\s*:\s*\d+\s+(\w+)/i);
  if (stateMatch) status = stateMatch[1];
  else if (/RUNNING/i.test(text)) status = 'Running';
  else if (/STOPPED/i.test(text)) status = 'Stopped';
  return { serviceInstalled: installed, serviceStatus: installed ? status : 'NotFound' };
}

function parseDetectOutput(stdout) {
  const result = {
    serviceInstalled: false,
    serviceStatus: 'NotFound',
    productCodes: [],
    programs: [],
    installPaths: [],
  };
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const t = line.trim();
    if (t === 'SERVICE:installed') result.serviceInstalled = true;
    else if (t.startsWith('SERVICE_STATUS:')) {
      result.serviceInstalled = true;
      result.serviceStatus = t.slice(15).trim();
    } else if (t.startsWith('PRODUCTCODE:')) {
      const code = t.slice(12).trim();
      if (/^\{[0-9A-Fa-f-]{36}\}$/.test(code) && !result.productCodes.includes(code)) {
        result.productCodes.push(code);
      }
    } else if (t.startsWith('PROGRAMS:')) result.programs.push(t.slice(9).trim());
    else if (t.startsWith('DIR:')) result.installPaths.push(t.slice(4).trim());
  }
  return result;
}

function buildFallbackScript() {
  return [
    '$ErrorActionPreference="SilentlyContinue"',
    '$svc=Get-Service -Name RSCD -EA 0',
    'if($svc){ Write-Output "SERVICE:installed"; Write-Output ("SERVICE_STATUS:" + $svc.Status) }',
    'foreach($k in "HKLM:\\SOFTWARE\\BladeLogic\\RSCD Agent","HKLM:\\SOFTWARE\\WOW6432Node\\BladeLogic\\RSCD Agent"){',
    '  $p=Get-ItemProperty $k -EA 0; if($p.ProductCode){ Write-Output ("PRODUCTCODE:" + $p.ProductCode) }',
    '}',
    'foreach($u in "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall","HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall"){',
    '  Get-ChildItem $u -EA 0 | ForEach-Object {',
    '    $p=Get-ItemProperty $_.PSPath -EA 0',
    '    if($p.DisplayName -match "RSCD|BladeLogic|TrueSight|BMC"){',
    '      Write-Output ("PROGRAMS:" + $p.DisplayName)',
    '      if($_.PSChildName -match "^\\{"){ Write-Output ("PRODUCTCODE:" + $_.PSChildName) }',
    '    }',
    '  }',
    '}',
    `if(Test-Path '${BMC_PF.replace(/\\/g, '\\\\')}'){ Write-Output "DIR:${BMC_PF}" }`,
    `if(Test-Path '${BMC_PF86.replace(/\\/g, '\\\\')}'){ Write-Output "DIR:${BMC_PF86}" }`,
  ].join('\n');
}

async function execSubQuery(session, name, fn, onLog, passwords = []) {
  const started = Date.now();
  onLog(`[detect:${name}] starting`, 'info');
  let lastErr;

  for (let attempt = 0; attempt <= RETRY_BACKOFF.length; attempt++) {
    try {
      const result = await fn();
      const durationMs = Date.now() - started;
      onLog(`[detect:${name}] OK (${durationMs}ms)`, 'success');
      return { name, ok: true, result, durationMs };
    } catch (err) {
      lastErr = err;
      const msg = sanitizeErrorMessage(err.message, passwords);
      if (attempt < RETRY_BACKOFF.length) {
        const wait = RETRY_BACKOFF[attempt];
        onLog(`[detect:${name}] attempt ${attempt + 1} failed — retry in ${wait / 1000}s: ${msg}`, 'warning');
        await sleep(wait);
      }
    }
  }

  const durationMs = Date.now() - started;
  const msg = sanitizeErrorMessage(lastErr?.message, passwords);
  onLog(`[detect:${name}] FAILED (${durationMs}ms): ${msg}`, 'error');
  return { name, ok: false, error: msg, durationMs };
}

async function detectRscd(session, onLog, options = {}) {
  const passwords = options.passwords || [session.password].filter(Boolean);
  const stepDeadline = Date.now() + (options.stepTimeoutMs || STEP_TIMEOUT);
  const queryTimeout = options.queryTimeoutMs || QUERY_TIMEOUT;

  const wmiPs = (script) => runWmiPowershell(
    session.host, session.username, session.password, script, session.domain || null, queryTimeout,
  );
  const wmiCmd = (cmd) => runWmiCmd(
    session.host, session.username, session.password, cmd, session.domain || null, queryTimeout,
  );

  const checks = [
    {
      name: 'service',
      run: async () => {
        const r = await wmiCmd('sc query RSCD');
        return parseServiceSc(r.stdout);
      },
    },
    {
      name: 'registry_blade',
      run: async () => {
        const script = [
          '$ErrorActionPreference="SilentlyContinue"',
          '$codes=@()',
          'foreach($k in "HKLM:\\SOFTWARE\\BladeLogic\\RSCD Agent","HKLM:\\SOFTWARE\\WOW6432Node\\BladeLogic\\RSCD Agent"){',
          '  $p=Get-ItemProperty $k -EA 0; if($p.ProductCode){ $codes+=$p.ProductCode }',
          '}',
          '$codes | ForEach-Object { Write-Output ("PRODUCTCODE:" + $_) }',
        ].join('\n');
        const r = await wmiPs(script);
        return parseDetectOutput(r.stdout);
      },
    },
    {
      name: 'registry_uninstall_x64',
      run: async () => {
        const script = [
          '$ErrorActionPreference="SilentlyContinue"',
          '$u="HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall"',
          'Get-ChildItem $u -EA 0 | ForEach-Object {',
          '  $p=Get-ItemProperty $_.PSPath -EA 0',
          '  if($p.DisplayName -match "RSCD|BladeLogic|TrueSight|BMC"){',
          '    Write-Output ("PROGRAMS:" + $p.DisplayName)',
          '    if($_.PSChildName -match "^\\{"){ Write-Output ("PRODUCTCODE:" + $_.PSChildName) }',
          '  }',
          '}',
        ].join('\n');
        const r = await wmiPs(script);
        return parseDetectOutput(r.stdout);
      },
    },
    {
      name: 'registry_uninstall_x86',
      run: async () => {
        const script = [
          '$ErrorActionPreference="SilentlyContinue"',
          '$u="HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall"',
          'Get-ChildItem $u -EA 0 | ForEach-Object {',
          '  $p=Get-ItemProperty $_.PSPath -EA 0',
          '  if($p.DisplayName -match "RSCD|BladeLogic|TrueSight|BMC"){',
          '    Write-Output ("PROGRAMS:" + $p.DisplayName)',
          '    if($_.PSChildName -match "^\\{"){ Write-Output ("PRODUCTCODE:" + $_.PSChildName) }',
          '  }',
          '}',
        ].join('\n');
        const r = await wmiPs(script);
        return parseDetectOutput(r.stdout);
      },
    },
    {
      name: 'path_programfiles',
      run: async () => {
        const r = await wmiCmd(`if exist "${BMC_PF}\\" echo DIR_FOUND`);
        const found = /DIR_FOUND/i.test(r.stdout || '');
        return { installPaths: found ? [BMC_PF] : [] };
      },
    },
    {
      name: 'path_programfiles_x86',
      run: async () => {
        const r = await wmiCmd(`if exist "${BMC_PF86}\\" echo DIR_FOUND`);
        const found = /DIR_FOUND/i.test(r.stdout || '');
        return { installPaths: found ? [BMC_PF86] : [] };
      },
    },
  ];

  if (Date.now() > stepDeadline) {
    onLog('Detection step deadline exceeded before sub-queries', 'error');
    return mergeDetectResults([]);
  }

  const settled = await Promise.allSettled(
    checks.map((c) => execSubQuery(session, c.name, c.run, onLog, passwords)),
  );
  const parts = settled.map((s) => (s.status === 'fulfilled' ? s.value : {
    name: 'unknown',
    ok: false,
    error: s.reason?.message || 'sub-query rejected',
  }));

  let state = mergeDetectResults(parts);
  const anyOk = parts.some((p) => p.ok);
  const hasFindings = state.serviceInstalled || state.productCodes.length || state.programs.length || state.installPaths.length;

  if (!anyOk || (!hasFindings && state.errors.length)) {
    onLog('WMI sub-queries incomplete — running PowerShell fallback detection', 'warning');
    try {
      const r = await runWmiPowershell(
        session.host,
        session.username,
        session.password,
        buildFallbackScript(),
        session.domain || null,
        Math.min(queryTimeout * 2, Math.max(15000, stepDeadline - Date.now())),
      );
      const fallback = parseDetectOutput(r.stdout);
      state = mergeDetectResults([
        ...parts,
        { name: 'fallback_ps', ok: true, result: fallback, durationMs: 0 },
      ]);
      onLog('[detect:fallback_ps] OK', 'success');
    } catch (err) {
      const msg = sanitizeErrorMessage(err.message, passwords);
      onLog(`[detect:fallback_ps] FAILED: ${msg}`, 'error');
      state.errors.push(`fallback_ps: ${msg}`);
      state.detectionFailed = !hasFindings;
      if (!hasFindings) {
        onLog('Detection failed — manual review required; continuing with partial cleanup', 'warning');
      }
    }
  }

  return state;
}

module.exports = {
  detectRscd,
  mergeDetectResults,
  parseDetectOutput,
};
