const express = require('express');
const VM = require('../../models/VM');
const activityLog = require('../../services/activityLog');
const endpointOps = require('../../services/endpointOps');
const audit = require('../../utils/audit');
const { requireOperator } = require('../../middleware/operatorAuth');

const router = express.Router({ mergeParams: true });
const io = (req) => req.app.get('io');

async function loadVm(id) {
  const vm = await VM.findById(id).select('+wmiPassword').lean();
  if (!vm) return null;
  return vm;
}

router.get('/detail/:tab', async (req, res) => {
  const vm = await loadVm(req.params.id);
  if (!vm) return res.status(404).json({ success: false, message: 'Not found' });

  const tab = req.params.tab;
  const actor = audit.resolveActor(req);
  const started = Date.now();

  try {
    let data;
    switch (tab) {
      case 'overview':
        data = await endpointOps.fetchOverview(vm);
        break;
      case 'system':
        data = await endpointOps.fetchSystem(vm);
        break;
      case 'local-users':
        data = await endpointOps.fetchLocalUsers(vm);
        await VM.findByIdAndUpdate(vm._id, { localUsers: { ...data, checkedAt: new Date() } });
        break;
      case 'software':
        data = await endpointOps.fetchSoftware(vm);
        break;
      case 'rscd':
        data = await endpointOps.fetchRscd(vm, () => {});
        break;
      case 'power':
        data = await endpointOps.fetchPowerState(vm);
        break;
      case 'console':
        data = endpointOps.consoleInfo(vm);
        break;
      case 'logs':
      case 'audit':
        data = await activityLog.list({ vmId: vm._id, limit: 300 });
        break;
      default:
        return res.status(400).json({ success: false, message: `Unknown tab: ${tab}` });
    }

    await audit.log({
      action: `endpoint.tab.${tab}`,
      status: 'success',
      actor,
      vmId: vm._id,
      vmName: vm.name,
      durationMs: Date.now() - started,
      message: `Loaded ${tab} for ${vm.name}`,
    }, io(req));

    return res.json({ success: true, tab, data });
  } catch (err) {
    await audit.log({
      action: `endpoint.tab.${tab}`,
      status: 'failed',
      actor,
      vmId: vm._id,
      vmName: vm.name,
      durationMs: Date.now() - started,
      level: 'error',
      message: audit.maskSecrets(err.message),
    }, io(req));
    return res.status(500).json({ success: false, message: audit.maskSecrets(err.message) });
  }
});

router.post('/refresh-local-users', async (req, res) => {
  const vm = await loadVm(req.params.id);
  if (!vm) return res.status(404).json({ success: false, message: 'Not found' });
  const actor = audit.resolveActor(req);
  const started = Date.now();
  try {
    const data = await endpointOps.fetchLocalUsers(vm);
    await VM.findByIdAndUpdate(vm._id, {
      localUsers: { ...data, checkedAt: new Date() },
      powerState: vm.status === 'online' ? 'on' : vm.powerState,
    });
    await audit.log({
      action: 'localusers.probe',
      status: 'success',
      actor,
      vmId: vm._id,
      vmName: vm.name,
      durationMs: Date.now() - started,
      message: `Local users ${data.present}/${data.required} on ${vm.name}`,
      meta: { present: data.present, required: data.required },
    }, io(req));
    res.json({ success: true, data });
  } catch (err) {
    await audit.log({
      action: 'localusers.probe',
      status: 'failed',
      actor,
      vmId: vm._id,
      vmName: vm.name,
      durationMs: Date.now() - started,
      level: 'error',
      message: audit.maskSecrets(err.message),
    }, io(req));
    res.status(500).json({ success: false, message: audit.maskSecrets(err.message) });
  }
});

router.post('/power', requireOperator, async (req, res) => {
  const vm = await loadVm(req.params.id);
  if (!vm) return res.status(404).json({ success: false, message: 'Not found' });
  const { action, password } = req.body;
  if (!action) return res.status(400).json({ success: false, message: 'action required' });
  const actor = audit.resolveActor(req);
  try {
    const result = await endpointOps.executePower(vm, action, password, io(req), actor);
    const powerState = action.includes('off') ? 'off' : vm.powerState;
    await VM.findByIdAndUpdate(vm._id, { powerState });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, message: audit.maskSecrets(err.message) });
  }
});

module.exports = router;
