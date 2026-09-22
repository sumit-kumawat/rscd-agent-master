const crypto = require('crypto');
const audit = require('../utils/audit');

const sessions = new Map();

function sessionTtlMs() {
  return parseInt(process.env.RDP_SESSION_TTL_MS || '3600000', 10) || 3600000;
}

function guacamoleConnectionId(host) {
  const connection = process.env.GUACAMOLE_CONNECTION_PREFIX || 'rdp-';
  return `${connection}${host}`;
}

function buildGuacamoleUrl(host) {
  const base = (process.env.GUACAMOLE_PUBLIC_URL || '').replace(/\/$/, '');
  if (!base) return null;
  const id = guacamoleConnectionId(host);
  return `${base}/#/client/${encodeURIComponent(id)}`;
}

function credentialOrderHint() {
  return ['rdsroot', 'rdsmon', 'Administrator'];
}

async function launchSession(vm, actor, io) {
  const host = (vm.fqdn || vm.name || vm.ip || '').trim();
  if (!host) throw new Error('No hostname or IP for remote desktop');

  const sessionId = crypto.randomBytes(16).toString('hex');
  const startedAt = new Date();
  sessions.set(sessionId, {
    sessionId,
    vmId: String(vm._id),
    vmName: vm.name,
    host,
    actor,
    startedAt,
  });

  setTimeout(() => sessions.delete(sessionId), sessionTtlMs());

  await audit.log({
    action: 'rdp.session.start',
    status: 'started',
    actor,
    vmId: vm._id,
    vmName: vm.name,
    message: `Remote desktop session started for ${vm.name} (${host})`,
    meta: { sessionId, host },
  }, io);

  const guacUrl = buildGuacamoleUrl(host);
  if (guacUrl) {
    return {
      mode: 'guacamole',
      url: guacUrl,
      sessionId,
      host,
      credentialOrder: credentialOrderHint(),
      embedPath: `/api/vms/${vm._id}/remote-desktop/embed?session=${sessionId}`,
    };
  }

  return {
    mode: 'native',
    sessionId,
    host,
    url: `rdp://full%20address=s:${host}`,
    credentialOrder: credentialOrderHint(),
    message: 'Opening native Remote Desktop. Configure Guacamole with platform credentials (rdsroot, rdsmon, Administrator) for passwordless browser RDP.',
  };
}

async function endSession(sessionId, actor, io) {
  const s = sessions.get(sessionId);
  if (!s) return null;
  sessions.delete(sessionId);
  const durationMs = Date.now() - new Date(s.startedAt).getTime();
  await audit.log({
    action: 'rdp.session.end',
    status: 'success',
    actor,
    vmId: s.vmId,
    vmName: s.vmName,
    durationMs,
    message: `Remote desktop session ended for ${s.vmName}`,
    meta: { sessionId: s.sessionId, host: s.host },
  }, io);
  return { durationMs };
}

function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

module.exports = {
  launchSession,
  endSession,
  getSession,
  guacamoleConnectionId,
  buildGuacamoleUrl,
};
