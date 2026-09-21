function readPositiveInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

module.exports = {
  concurrency: readPositiveInt('RSCD_UNINSTALL_CONCURRENCY', readPositiveInt('UNINSTALL_CONCURRENCY', 5)),
  endpointTimeoutMs: readPositiveInt('RSCD_UNINSTALL_TIMEOUT_MS', 600000),
  stepTimeoutMs: readPositiveInt('RSCD_STEP_TIMEOUT_MS', 120000),
};
