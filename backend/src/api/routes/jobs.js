const express = require('express');
const Job = require('../../models/Job');
const deploymentService = require('../../services/deploymentService');
const { requireOperator } = require('../../middleware/operatorAuth');
const audit = require('../../utils/audit');

const router = express.Router();
const io = (req) => req.app.get('io');

router.get('/', async (req, res) => {
  const { search } = req.query;
  const query = {};
  if (search) {
    const re = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [{ name: re }, { status: re }];
  }
  const jobs = await Job.find(query).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ success: true, data: jobs });
});

router.get('/:id', async (req, res) => {
  const job = await Job.findById(req.params.id).populate('vms');
  if (!job) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true, data: job });
});

router.post('/', requireOperator, async (req, res) => {
  const actor = audit.resolveActor(req);
  const job = await deploymentService.createUninstallJob(req.body, io(req), actor);
  res.status(201).json({ success: true, data: job, job });
});

router.post('/:id/cancel', requireOperator, async (req, res) => {
  try {
    const job = await deploymentService.cancelJob(req.params.id, io(req));
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/:id/logs', async (req, res) => {
  const job = await Job.findById(req.params.id).select('logs');
  if (!job) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true, logs: job.logs });
});

module.exports = router;
