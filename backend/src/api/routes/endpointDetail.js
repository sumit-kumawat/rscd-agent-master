const express = require('express');
const VM = require('../../models/VM');
const activityLog = require('../../services/activityLog');
const endpointOps = require('../../services/endpointOps');
const { inventoryForTab, isOnline } = require('../../services/endpointInventory');
const audit = require('../../utils/audit');
const wmiConfig = require('../../config/wmi');

const router = express.Router({ mergeParams: true });
const io = (req) => req.app.get('io');

const TAB_TIMEOUT_MS = Math.min(
  wmiConfig.queryTimeoutMs * 2,
  parseInt(process.env.ENDPOINT_TAB_TIMEOUT_MS || '60000', 10) || 60000,
);

function withTabTimeout(promise, tab) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${tab} probe timed out after ${TAB_TIMEOUT_MS}ms`)), TAB_TIMEOUT_MS);
    }),
  ]);
}

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

  const inventoryOnly = ['console', 'logs', 'audit'];
  const needsWmi = !inventoryOnly.includes(tab);

  if (needsWmi && !isOnline(vm)) {
    const data = tab === 'logs' || tab === 'audit'
      ? await activityLog.list({ vmId: vm._id, limit: 300 })
      : inventoryForTab(vm, tab);
    return res.json({
      success: true,
      tab,
      data,
      stale: true,
      message: 'Endpoint offline — showing last inventory snapshot',
    });
  }

  try {
    let data;
    const run = async () => {
      switch (tab) {
        case 'overview':
          return endpointOps.fetchOverview(vm);
        case 'system':
          return endpointOps.fetchSystem(vm);
        case 'local-users': {
          const lu = await endpointOps.fetchLocalUsers(vm);
          await VM.findByIdAndUpdate(vm._id, { localUsers: { ...lu, checkedAt: new Date() } });
          return lu;
        }
        case 'software':
          return endpointOps.fetchSoftware(vm);
        case 'rscd':
          return endpointOps.fetchRscd(vm, () => {});
        case 'power':
          return endpointOps.fetchPowerState(vm);
        case 'console':
          return endpointOps.consoleInfo(vm);
        case 'logs':
        case 'audit':
          return activityLog.list({ vmId: vm._id, limit: 300 });
        default:
          throw new Error(`Unknown tab: ${tab}`);
      }
    };

    if (tab === 'logs' || tab === 'audit' || tab === 'console') {
      data = await run();
    } else {
      data = await withTabTimeout(run(), tab);
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
    const fallback = inventoryForTab(vm, tab);
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

    if (fallback) {
      return res.json({
        success: true,
        tab,
        data: fallback,
        stale: true,
        warning: audit.maskSecrets(err.message),
      });
    }
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

router.post('/power', async (req, res) => {
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
