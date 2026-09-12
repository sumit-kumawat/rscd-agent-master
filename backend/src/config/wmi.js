/**
 * Central WMI configuration — single source of truth for timeouts and relay settings.
 * All WMI modules must import from here; do not read process.env directly for these values.
 */

const DEFAULT_CONNECT_TIMEOUT_MS = 45000;
const DEFAULT_COMMAND_TIMEOUT_MS = 90000;

function readPositiveInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return { value: fallback, source: 'default' };
  }
  const n = parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n <= 0) {
    return { value: fallback, source: 'invalid-env' };
  }
  return { value: n, source: 'env' };
}

const connectTimeout = readPositiveInt('WMI_CONNECT_TIMEOUT_MS', DEFAULT_CONNECT_TIMEOUT_MS);
const commandTimeout = readPositiveInt('WMI_TIMEOUT_MS', DEFAULT_COMMAND_TIMEOUT_MS);

module.exports = {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_COMMAND_TIMEOUT_MS,
  connectTimeoutMs: connectTimeout.value,
  connectTimeoutSource: connectTimeout.source,
  commandTimeoutMs: commandTimeout.value,
  commandTimeoutSource: commandTimeout.source,
  sessionCacheMs: readPositiveInt('WMI_SESSION_CACHE_MS', 600000).value,
  relayUrl: (process.env.WMI_RELAY_URL || '').trim(),
  relayToken: (process.env.WMI_RELAY_TOKEN || '').trim(),
  relayHostIp: (process.env.WMI_RELAY_HOST_IP || '').trim(),
  relayPort: readPositiveInt('WMI_RELAY_PORT', 19500).value,
  defaultDomain: (process.env.WMI_DEFAULT_DOMAIN || '').trim(),
  allowIpFallback: process.env.WMI_ALLOW_IP_FALLBACK !== 'false',
  wmiexecPath: (process.env.WMIEXEC_PATH || '').trim(),
  monitorProbeBackoffSec: readPositiveInt('MONITOR_PROBE_BACKOFF_SEC', 90).value,
  agentInventoryTimeoutMs: readPositiveInt('WMI_AGENT_INVENTORY_TIMEOUT_MS', 60000).value,
  monitorLightweight: process.env.MONITOR_LIGHTWEIGHT_PROBE !== 'false',
  startupCheckOnBoot: process.env.STARTUP_VM_CHECK !== 'false',
  backgroundInventory: process.env.BACKGROUND_AGENT_INVENTORY !== 'false',
};
