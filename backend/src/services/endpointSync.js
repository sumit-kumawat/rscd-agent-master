const VM = require('../models/VM');
const connectivity = require('./connectivity');
const endpointOps = require('./endpointOps');
const audit = require('../utils/audit');
const wmiConfig = require('../config/wmi');
const deployConfig = require('../config/deployConfig');
const registrySoftware = require('./registrySoftware');
const deployInstall = require('./deployInstall');
const SyncRun = require('../models/SyncRun');
const { decryptIfNeeded } = require('../utils/credentialCrypto');

const SYNC_INTERVAL_MS = Math.max(
  3600000,
  (parseInt(process.env.ENDPOINT_SYNC_INTERVAL_HOURS || String(deployConfig.syncIntervalHours), 10) || deployConfig.syncIntervalHours) * 3600000,
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
      let software = null;
      try {
        const base = fresh.toObject ? fresh.toObject() : fresh;
        const plain = { ...base, wmiPassword: decryptIfNeeded(base.wmiPassword) };
        const session = deployInstall.sessionFromVm(plain);
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

async function runFullSync(io, { actor = 'system', reason = 'manual' } = {}) {
  if (state.running) {
    return { alreadyRunning: true, ...state.lastSummary };
  }

  state.running = true;
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
