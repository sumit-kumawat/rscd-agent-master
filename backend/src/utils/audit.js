/**
 * Structured audit logging — persisted to ActivityLog (MongoDB) and streamed live.
 */
const activityLog = require('../services/activityLog');

const SECRET_PATTERNS = [
  /(password|passwd|pwd|token|secret|api[_-]?key)\s*[=:]\s*\S+/gi,
  /1Rs50U\$D/g,
  /D0N0harm/g,
  /Helix@dm1n/g,
  /#D3Pl0y_M3nT\$/g,
  /bmcAdm1n/g,
];

function maskSecrets(text) {
  let out = String(text || '');
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (m) => {
      const key = m.split(/[=:]/)[0];
      return key ? `${key}=****` : '****';
    });
  }
  return out.slice(0, 2000);
}

function resolveActor(req) {
  if (!req) return 'system';
  return req.headers['x-actor']
    || req.headers['x-user-name']
    || (req.userActor)
    || 'user';
}

function resolveTenant() {
  return process.env.TENANT_ID || process.env.ORG_NAME || 'default';
}

/**
 * @param {object} entry
 * @param {string} entry.action - e.g. login, wmi.detect, power.off
 * @param {string} entry.status - started|success|failed|retry
 * @param {string} [entry.message]
 * @param {number} [entry.durationMs]
 * @param {string} [entry.actor]
 * @param {string} [entry.tenant]
 * @param {string} [entry.vmId]
 * @param {string} [entry.vmName]
 * @param {string} [entry.level]
 * @param {string} [entry.category]
 * @param {object} [entry.meta]
 * @param {object} [io]
 */
async function log(entry, io) {
  const payload = {
    timestamp: new Date(),
    level: entry.level || (entry.status === 'failed' ? 'error' : entry.status === 'success' ? 'success' : 'info'),
    category: entry.category || categorizeAction(entry.action),
    message: maskSecrets(entry.message || `${entry.action} ${entry.status}`),
    vmId: entry.vmId,
    vmName: entry.vmName,
    jobId: entry.jobId,
    actor: entry.actor || 'system',
    tenant: entry.tenant || resolveTenant(),
    action: entry.action,
    status: entry.status || 'info',
    durationMs: entry.durationMs ?? null,
    meta: entry.meta || {},
  };

  const doc = await activityLog.write(payload, io);
  io?.emit('audit:log', doc);
  if (entry.vmId) {
    io?.emit('audit:vm-log', { vmId: entry.vmId, entry: doc });
  }
  return doc;
}

function categorizeAction(action) {
  const a = String(action || '');
  if (a.startsWith('login') || a.startsWith('provision')) return 'provision';
  if (a.startsWith('power.')) return 'power';
  if (a.startsWith('wmi.') || a.startsWith('rscd.')) return 'wmi';
  if (a.startsWith('vm.')) return 'vm';
  if (a.startsWith('job.')) return 'job';
  if (a.startsWith('console.')) return 'console';
  if (a.startsWith('sync.')) return 'sync';
  if (a.startsWith('rdp.')) return 'console';
  if (a.startsWith('deploy')) return 'job';
  return 'system';
}

function withAudit(req, io, action, fn) {
  const actor = resolveActor(req);
  const tenant = resolveTenant();
  const started = Date.now();
  return log({ action, status: 'started', actor, tenant, message: `${action} started` }, io)
    .then(() => fn())
    .then(async (result) => {
      await log({
        action,
        status: 'success',
        actor,
        tenant,
        durationMs: Date.now() - started,
        vmId: result?.vmId,
        vmName: result?.vmName,
        message: result?.message || `${action} completed`,
        meta: result?.meta,
      }, io);
      return result;
    })
    .catch(async (err) => {
      await log({
        action,
        status: 'failed',
        actor,
        tenant,
        durationMs: Date.now() - started,
        level: 'error',
        message: maskSecrets(err.message),
      }, io);
      throw err;
    });
}

module.exports = {
  log,
  maskSecrets,
  resolveActor,
  resolveTenant,
  withAudit,
  categorizeAction,
};
