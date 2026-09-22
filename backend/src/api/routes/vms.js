const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const VM = require('../../models/VM');
const monitor = require('../../services/monitor');
const { importExcel, importTxt } = require('../../services/import');
const connectivity = require('../../services/connectivity');
const { deleteVmsWithCleanup } = require('../../services/vmCleanup');
const activityLog = require('../../services/activityLog');
const { requireOperator } = require('../../middleware/operatorAuth');
const { isAgentRemoved } = require('../../utils/agentStatus');
const { normalizeVmIdentity } = require('../../utils/hosts');
const { queueVmCheck } = require('../../services/vmCheckQueue');
const { normalizeIdentity } = require('../../utils/wmiCredentials');

const io = (req) => req.app.get('io');

const endpointDetail = require('./endpointDetail');
const audit = require('../../utils/audit');
const deploymentService = require('../../services/deploymentService');
const deployConfig = require('../../config/deployConfig');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.post('/bulk-power', requireOperator, async (req, res) => {
  const { ids, action, password } = req.body;
  if (!Array.isArray(ids) || !ids.length || !action) {
    return res.status(400).json({ success: false, message: 'ids and action required' });
  }
  const endpointOps = require('../../services/endpointOps');
  const actor = audit.resolveActor(req);
  const results = [];
  for (const id of ids) {
    const vm = await VM.findById(id).lean();
    if (!vm) { results.push({ id, ok: false, error: 'not found' }); continue; }
    try {
      await endpointOps.executePower(vm, action, password, io(req), actor);
      results.push({ id, ok: true, vm: vm.name });
    } catch (err) {
      results.push({ id, ok: false, vm: vm.name, error: audit.maskSecrets(err.message) });
    }
  }
  res.json({ success: true, results });
});

function environmentQuery(environment) {
  if (environment === 'prod') return { environment: 'prod' };
  if (environment === 'rnd') {
    return {
      $or: [
        { environment: 'rnd' },
        { environment: { $exists: false } },
        { environment: null },
      ],
    };
  }
  return null;
}

