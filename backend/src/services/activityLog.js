const ActivityLog = require('../models/ActivityLog');

const MAX_LOGS = parseInt(process.env.MAX_ACTIVITY_LOGS || '50000', 10);

async function write(entry, io) {
  const category = String(entry.category || 'system').slice(0, 64);
  const doc = await ActivityLog.create({
    timestamp: entry.timestamp || new Date(),
    level: entry.level || 'info',
    category,
    message: entry.message,
    actor: entry.actor || 'system',
    tenant: entry.tenant || 'default',
    action: entry.action || null,
    status: entry.status || 'info',
    durationMs: entry.durationMs ?? null,
    vmId: entry.vmId,
    vmName: entry.vmName,
    jobId: entry.jobId,
    meta: entry.meta,
  });

  const payload = doc.toObject();
  io?.emit('log:activity', payload);

  const count = await ActivityLog.countDocuments();
  if (count > MAX_LOGS) {
    const trim = count - MAX_LOGS;
    const old = await ActivityLog.find().sort({ timestamp: 1 }).limit(trim).select('_id');
    if (old.length) await ActivityLog.deleteMany({ _id: { $in: old.map((o) => o._id) } });
  }

  return payload;
}

async function list({ limit = 200, category, level, search, vmId, action } = {}) {
  const query = {};
  if (category) query.category = category;
  if (level) query.level = level;
  if (vmId) query.vmId = vmId;
  if (action) query.action = action;
  if (search) {
    const re = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [{ message: re }, { vmName: re }, { category: re }, { action: re }, { actor: re }];
  }
  const logs = await ActivityLog.find(query).sort({ timestamp: -1 }).limit(limit).lean();
  return logs;
}

module.exports = { write, list };
