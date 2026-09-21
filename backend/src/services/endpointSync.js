const VM = require('../models/VM');
const connectivity = require('./connectivity');
const endpointOps = require('./endpointOps');
const audit = require('../utils/audit');
const wmiConfig = require('../config/wmi');

const SYNC_INTERVAL_MS = Math.max(
  3600000,
  parseInt(process.env.ENDPOINT_SYNC_INTERVAL_HOURS || '1', 10) * 3600000,
);

const state = {
  running: false,
  lastSyncAt: null,
  lastSyncDurationMs: null,
  lastSummary: null,
  timer: null,
};

async function syncOneEndpoint(vm, io, actor) {
  const started = Date.now();
  const vmId = String(vm._id);
  try {
    const { vm: probed } = await connectivity.checkAndUpdate(vm, { lightweight: false });
    let fresh = probed || vm;
    const online = fresh.status === 'online' || fresh.connectivityState === 'online';

    if (online) {
      const overview = await endpointOps.fetchOverview(fresh);
      const localUsers = await endpointOps.fetchLocalUsers(fresh);
      const power = await endpointOps.fetchPowerState(fresh);
      const updates = {
        lastFullSyncAt: new Date(),
        localUsers: { ...localUsers, checkedAt: new Date() },
        powerState: power.state || fresh.powerState || 'on',
        osVersion: overview.osVersion || fresh.osVersion,
        hardwareModel: overview.model || fresh.hardwareModel,
        serviceTag: overview.serviceTag || fresh.serviceTag,
        os: overview.os || fresh.os,
      };
      if (overview.ip) updates.ip = overview.ip;
      fresh = await VM.findByIdAndUpdate(vm._id, { $set: updates }, { new: true });
    } else {
      fresh = await VM.findByIdAndUpdate(
        vm._id,
        { $set: { lastFullSyncAt: new Date() } },
        { new: true },
      );
    }

    await audit.log({
      action: 'sync.endpoint',
      status: 'success',
      actor,
      vmId,
      vmName: vm.name,
      durationMs: Date.now() - started,
      message: `Synced ${vm.name}`,
      category: 'sync',
      meta: { status: fresh.status, connectivityState: fresh.connectivityState },
    }, io);

    if (io) {
      io.emit('vm:status', {
        vmId,
        status: fresh.status,
        connectivityState: fresh.connectivityState,
        powerState: fresh.powerState,
      });
    }
    return { vmId, name: vm.name, ok: true, durationMs: Date.now() - started };
  } catch (err) {
    await audit.log({
      action: 'sync.endpoint',
      status: 'failed',
      actor,
      vmId,
      vmName: vm.name,
      durationMs: Date.now() - started,
      level: 'error',
      category: 'sync',
      message: audit.maskSecrets(err.message),
    }, io);
    return { vmId, name: vm.name, ok: false, error: err.message, durationMs: Date.now() - started };
  }
}

async function runFullSync(io, { actor = 'system', reason = 'manual' } = {}) {
  if (state.running) {
    return { alreadyRunning: true, ...state.lastSummary };
  }

  state.running = true;
  const started = Date.now();
  let results = [];

  try {
    await audit.log({
      action: 'sync.full',
      status: 'started',
      actor,
      category: 'sync',
      message: `Full endpoint sync started (${reason})`,
    }, io);
    if (io) io.emit('sync:start', { reason, startedAt: new Date().toISOString() });

    const vms = await VM.find({ excluded: false, osType: 'windows' }).select('+wmiPassword');
    const concurrency = Math.max(1, wmiConfig.monitorConcurrency || 10);

    for (let i = 0; i < vms.length; i += concurrency) {
      const batch = vms.slice(i, i + concurrency);
      const batchResults = await Promise.all(batch.map((vm) => syncOneEndpoint(vm, io, actor)));
      results.push(...batchResults);
      if (io) {
        io.emit('sync:progress', { completed: results.length, total: vms.length });
      }
    }

    const durationMs = Date.now() - started;
    const ok = results.filter((r) => r.ok).length;
    state.lastSyncAt = new Date();
    state.lastSyncDurationMs = durationMs;
    state.lastSummary = {
      total: results.length,
      ok,
      failed: results.length - ok,
      durationMs,
      reason,
    };

    await audit.log({
      action: 'sync.full',
      status: 'success',
      actor,
      durationMs,
      category: 'sync',
      message: `Full sync complete: ${ok}/${results.length} endpoints`,
      meta: state.lastSummary,
    }, io);

    if (io) {
      io.emit('sync:complete', {
        ...state.lastSummary,
        lastSyncAt: state.lastSyncAt.toISOString(),
      });
    }

    return { ...state.lastSummary, results };
  } catch (err) {
    const durationMs = Date.now() - started;
    await audit.log({
      action: 'sync.full',
      status: 'failed',
      actor,
      durationMs,
      category: 'sync',
      level: 'error',
      message: audit.maskSecrets(err.message),
    }, io).catch(() => {});

    if (io) {
      io.emit('sync:complete', {
        failed: true,
        error: err.message,
        total: results.length,
        ok: results.filter((r) => r.ok).length,
        lastSyncAt: state.lastSyncAt ? state.lastSyncAt.toISOString() : null,
      });
    }
    throw err;
  } finally {
    state.running = false;
  }
}

function startHourlySync(io) {
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(() => {
    runFullSync(io, { actor: 'system', reason: 'hourly' }).catch(() => {});
  }, SYNC_INTERVAL_MS);
  state.timer.unref?.();
}

function stopHourlySync() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

function getSyncStatus() {
  return {
    running: state.running,
    lastSyncAt: state.lastSyncAt,
    lastSyncDurationMs: state.lastSyncDurationMs,
    lastSummary: state.lastSummary,
    intervalMs: SYNC_INTERVAL_MS,
  };
}

module.exports = {
  runFullSync,
  startHourlySync,
  stopHourlySync,
  getSyncStatus,
};
