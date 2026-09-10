const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const logger = require('./logger');

const WMI_TIMEOUT = parseInt(process.env.WMI_TIMEOUT_MS || '90000', 10);
const WMI_CONNECT_TIMEOUT = parseInt(process.env.WMI_CONNECT_TIMEOUT_MS || '20000', 10);
const PS_EXE = process.env.POWERSHELL_PATH || 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

let wmiexecPath = null;

function resolveWmiexec() {
  if (wmiexecPath && fs.existsSync(wmiexecPath)) return wmiexecPath;

  const candidates = [
    process.env.WMIEXEC_PATH,
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
    if (/SMB SessionError|LOGON_FAILURE|Access is denied|authentication|RPC_S_|denied/i.test(line)) {
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

function runWmiCommand(host, username, password, command, domain = null, timeoutMs = WMI_TIMEOUT) {
  const target = formatWmiTarget(host, username, password, domain);
  const script = resolveWmiexec();

  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [script, target, command], {
      env: process.env,
      timeout: timeoutMs,
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('error', (err) => reject(err));

    proc.on('close', (code) => {
      const out = cleanOutput(stdout);
      const success = code === 0 || /WMI_OK/i.test(stdout) || /WMI_OK/i.test(out);
      if (!success && !out) {
        reject(new Error(extractWmiError(stdout, stderr, code, timeoutMs)));
        return;
      }
      resolve({ stdout: out || cleanOutput(stderr), stderr: stderr.trim(), code: success ? 0 : code });
    });
  });
}

async function runWmiPowershell(host, username, password, script, domain = null) {
  const b64 = encodePs(script);
  const command = `cmd.exe /c "${PS_EXE}" -NoProfile -NonInteractive -ExecutionPolicy Bypass -OutputFormat Text -EncodedCommand ${b64}`;
  logger.debug(`WMI PowerShell on ${host} as ${domain ? `${domain}/` : ''}${username}`);
  return runWmiCommand(host, username, password, command, domain);
}

async function runWmiCmd(host, username, password, cmdLine, domain = null, timeoutMs = WMI_CONNECT_TIMEOUT) {
  const command = `cmd.exe /c ${cmdLine}`;
  logger.debug(`WMI cmd on ${host}: ${cmdLine.slice(0, 80)}`);
  return runWmiCommand(host, username, password, command, domain, timeoutMs);
}

module.exports = {
  runWmiCommand,
  runWmiPowershell,
  runWmiCmd,
  cleanOutput,
  resolveWmiexec,
  formatWmiTarget,
  extractWmiError,
  WMI_TIMEOUT,
  WMI_CONNECT_TIMEOUT,
};
