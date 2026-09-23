const VM = require('../models/VM');
const connectivity = require('./connectivity');
const endpointOps = require('./endpointOps');
const audit = require('../utils/audit');
const wmiConfig = require('../config/wmi');
const deployConfig = require('../config/deployConfig');
const registrySoftware = require('./registrySoftware');
const deployInstall = require('./deployInstall');
const SyncRun = require('../models/SyncRun');
const systemState = require('./systemState');
const { decryptIfNeeded } = require('../utils/credentialCrypto');
const logger = require('../utils/logger');

const SYNC_INTERVAL_MS = Math.max(
  3600000,
  (parseInt(process.env.SYNC_INTERVAL_HOURS || process.env.ENDPOINT_SYNC_INTERVAL_HOURS || String(deployConfig.syncIntervalHours), 10)
    || deployConfig.syncIntervalHours) * 3600000,
);

const state = {
  running: false,
  reason: null,
  broadcastUi: false,
  initialSyncDone: true,
  lastSyncAt: null,
  lastSyncDurationMs: null,
  lastSummary: null,
  progress: { completed: 0, total: 0 },
  timer: null,
  bootstrapped: false,
};

function syncShowsInUi(reason, broadcastUi) {
  if (broadcastUi === false) return false;
  return reason === 'manual' || reason === 'initial';
}

function emitSync(io, event, payload, broadcastUi) {
  if (!io || !broadcastUi) return;
  io.emit(event, payload);
}

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
      let software = null;
      try {
        const base = fresh.toObject ? fresh.toObject() : fresh;
        const plain = { ...base, wmiPassword: decryptIfNeeded(base.wmiPassword) };
        const session = await deployInstall.sessionFromVm(plain);
        software = await registrySoftware.fetchInstalledPrograms(session);
      } catch {
        software = null;
      }
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
      if (software) {
        updates.rscdStatus = software.agents.rscd.status;
        updates.rscdVersion = software.agents.rscd.version || '';
        updates.crowdStrikeStatus = software.agents.crowdStrike.status;
        updates.crowdStrikeVersion = software.agents.crowdStrike.version || '';
        updates.softwareSnapshot = {
          capturedAt: software.capturedAt,
          programCount: software.programs.length,
          programs: software.programs.slice(0, 500).map((p) => ({
            name: p.displayName,
            version: p.version,
            publisher: p.publisher,
            uninstallString: p.uninstallString,
            quietUninstallString: p.quietUninstallString,
            architecture: p.architecture,
          })),
        };
        if (software.agents.rscd.status === 'installed') {
          updates.agentStatus = 'active';
          if (software.agents.rscd.version) updates.version = software.agents.rscd.version;
        }
      }
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

async function runFullSync(io, { actor = 'system', reason = 'manual', broadcastUi } = {}) {
  if (state.running) {
    return { alreadyRunning: true, ...state.lastSummary };
  }

  const ui = broadcastUi !== undefined ? broadcastUi : syncShowsInUi(reason, true);
  state.running = true;
  state.reason = reason;
  state.broadcastUi = ui;
  const started = Date.now();
  let results = [];
  const syncRun = await SyncRun.create({ environment: 'all', trigger: reason, startedAt: new Date() });

  try {
    await audit.log({
      action: 'sync.full',
      status: 'started',
      actor,
      category: 'sync',
      message: `Full endpoint sync started (${reason})`,
      meta: { reason, ui },
    }, io);
    const vms = await VM.find({ excluded: false, osType: 'windows' }).select('+wmiPassword');
    state.progress = { completed: 0, total: vms.length };
    emitSync(io, 'sync:start', {
      reason,
      ui,
      startedAt: new Date().toISOString(),
      total: vms.length,
      completed: 0,
    }, ui);

    const concurrency = Math.max(1, parseInt(process.env.SYNC_CONCURRENCY || process.env.MONITOR_CONCURRENCY || '10', 10));

    for (let i = 0; i < vms.length; i += concurrency) {
      const batch = vms.slice(i, i + concurrency);
      const batchResults = await Promise.all(batch.map((vm) => syncOneEndpoint(vm, io, actor)));
      results.push(...batchResults);
      state.progress = { completed: results.length, total: vms.length };
      emitSync(io, 'sync:progress', {
        reason,
        ui,
        completed: results.length,
        total: vms.length,
      }, ui);
    }

    const durationMs = Date.now() - started;
    const ok = results.filter((r) => r.ok).length;
    state.lastSyncAt = new Date();
    state.lastSyncDurationMs = durationMs;
    state.initialSyncDone = true;
    state.lastSummary = {
      total: results.length,
      ok,
      failed: results.length - ok,
      durationMs,
      reason,
    };

    await systemState.setState({
      initialSyncDone: true,
      lastSyncAt: state.lastSyncAt,
    });

    await audit.log({
      action: 'sync.full',
      status: 'success',
      actor,
      durationMs,
      category: 'sync',
      message: `Full sync complete: ${ok}/${results.length} endpoints`,
      meta: state.lastSummary,
    }, io);

    emitSync(io, 'sync:complete', {
      ...state.lastSummary,
      reason,
      ui,
      lastSyncAt: state.lastSyncAt.toISOString(),
    }, ui);

    await SyncRun.findByIdAndUpdate(syncRun._id, {
      endedAt: new Date(),
      endpointsScanned: results.length,
      succeeded: ok,
      failed: results.length - ok,
      durationMs,
    });

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

    emitSync(io, 'sync:complete', {
      failed: true,
      error: err.message,
      reason,
      ui,
      total: results.length,
      ok: results.filter((r) => r.ok).length,
      lastSyncAt: state.lastSyncAt ? state.lastSyncAt.toISOString() : null,
    }, ui);
    throw err;
  } finally {
    state.running = false;
    state.reason = null;
    state.broadcastUi = false;
    state.progress = { completed: 0, total: 0 };
  }
}

