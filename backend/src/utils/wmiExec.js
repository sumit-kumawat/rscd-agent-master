const { spawn, execFileSync } = require('child_process');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const wmiConfig = require('../config/wmi');
const { sanitizeErrorMessage } = require('./wmiCredentials');
const { runTcpStageProbe } = require('./tcpProbe');

const WMI_TIMEOUT = wmiConfig.commandTimeoutMs;
const WMI_CONNECT_TIMEOUT = wmiConfig.connectTimeoutMs;
const PS_EXE = process.env.POWERSHELL_PATH || 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const PROBE_SCRIPT = path.join(__dirname, '../../wmi_probe.py');

let wmiexecPath = null;

function resolveWmiexec() {
  if (wmiexecPath && fs.existsSync(wmiexecPath)) return wmiexecPath;

  const candidates = [
    wmiConfig.wmiexecPath,
    path.join(__dirname, '../../wmiexec.py'),
    '/usr/local/lib/python3.11/dist-packages/impacket/examples/wmiexec.py',
    '/usr/local/lib/python3/dist-packages/impacket/examples/wmiexec.py',
    '/usr/local/bin/wmiexec.py',
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      wmiexecPath = p;
      return p;
    }
  }

  try {
    const out = execFileSync('python3', [
      '-c',
      'import impacket, os, glob; '
      + 'base=os.path.dirname(impacket.__file__); '
      + 'paths=glob.glob(os.path.join(base, "**", "wmiexec.py"), recursive=True); '
      + 'print(paths[0] if paths else "")',
    ], { encoding: 'utf8', timeout: 5000 }).trim();
    if (out && fs.existsSync(out)) {
      wmiexecPath = out;
      return out;
    }
  } catch {
    // ignore
  }

  throw new Error('wmiexec.py not found — rebuild Docker image (pip install impacket==0.12.0)');
}

function encodePs(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function formatWmiTarget(host, username, password, domain) {
  const user = domain ? `${domain}/${username}` : username;
  return `${user}:${password}@${host}`;
}

function extractWmiError(stdout, stderr, code, timeoutMs = WMI_TIMEOUT) {
  const raw = `${stdout || ''}\n${stderr || ''}`;
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    if (/^WMI_OK$/i.test(line)) continue;
    const impacket = line.match(/^\[-\]\s*(.+)/);
    if (impacket) return impacket[1].slice(0, 300);
    if (/STATUS_[A-Z_]+/.test(line)) {
      const m = line.match(/(STATUS_[A-Z_]+[^\\n]*)/);
      if (m) return m[1].slice(0, 300);
    }
    if (/stringBinding/i.test(line)) return line.slice(0, 300);
    if (/SMB SessionError|LOGON_FAILURE|Access is denied|RPC_S_|denied/i.test(line)) {
      return line.slice(0, 300);
    }
  }

  if (code === null) return `WMI timed out after ${timeoutMs}ms`;
  const tail = lines.filter((l) => !l.startsWith('[*]') && !l.startsWith('[+]')).slice(-3).join('; ');
  return tail || `WMI failed (exit ${code})`;
}

