const express = require('express');
const uninstall = require('../../services/uninstall');
const audit = require('../../utils/audit');

const router = express.Router();
const io = (req) => req.app.get('io');

/** Bulk RSCD agent uninstall — parallel across endpoints, sequential per host. */
router.post('/bulk-uninstall-rscd', async (req, res) => {
  const endpointIds = req.body?.endpointIds || req.body?.vmIds || req.body?.ids;
  if (!Array.isArray(endpointIds) || !endpointIds.length) {
    return res.status(400).json({ success: false, message: 'endpointIds array is required' });
  }

  const actor = audit.resolveActor(req);
  const job = await uninstall.createJob({
    name: `Bulk RSCD uninstall (${endpointIds.length} endpoints)`,
    vmIds: endpointIds,
    filter: { useBelowVersion: false },
    type: 'rscd_uninstall',
  }, io(req));

  await audit.log({
    action: 'rscd.bulk_uninstall',
    status: 'started',
    actor,
    message: `Bulk RSCD uninstall queued for ${endpointIds.length} endpoint(s)`,
    meta: { jobId: job._id, count: endpointIds.length },
  }, io(req));

  return res.status(201).json({ success: true, data: job, job });
});

module.exports = router;
