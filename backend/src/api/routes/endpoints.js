const express = require('express');
const VM = require('../../models/VM');
const uninstall = require('../../services/uninstall');
const programQuery = require('../../services/programQuery');
const registrySoftware = require('../../services/registrySoftware');
const deployInstall = require('../../services/deployInstall');
const { decryptIfNeeded } = require('../../utils/credentialCrypto');
const audit = require('../../utils/audit');

const router = express.Router();
const io = (req) => req.app.get('io');

router.post('/programs', async (req, res) => {
  try {
    const { endpointIds, environment } = req.body;
    if (!endpointIds?.length) return res.status(400).json({ success: false, message: 'endpointIds required' });
    const data = await programQuery.queryProgramsParallel(endpointIds, environment);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/:id/programs', async (req, res) => {
  const vm = await VM.findById(req.params.id).select('+wmiPassword');
  if (!vm) return res.status(404).json({ success: false, message: 'Not found' });
  if (vm.softwareSnapshot?.programs?.length) {
    return res.json({
      success: true,
      data: { programs: vm.softwareSnapshot.programs, capturedAt: vm.softwareSnapshot.capturedAt, source: 'snapshot' },
    });
  }
  try {
    const plain = { ...vm.toObject(), wmiPassword: decryptIfNeeded(vm.wmiPassword) };
    const session = deployInstall.sessionFromVm(plain);
    const { programs, agents, capturedAt } = await registrySoftware.fetchInstalledPrograms(session);
    res.json({ success: true, data: { programs, agents, capturedAt, source: 'live' } });
  } catch (err) {
    res.status(502).json({ success: false, message: audit.maskSecrets(err.message) });
  }
});

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