function cleanOutput(raw) {
  const lines = String(raw || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((line) => {
      if (!line) return false;
      if (line.startsWith('Impacket')) return false;
      if (line.startsWith('[*]') || line.startsWith('[+]') || line.startsWith('[-]')) return false;
      if (line.includes('SMBv')) return false;
      if (/^\+/.test(line)) return false;
      if (/FullyQualifiedErrorId/i.test(line)) return false;
      if (/CommandNotFoundException/i.test(line)) return false;
      if (/At line:/i.test(line)) return false;
      if (/^#< CLIXML/i.test(line)) return false;
      if (/^<Objs /i.test(line)) return false;
      if (/xmlns="http:\/\/schemas\.microsoft\.com\/powershell/i.test(line)) return false;
      if (/^WMI_OK$/i.test(line)) return false;
      return true;
    });
  return lines.join('\n');
}

function resolveRelayHostname(hostname) {
  if (wmiConfig.relayHostIp) return wmiConfig.relayHostIp;
  return hostname;
}

function relayRequestOptions(url) {
  const hostname = resolveRelayHostname(url.hostname);
  const port = url.port || (url.protocol === 'https:' ? 443 : 80);
  return { hostname, port, path: url.pathname };
}

function relayClientTimeout(timeoutMs) {
  return Math.max(timeoutMs + 15000, timeoutMs * 2);
}

function probeClientTimeout(timeoutMs) {
  return Math.max(timeoutMs + 20000, 75000);
}

function relayHttpRequest(method, urlPath, payload, timeoutMs) {
  const relayUrl = wmiConfig.relayUrl;
  const token = wmiConfig.relayToken;
  const body = payload ? JSON.stringify(payload) : null;
  const clientTimeout = timeoutMs || 10000;

  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, relayUrl);
    const lib = url.protocol === 'https:' ? https : http;
    const { hostname, port, path: reqPath } = relayRequestOptions(url);
    const req = lib.request({
      hostname,
      port,
      path: reqPath,
      method,
      headers: body ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(token ? { 'X-Wmi-Relay-Token': token } : {}),
      } : {
        ...(token ? { 'X-Wmi-Relay-Token': token } : {}),
      },
      timeout: clientTimeout,
    }, (res) => {
      let data = '';
      res.on('data', (d) => { data += d; });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(data || '{}') });
        } catch (err) {
          reject(new Error(`WMI relay bad response: ${err.message}`));
        }
      });
    });

    req.on('error', (err) => {
      const msg = err.code === 'ECONNRESET' || /hang up/i.test(err.message)
        ? `WMI relay connection lost (${relayUrl}) — ensure ./scripts/start-wmi-relay.sh is running on the host`
        : `WMI relay unreachable (${relayUrl}): ${err.message}`;
      reject(new Error(msg));
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`WMI relay timed out after ${clientTimeout}ms (${relayUrl})`));
    });
    if (body) req.write(body);
    req.end();
  });
}

function spawnWithTimeout(command, args, timeoutMs, stdinData = null) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, timeoutMs);

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    if (stdinData) {
      proc.stdin.write(stdinData);
      proc.stdin.end();
    } else {
      proc.stdin.end();
    }

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        let partial = {};
        try {
          partial = JSON.parse(stdout || '{}');
        } catch {
          // ignore
        }
        reject(Object.assign(new Error(`WMI command timed out after ${timeoutMs}ms`), {
          partialProbe: partial,
          stdout,
          stderr,
        }));
        return;
      }
      resolve({ stdout, stderr, code });
    });
  });
}

function invokePythonProbe(payload, timeoutMs) {
  if (!fs.existsSync(PROBE_SCRIPT)) {
    throw new Error('wmi_probe.py not found');
  }
  const probeTimeout = probeClientTimeout(timeoutMs);
  return spawnWithTimeout(
    'python3',
    [PROBE_SCRIPT],
    probeTimeout,
    JSON.stringify(payload),
  ).then(({ stdout, stderr, code }) => {
    try {
      const parsed = JSON.parse(stdout || '{}');
      if (!parsed.failureCategory && !parsed.ok) {
        parsed.failureCategory = parsed.failureCategory || 'UNKNOWN';
      }
      if (!parsed.ok && !parsed.error) {
        parsed.error = stderr || extractWmiError(stdout, stderr, code, timeoutMs);
      }
      return parsed;
    } catch (err) {
      throw new Error(extractWmiError(stdout, stderr, code, timeoutMs) || err.message);
    }
  }).catch((err) => {
    if (err.partialProbe && err.partialProbe.stages) {
      return {
        ok: false,
        error: err.message,
        stages: err.partialProbe.stages,
        failureCategory: err.partialProbe.failureCategory || 'WMI_TIMEOUT',
        overall: { status: 'FAIL', detail: err.message },
        durationMs: err.partialProbe.durationMs,
        timeoutMs,
      };
    }
    return {
      ok: false,
      error: err.message,
      stages: {},
      failureCategory: /timed out/i.test(err.message) ? 'WMI_TIMEOUT' : 'UNKNOWN',
      overall: { status: 'FAIL', detail: err.message },
      timeoutMs,
    };
  });
}

