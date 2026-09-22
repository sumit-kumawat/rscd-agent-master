const express = require('express');
const Job = require('../../models/Job');
const deploymentService = require('../../services/deploymentService');
const programQuery = require('../../services/programQuery');
const { requireOperator } = require('../../middleware/operatorAuth');

const router = express.Router();
const io = (req) => req.app.get('io');

router.post('/install', requireOperator, async (req, res) => {
  try {
    const job = await deploymentService.createInstallJob(req.body, io(req), req.actor);
    res.status(201).json({ success: true, data: job, job });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/uninstall', requireOperator, async (req, res) => {
  try {
    const job = await deploymentService.createUninstallJob(req.body, io(req), req.actor);
    res.status(201).json({ success: true, data: job, job });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/:id', async (req, res) => {
  const job = await Job.findById(req.params.id).populate('vms').populate('packageId');
  if (!job) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true, data: job });
});

router.get('/:id/stream', async (req, res) => {
  const job = await Job.findById(req.params.id).select('endpointResults statistics status progress logs');
  if (!job) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true, data: job });
});

router.post('/:id/cancel', requireOperator, async (req, res) => {
  try {
    const job = await deploymentService.cancelJob(req.params.id, io(req));
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/:id/retry-failed', requireOperator, async (req, res) => {
  try {
    const job = await deploymentService.retryFailed(req.params.id, io(req));
    res.status(201).json({ success: true, data: job, job });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/programs/query', requireOperator, async (req, res) => {
  try {
    const { endpointIds, environment } = req.body;
    if (!endpointIds?.length) return res.status(400).json({ success: false, message: 'endpointIds required' });
    const data = await programQuery.queryProgramsParallel(endpointIds, environment);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;
