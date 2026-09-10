const express = require('express');
const multer = require('multer');
const VM = require('../../models/VM');
const monitor = require('../../services/monitor');
const { importExcel, importTxt } = require('../../services/import');
const connectivity = require('../../services/connectivity');
const uninstall = require('../../services/uninstall');
const { deleteVmsWithCleanup } = require('../../services/vmCleanup');
const activityLog = require('../../services/activityLog');
const { requireOperator } = require('../../middleware/operatorAuth');
const { isAgentRemoved } = require('../../utils/agentStatus');
const { normalizeVmIdentity } = require('../../utils/hosts');
const { queueVmCheck } = require('../../services/vmCheckQueue');

const io = (req) => req.app.get('io');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.get('/', async (req, res) => {
  const { search, status, agentStatus } = req.query;
  const query = { osType: 'windows' };
  if (search) {
    const re = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [{ name: re }, { ip: re }, { fqdn: re }];
  }
  if (agentStatus === 'active' || agentStatus === 'removed') {
    query.agentStatus = agentStatus;
  }
  if (status === 'excluded') query.excluded = true;
  else if (status) { query.status = status; query.excluded = false; }

  const vms = await VM.find(query).sort({ name: 1 }).limit(20000).lean();
  res.json({ success: true, data: vms, total: vms.length });
});

router.get('/stats', async (req, res) => {
  const base = { excluded: false, osType: 'windows' };
  const removedQuery = { ...base, $or: [{ agentStatus: 'removed' }, { version: 'removed' }] };
  const activeQuery = { ...base, agentStatus: { $ne: 'removed' }, version: { $ne: 'removed' } };
  const [total, online, offline, active, removed] = await Promise.all([
    VM.countDocuments(base),
    VM.countDocuments({ status: 'online', excluded: false }),
    VM.countDocuments({ status: 'offline', excluded: false }),
    VM.countDocuments(activeQuery),
    VM.countDocuments(removedQuery),
  ]);
  res.json({ success: true, stats: { total, online, offline, active, removed } });
});

router.post('/import-excel', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'Excel file required' });
  const replace = req.body.replace === 'true';
  const result = await importExcel(req.file.buffer, { replace, io: io(req) });
  res.json({ success: true, ...result });
});

router.post('/import-txt', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'TXT file required' });
  const replace = req.body.replace === 'true';
  const text = req.file.buffer.toString('utf8');
  const result = await importTxt(text, { replace, io: io(req) });
  res.json({ success: true, ...result });
});

router.post('/import', async (req, res) => {
  const { hosts, replace } = req.body;
  if (!hosts || typeof hosts !== 'string') {
    return res.status(400).json({ success: false, message: 'hosts text is required' });
  }
  const result = await importTxt(hosts, { replace: !!replace, io: io(req) });
  res.json({ success: true, ...result });
});

router.post('/check-all', async (req, res) => {
  monitor.run();
  res.json({ success: true, message: 'Check started' });
});

router.post('/bulk-exclude', requireOperator, async (req, res) => {
  const { ids } = req.body;
  await VM.updateMany({ _id: { $in: ids } }, { $set: { excluded: true, status: 'excluded' } });
  res.json({ success: true });
});

router.post('/bulk-delete', requireOperator, async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ success: false, message: 'ids array required' });
  }
  const vms = await VM.find({ _id: { $in: ids } });
  const blocked = vms.filter(isAgentRemoved).map((v) => v.name);
  if (blocked.length) {
    return res.status(400).json({
      success: false,
      message: `Cannot delete Removed agent record(s): ${blocked.join(', ')}`,
    });
  }
  const result = await deleteVmsWithCleanup(ids, io(req));
  res.json({ success: true, ...result });
});

router.post('/', async (req, res) => {
  const { name, ip, fqdn, version, installRoot, site, excluded } = req.body;
  const identity = normalizeVmIdentity(name, ip, fqdn);
  if (identity.error) {
    return res.status(400).json({ success: false, message: identity.error });
  }
  const existing = await VM.findOne({ name: identity.name });
  if (existing) {
    return res.status(409).json({ success: false, message: 'VM with this hostname already exists' });
  }
  const vm = await VM.create({
    name: identity.name,
    fqdn: identity.fqdn,
    ip: identity.ip || '',
    os: 'Windows',
    osType: 'windows',
    version: String(version || 'unknown').trim(),
    installRoot: installRoot ? String(installRoot).trim() : '',
    site: site ? String(site).trim() : '',
    excluded: !!excluded,
    status: excluded ? 'excluded' : 'offline',
    agentStatus: 'active',
    connectivityMethod: 'none',
  });
  await activityLog.write({
    category: 'vm', level: 'success', message: `VM added: ${vm.name}`, vmId: vm._id, vmName: vm.name,
  }, io(req));
  queueVmCheck(vm._id, io(req));
  res.status(201).json({ success: true, data: vm, checkQueued: true });
});