function mergeTcpStages(probeResult, tcpResult) {
  if (!tcpResult) return probeResult;
  const stages = { ...(probeResult.stages || {}) };
  stages.tcp445 = {
    status: tcpResult.tcp445.status,
    detail: tcpResult.tcp445.detail,
    durationMs: tcpResult.tcp445.durationMs,
  };
  stages.tcp135 = {
    status: tcpResult.tcp135.status,
    detail: tcpResult.tcp135.detail,
    durationMs: tcpResult.tcp135.durationMs,
  };
  if (tcpResult.tcp445.status === 'PASS' && tcpResult.tcp135.status === 'PASS') {
    stages.network = { status: 'PASS', detail: 'TCP 445 and 135 reachable from relay host' };
    stages.rpc = stages.rpc?.status === 'SKIP'
      ? { status: 'PASS', detail: 'RPC endpoint mapper port open' }
      : stages.rpc;
  } else if (tcpResult.tcp445.status === 'FAIL') {
    stages.network = stages.tcp445;
    probeResult.ok = false;
    probeResult.failureCategory = probeResult.failureCategory || 'TCP_TIMEOUT';
    probeResult.error = probeResult.error || tcpResult.tcp445.detail;
  } else if (tcpResult.tcp135.status === 'FAIL') {
    stages.rpc = stages.tcp135;
    probeResult.ok = false;
    probeResult.failureCategory = probeResult.failureCategory || 'RPC_UNREACHABLE';
    probeResult.error = probeResult.error || tcpResult.tcp135.detail;
  }
  return { ...probeResult, stages };
}

async function runWmiProbe(host, username, password, domain = null, options = {}) {
  const timeoutMs = options.timeoutMs || WMI_CONNECT_TIMEOUT;
  const payload = {
    host,
    username,
    password,
    domain,
    timeoutMs,
    smbOnly: !!options.smbOnly,
    wmi: options.wmi !== false,
    skipTcp: !!options.skipTcp,
  };

  let tcpResult = null;
  // TCP/SMB/WMI must run on the relay host when a relay is configured (Docker cannot reach corp network).
  const runTcpLocally = !wmiConfig.relayUrl && !options.skipTcp;
  if (runTcpLocally) {
    try {
      tcpResult = await runTcpStageProbe(host, 5000);
      if (tcpResult.tcp445.status === 'FAIL') {
        return mergeTcpStages({
          ok: false,
          error: tcpResult.tcp445.detail,
          failureCategory: 'TCP_TIMEOUT',
          stages: { target: host },
          overall: { status: 'FAIL', detail: tcpResult.tcp445.detail },
          timeoutMs,
        }, tcpResult);
      }
      if (tcpResult.tcp135.status === 'FAIL') {
        return mergeTcpStages({
          ok: false,
          error: tcpResult.tcp135.detail,
          failureCategory: 'RPC_UNREACHABLE',
          stages: { target: host },
          overall: { status: 'FAIL', detail: tcpResult.tcp135.detail },
          timeoutMs,
        }, tcpResult);
      }
      payload.skipTcp = true;
    } catch (err) {
      tcpResult = null;
    }
  }

  let probeResult;
  if (wmiConfig.relayUrl) {
    const clientTimeout = probeClientTimeout(timeoutMs);
    const { body } = await relayHttpRequest('POST', '/probe', { ...payload, skipTcp: false }, clientTimeout);
    probeResult = body;
    if (!probeResult || typeof probeResult !== 'object') {
      probeResult = {
        ok: false,
        error: 'Empty probe response from relay',
        failureCategory: 'UNKNOWN',
        stages: {},
      };
    }
  } else {
    probeResult = await invokePythonProbe(payload, timeoutMs);
  }

  if (!probeResult.failureCategory && !probeResult.ok) {
    probeResult.failureCategory = 'UNKNOWN';
  }
  return mergeTcpStages(probeResult, tcpResult);
}

function runWmiCommandViaRelay(host, username, password, command, domain = null, timeoutMs = WMI_TIMEOUT, options = {}) {
  const clientTimeout = relayClientTimeout(timeoutMs);

  return relayHttpRequest('POST', '/exec', {
    host,
    username,
    password,
    command,
    domain,
    timeoutMs,
    silent: !!options.silent,
    noOutput: !!options.noOutput,
  }, clientTimeout).then(({ body }) => {
    if (body.ok) {
      return {
        stdout: body.stdout || '',
        stderr: body.stderr || '',
        code: body.code ?? 0,
      };
    }
    throw new Error(sanitizeErrorMessage(body.error || 'WMI relay failed', [password]));
  });
}

async function checkWmiRelay() {
  const relayUrl = wmiConfig.relayUrl;
  if (!relayUrl) return true;
  try {
    const { statusCode } = await relayHttpRequest('GET', '/health', null, 5000);
    return statusCode === 200;
  } catch {
    return false;
  }
}

