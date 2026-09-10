const express = require('express');
const VM = require('../../models/VM');
const Job = require('../../models/Job');
const activityLog = require('../../services/activityLog');

const router = express.Router();

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

router.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) {
    return res.json({ success: true, results: [] });
  }

  const re = new RegExp(escapeRe(q), 'i');

  const [vms, jobs, logs] = await Promise.all([
    VM.find({ $or: [{ name: re }, { ip: re }, { fqdn: re }] })
      .sort({ name: 1 })
      .limit(8)
      .lean(),
    Job.find({ $or: [{ name: re }, { status: re }] })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
    activityLog.list({ search: q, limit: 5 }),
  ]);

  const results = [
    ...vms.map((v) => ({
      type: 'vm',
      id: v._id,
      label: v.name,
      sub: v.ip || v.fqdn || '',
    })),
    ...jobs.map((j) => ({
      type: 'job',
      id: j._id,
      label: j.name,
      sub: j.status,
    })),
    ...logs.map((l) => ({
      type: 'log',
      id: l._id,
      label: (l.vmName ? `[${l.vmName}] ` : '') + String(l.message || '').slice(0, 80),
      sub: l.category,
    })),
  ];

  res.json({ success: true, results });
});

module.exports = router;