async function bootstrap() {
  if (state.bootstrapped) return;
  const sys = await systemState.getState();
  state.initialSyncDone = !!sys.initialSyncDone;
  if (sys.lastSyncAt) state.lastSyncAt = new Date(sys.lastSyncAt);

  const lastRun = await SyncRun.findOne().sort({ startedAt: -1 }).lean();
  if (lastRun?.endedAt && !state.lastSyncAt) {
    state.lastSyncAt = new Date(lastRun.endedAt);
  }
  state.bootstrapped = true;
}

async function fleetNeedsInitialSync() {
  if (state.initialSyncDone) return false;
  const total = await VM.countDocuments({ excluded: false, osType: 'windows' });
  if (!total) {
    await systemState.setState({ initialSyncDone: true });
    state.initialSyncDone = true;
    return false;
  }
  const withSnapshot = await VM.countDocuments({
    excluded: false,
    osType: 'windows',
    lastFullSyncAt: { $exists: true, $ne: null },
  });
  return withSnapshot < total;
}

async function maybeStartInitialSync(io) {
  await bootstrap();
  if (state.running) return;
  const needed = await fleetNeedsInitialSync();
  if (!needed) {
    if (!state.initialSyncDone) {
      await systemState.setState({ initialSyncDone: true });
      state.initialSyncDone = true;
    }
    return;
  }
  logger.info('Initial one-time full endpoint sync starting (fleet has no complete inventory snapshot yet)');
  setImmediate(() => {
    runFullSync(io, { actor: 'system', reason: 'initial', broadcastUi: true }).catch((err) => {
      logger.error(`Initial sync failed: ${err.message}`);
    });
  });
}

function startScheduledSync(io) {
  if (process.env.ENDPOINT_SYNC_DISABLED === 'true') {
    logger.info('Scheduled endpoint full sync disabled (ENDPOINT_SYNC_DISABLED=true)');
    return;
  }
  if (state.timer) clearInterval(state.timer);
  const hours = SYNC_INTERVAL_MS / 3600000;
  state.timer = setInterval(() => {
    runFullSync(io, { actor: 'system', reason: 'scheduled', broadcastUi: false }).catch((err) => {
      logger.warn(`Scheduled sync failed: ${err.message}`);
    });
  }, SYNC_INTERVAL_MS);
  state.timer.unref?.();
  logger.info(`Endpoint full sync scheduled every ${hours}h (silent — no UI banner)`);
}

/** @deprecated use startScheduledSync */
function startHourlySync(io) {
  startScheduledSync(io);
}

function stopScheduledSync() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

function stopHourlySync() {
  stopScheduledSync();
}

function getSyncStatus() {
  return {
    running: state.running,
    reason: state.running ? state.reason : null,
    ui: state.running ? state.broadcastUi : false,
    initialSyncDone: state.initialSyncDone,
    lastSyncAt: state.lastSyncAt,
    lastSyncDurationMs: state.lastSyncDurationMs,
    lastSummary: state.lastSummary,
    progress: state.running ? { ...state.progress } : null,
    intervalMs: SYNC_INTERVAL_MS,
  };
}

module.exports = {
  bootstrap,
  maybeStartInitialSync,
  runFullSync,
  startScheduledSync,
  startHourlySync,
  stopScheduledSync,
  stopHourlySync,
  getSyncStatus,
};