async function getWmiRelayStatus() {
  const relayUrl = wmiConfig.relayUrl;
  if (!relayUrl) {
    return {
      configured: false,
      reachable: null,
      url: '',
      connectTimeoutMs: wmiConfig.connectTimeoutMs,
    };
  }

  const hostname = resolveRelayHostname(new URL(relayUrl).hostname);
  let dnsResolved = hostname;
  try {
    const dns = require('dns').promises;
    if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
      const looked = await dns.lookup(hostname);
      dnsResolved = looked.address;
    }
  } catch (err) {
    return {
      configured: true,
      reachable: false,
      url: relayUrl,
      dnsResolved: null,
      dnsError: err.message,
      connectTimeoutMs: wmiConfig.connectTimeoutMs,
    };
  }

  try {
    const { statusCode, body } = await relayHttpRequest('GET', '/health', null, 5000);
    return {
      configured: true,
      reachable: statusCode === 200,
      url: relayUrl,
      dnsResolved,
      health: body,
      connectTimeoutMs: wmiConfig.connectTimeoutMs,
    };
  } catch (err) {
    return {
      configured: true,
      reachable: false,
      url: relayUrl,
      dnsResolved,
      error: err.message,
      connectTimeoutMs: wmiConfig.connectTimeoutMs,
    };
  }
}

function runWmiCommand(host, username, password, command, domain = null, timeoutMs = WMI_TIMEOUT, options = {}) {
  if (wmiConfig.relayUrl) {
    return runWmiCommandViaRelay(host, username, password, command, domain, timeoutMs, options);
  }

  const target = formatWmiTarget(host, username, password, domain);
  const script = resolveWmiexec();
  const args = [script];
  if (options.silent) args.push('-silentcommand');
  if (options.noOutput) args.push('-nooutput');
  args.push(target, command);

  return spawnWithTimeout('python3', args, timeoutMs).then(({ stdout, stderr, code }) => {
    const out = cleanOutput(stdout);
    const success = code === 0 || /WMI_OK/i.test(stdout) || /WMI_OK/i.test(out);
    if (!success && !out) {
      const errMsg = extractWmiError(stdout, stderr, code, timeoutMs);
      throw new Error(sanitizeErrorMessage(errMsg, [password]));
    }
    return { stdout: out || cleanOutput(stderr), stderr: stderr.trim(), code: success ? 0 : code };
  });
}

async function runWmiPowershell(host, username, password, script, domain = null, timeoutMs = WMI_TIMEOUT, options = {}) {
  const b64 = encodePs(script);
  const command = `cmd.exe /c "${PS_EXE}" -NoProfile -NonInteractive -ExecutionPolicy Bypass -OutputFormat Text -EncodedCommand ${b64}`;
  const who = domain ? `${domain}\\${username}` : username;
  logger.debug(`WMI PowerShell on ${host} as ${who} (timeout ${timeoutMs}ms)`);
  return runWmiCommand(host, username, password, command, domain, timeoutMs, options);
}

async function runWmiCmd(host, username, password, cmdLine, domain = null, timeoutMs = WMI_CONNECT_TIMEOUT, options = {}) {
  const command = `cmd.exe /c ${cmdLine}`;
  const mode = options.silent && options.noOutput ? ' [async]' : '';
  logger.debug(`WMI cmd on ${host}: ${cmdLine.slice(0, 80)} (timeout ${timeoutMs}ms)${mode}`);
  return runWmiCommand(host, username, password, command, domain, timeoutMs, options);
}

/** Fire-and-forget WMI command — returns after process launch, not completion. */
async function runWmiCmdAsync(host, username, password, cmdLine, domain = null, timeoutMs = WMI_CONNECT_TIMEOUT) {
  return runWmiCmd(host, username, password, cmdLine, domain, timeoutMs, { silent: true, noOutput: true });
}

module.exports = {
  runWmiCommand,
  runWmiPowershell,
  runWmiCmd,
  runWmiCmdAsync,
  runWmiProbe,
  cleanOutput,
  resolveWmiexec,
  formatWmiTarget,
  extractWmiError,
  checkWmiRelay,
  getWmiRelayStatus,
  WMI_TIMEOUT,
  WMI_CONNECT_TIMEOUT,
};