router.put('/:id', async (req, res) => {
  const vm = await VM.findById(req.params.id);
  if (!vm) return res.status(404).json({ success: false, message: 'Not found' });
  if (isAgentRemoved(vm)) {
    return res.status(400).json({ success: false, message: 'Agent is Removed — record cannot be edited' });
  }

  const { name, ip, fqdn, version, installRoot, site, excluded, wmiDomain, wmiUsername, wmiPassword } = req.body;
  const identity = normalizeVmIdentity(
    name != null ? name : vm.name,
    ip != null ? ip : vm.ip,
    fqdn != null ? fqdn : vm.fqdn,
  );
  if (identity.error) {
    return res.status(400).json({ success: false, message: identity.error });
  }
  vm.name = identity.name;
  vm.ip = identity.ip;
  vm.fqdn = identity.fqdn;
  if (version != null) vm.version = String(version).trim();
  if (installRoot != null) vm.installRoot = String(installRoot).trim();
  if (site != null) vm.site = String(site).trim();
  if (excluded != null) {
    vm.excluded = !!excluded;
    if (vm.excluded) vm.status = 'excluded';
    else if (vm.status === 'excluded') vm.status = 'offline';
  }
  if (wmiDomain != null) vm.wmiDomain = String(wmiDomain).trim();
  if (wmiUsername != null) vm.wmiUsername = String(wmiUsername).trim();
  if (wmiPassword != null && wmiPassword !== '') vm.wmiPassword = String(wmiPassword);

  const dup = await VM.findOne({ name: vm.name, _id: { $ne: vm._id } });
  if (dup) {
    return res.status(409).json({ success: false, message: 'Another VM with this hostname already exists' });
  }

  await vm.save();
  await activityLog.write({
    category: 'vm', level: 'info', message: `VM updated: ${vm.name}`, vmId: vm._id, vmName: vm.name,
  }, io(req));
  res.json({ success: true, data: vm });
});

router.delete('/:id', requireOperator, async (req, res) => {
  const exists = await VM.findById(req.params.id);
  if (!exists) return res.status(404).json({ success: false, message: 'Not found' });
  if (isAgentRemoved(exists)) {
    return res.status(400).json({ success: false, message: 'Agent is Removed — record cannot be deleted' });
  }
  const result = await deleteVmsWithCleanup([req.params.id], io(req));
  res.json({ success: true, message: 'Deleted', ...result });
});

router.post('/:id/uninstall', requireOperator, async (req, res) => {
  const vm = await VM.findById(req.params.id);
  if (!vm) return res.status(404).json({ success: false, message: 'Not found' });
  if (isAgentRemoved(vm)) {
    return res.status(400).json({ success: false, message: 'Agent is already Removed — uninstall not applicable' });
  }
  const job = await uninstall.createJob({
    name: req.body.name || `Uninstall — ${vm.name}`,
    vmIds: [vm._id],
    filter: { useBelowVersion: false },
  }, req.app.get('io'));
  res.status(201).json({ success: true, data: job, job });
});

router.post('/:id/check', async (req, res) => {
  const vm = await VM.findById(req.params.id).select('+wmiPassword');
  if (!vm) return res.status(404).json({ success: false, message: 'Not found' });
  const { result, vm: updated } = await connectivity.checkAndUpdate(vm);
  const socket = io(req);
  socket?.emit('vm:status', {
    vmId: updated._id,
    name: updated.name,
    status: updated.status,
    connectivity: result.connectivity,
    agentStatus: updated.agentStatus,
    ip: updated.ip,
    version: updated.version,
    lastCheck: updated.lastCheck,
  });
  res.json({
    success: true,
    data: updated,
    probe: {
      connectivity: result.connectivity,
      agentStatus: result.agentStatus,
      ip: result.ip,
      error: result.error || null,
    },
  });
});

module.exports = router;
