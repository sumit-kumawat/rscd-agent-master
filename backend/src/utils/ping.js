const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const TIMEOUT_MS = parseInt(process.env.PING_TIMEOUT_MS || '3000', 10);
const isWindowsHost = process.platform === 'win32';

async function ping(host) {
  const target = String(host || '').trim();
  if (!target) return { reachable: false, latencyMs: null };

  const cmd = isWindowsHost
    ? `ping -n 1 -w ${TIMEOUT_MS} ${target}`
    : `ping -c 1 -W ${Math.max(1, Math.ceil(TIMEOUT_MS / 1000))} ${target}`;

  try {
    const { stdout } = await execAsync(cmd, { timeout: TIMEOUT_MS + 2000 });
    const text = stdout || '';
    const reachable = /ttl=/i.test(text) || /time[=<]/i.test(text);
    const m = text.match(/time[=<]\s*(\d+)/i);
    return { reachable, latencyMs: m ? parseInt(m[1], 10) : null };
  } catch {
    return { reachable: false, latencyMs: null };
  }
}

module.exports = { ping };