router.get('/', async (req, res) => {
  const { search, status, agentStatus, environment } = req.query;
  const and = [{ osType: 'windows' }];
  const envQ = environmentQuery(environment);
  if (envQ) and.push(envQ);
  if (search) {
    const re = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    and.push({ $or: [{ name: re }, { ip: re }, { fqdn: re }] });
  }
  if (agentStatus === 'active' || agentStatus === 'removed') {
    and.push({ agentStatus });
  }
  if (status === 'excluded') and.push({ excluded: true });
  else if (status) and.push({ status, excluded: false });

  const query = and.length === 1 ? and[0] : { $and: and };
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
  await audit.log({
    action: 'vm.create', status: 'success', actor: audit.resolveActor(req),
    vmId: vm._id, vmName: vm.name, message: `VM added: ${vm.name}`,
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

  const {
    name, ip, fqdn, version, installRoot, site, excluded, environment,
    wmiDomain, wmiUsername, wmiPassword,
  } = req.body;
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
  if (environment === 'rnd' || environment === 'prod') vm.environment = environment;
  if (wmiUsername != null || wmiDomain != null || wmiPassword != null) {
    const userInput = wmiUsername != null ? String(wmiUsername).trim() : vm.wmiUsername;
    if (!userInput) {
      vm.wmiUsername = '';
      vm.wmiDomain = '';
      if (wmiPassword != null) vm.wmiPassword = '';
    } else {
      const normalized = normalizeIdentity({
        username: userInput,
        domain: wmiDomain != null ? wmiDomain : vm.wmiDomain,
      });
      vm.wmiUsername = normalized.username;
      vm.wmiDomain = normalized.domain || '';
      if (wmiPassword != null && wmiPassword !== '') vm.wmiPassword = String(wmiPassword);
    }
  }

  const dup = await VM.findOne({ name: vm.name, _id: { $ne: vm._id } });
  if (dup) {
    return res.status(409).json({ success: false, message: 'Another VM with this hostname already exists' });
  }

  await vm.save();
  const agentProbe = require('../../services/agentProbe');
  agentProbe.clearSession(vm);
  queueVmCheck(vm._id, io(req));
  await audit.log({
    action: 'vm.update', status: 'success', actor: audit.resolveActor(req),
    vmId: vm._id, vmName: vm.name, message: `VM updated: ${vm.name}`,
  }, io(req));
  res.json({ success: true, data: vm, checkQueued: true });
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

router.post('/bulk-uninstall-rscd', requireOperator, async (req, res) => {
  const endpointIds = req.body?.endpointIds || req.body?.ids || req.body?.vmIds;
  if (!Array.isArray(endpointIds) || !endpointIds.length) {
    return res.status(400).json({ success: false, message: 'endpointIds array is required' });
  }
  const environment = req.body?.environment || deployConfig.defaultEnvironment;
  const actor = audit.resolveActor(req);
  const job = await deploymentService.createUninstallJob({
    name: `Bulk RSCD uninstall (${endpointIds.length} endpoints)`,
    endpointIds,
    target: 'rscd',
    environment,
    options: { bulkConfirmed: true, ...(req.body?.options || {}) },
  }, io(req), actor);
  return res.status(201).json({ success: true, data: job, job });
});

router.post('/:id/uninstall', requireOperator, async (req, res) => {
  const vm = await VM.findById(req.params.id);
  if (!vm) return res.status(404).json({ success: false, message: 'Not found' });
  const environment = req.body?.environment || vm.environment || deployConfig.defaultEnvironment;
  const actor = audit.resolveActor(req);
  const job = await deploymentService.createUninstallJob({
    name: req.body.name || `Uninstall — ${vm.name}`,
    endpointIds: [vm._id],
    target: 'rscd',
    environment,
    options: req.body?.options || {},
  }, io(req), actor);
  res.status(201).json({ success: true, data: job, job });
});

router.post('/:id/check', async (req, res) => {
  const vm = await VM.findById(req.params.id).select('+wmiPassword');
  if (!vm) return res.status(404).json({ success: false, message: 'Not found' });
  const fullInventory = req.query.full === '1' || req.query.full === 'true';
  const { result, vm: updated } = await connectivity.checkAndUpdate(vm, { lightweight: !fullInventory });
  const socket = io(req);
  socket?.emit('vm:status', {
    vmId: updated._id,
    name: updated.name,
    status: updated.status,
    connectivity: result.connectivityState || result.connectivity,
    connectivityState: updated.connectivityState,
    authStatus: updated.authStatus || (updated.status === 'online' ? 'allowed' : 'unknown'),
    agentStatus: updated.agentStatus,
    ip: updated.ip,
    version: updated.version,
    lastCheck: updated.lastCheck,
    lastProbeError: updated.lastProbeError,
  });
  res.json({
    success: true,
    data: updated,
    probe: {
      connectivity: result.connectivityState || result.connectivity,
      connectivityState: result.connectivityState,
      agentStatus: result.agentStatus,
      ip: result.ip,
      error: result.error || null,
      errorKind: result.errorKind || null,
      diagnostics: result.diagnostics || null,
    },
  });
});

router.post('/:id/diagnostics', async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid VM id — use a 24-character MongoDB ObjectId from GET /api/vms',
    });
  }
  const vm = await VM.findById(id).select('+wmiPassword');
  if (!vm) return res.status(404).json({ success: false, message: 'VM not found' });
  try {
    const agentProbe = require('../../services/agentProbe');
    const staged = await agentProbe.diagnose(vm);
    const { result, vm: updated } = await connectivity.checkAndUpdate(vm, { lightweight: true });
    const socket = io(req);
    socket?.emit('vm:status', {
      vmId: updated._id,
      name: updated.name,
      status: updated.status,
      connectivity: result.connectivityState || result.connectivity,
      connectivityState: updated.connectivityState,
      agentStatus: updated.agentStatus,
      ip: updated.ip,
      version: updated.version,
      lastCheck: updated.lastCheck,
      lastProbeError: updated.lastProbeError,
    });
    const diagnostics = {
      ...(staged.diagnostics || {}),
      wmiSession: {
        status: result.connectivityState === 'online' ? 'PASS' : 'FAIL',
        detail: result.error || 'WMI DCOM session validated',
      },
    };
    return res.json({
      success: true,
      vmId: id,
      vmName: vm.name,
      vmUpdated: true,
      status: updated.status,
      failureCategory: staged.failureCategory || result.diagnostics?.failureCategory || null,
      diagnostics,
      connectivity: result.connectivityState || result.connectivity,
      error: result.error || staged.error || null,
      errorKind: result.errorKind || staged.errorKind || null,
      data: updated,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Diagnostics failed',
      error: String(err.message || err).slice(0, 300),
    });
  }
});

const remoteDesktop = require('../../services/remoteDesktop');

router.post('/:id/remote-desktop/launch', async (req, res) => {
  const vm = await VM.findById(req.params.id).lean();
  if (!vm) return res.status(404).json({ success: false, message: 'Not found' });
  try {
    const data = await remoteDesktop.launchSession(vm, audit.resolveActor(req), io(req));
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/remote-desktop/end', async (req, res) => {
  const { sessionId } = req.body || {};
  if (!sessionId) return res.status(400).json({ success: false, message: 'sessionId required' });
  const data = await remoteDesktop.endSession(sessionId, audit.resolveActor(req), io(req));
  res.json({ success: true, data });
});

router.get('/:id/remote-desktop/embed', (req, res) => {
  const session = remoteDesktop.getSession(req.query.session);
  const guac = (process.env.GUACAMOLE_PUBLIC_URL || '').replace(/\/$/, '');
  if (!session || !guac) {
    return res.status(404).send('Remote desktop session unavailable. Configure GUACAMOLE_PUBLIC_URL.');
  }
  const connId = remoteDesktop.guacamoleConnectionId(session.host);
  const src = `${guac}/#/client/${encodeURIComponent(connId)}`;
  res.setHeader('Content-Security-Policy', `frame-src ${guac}`);
  res.type('html').send(
    `<!DOCTYPE html><html><head><title>RDP — ${session.vmName}</title></head>`
    + `<body style="margin:0;background:#052140">`
    + `<iframe title="Remote Desktop" src="${src}" style="width:100%;height:100vh;border:0"></iframe>`
    + `<script>window.addEventListener('beforeunload',()=>{navigator.sendBeacon('/api/vms/remote-desktop/end',`
    + `new Blob([JSON.stringify({sessionId:'${session.sessionId}'})],{type:'application/json'}));});</script>`
    + `</body></html>`,
  );
});

/** Mount detail sub-routes last so /:id/check, /:id/uninstall, etc. match first */
router.use('/:id', endpointDetail);

module.exports = router;
