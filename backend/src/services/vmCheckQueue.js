const VM = require('../models/VM');
const connectivity = require('./connectivity');
const logger = require('../utils/logger');
const { runPool } = require('../utils/pool');
const { getMonitorableVmQuery } = require('../utils/agentStatus');
const wmiConfig = require('../config/wmi');

const inventoryInFlight = new Set();
const inventoryPending = [];
let inventoryWorkers = 0;
const INVENTORY_MAX_CONCURRENT = Math.max(
  1,
  parseInt(process.env.BACKGROUND_INVENTORY_CONCURRENCY || '2', 10),
);
const INVENTORY_MIN_AGE_MS = Math.max(
  3600000,
  parseInt(process.env.BACKGROUND_INVENTORY_MIN_AGE_MS || String(3 * 3600000), 10),
);

function emitVmStatus(io, vm, result) {
  if (!io || !vm) return;
  io.emit('vm:status', {
    vmId: vm._id,
    name: vm.name,
    status: vm.status,
    connectivity: result?.connectivityState || result?.connectivity,
    connectivityState: vm.connectivityState,
    authStatus: vm.authStatus || (vm.status === 'online' ? 'allowed' : 'unknown'),
    agentStatus: vm.agentStatus,
    ip: vm.ip,
    version: vm.version,
    lastCheck: vm.lastCheck,
    lastProbeError: vm.lastProbeError,
    powerState: vm.powerState,
    lastSeenAt: vm.lastSeenAt,
    localUsers: vm.localUsers,
  });
}

function needsBackgroundInventory(vm) {
  if (!wmiConfig.backgroundInventory) return false;
  if (vm?.excluded || vm?.status === 'excluded') return false;
  if (vm?.agentStatus === 'removed' || vm?.version === 'removed') return false;
  if (vm?.lastFullSyncAt) {
    const age = Date.now() - new Date(vm.lastFullSyncAt).getTime();
    if (age < INVENTORY_MIN_AGE_MS) return false;
  }
  const ver = String(vm?.version || '').trim();
  return !ver || ver === 'unknown';
}

async function checkVmRecord(vm, io, options = {}) {
  const lightweight = options.lightweight ?? wmiConfig.monitorLightweight;
  const doc = vm.wmiPassword !== undefined
    ? vm
    : await VM.findById(vm._id || vm).select('+wmiPassword');
  if (!doc) return null;

  const { result, vm: updated } = await connectivity.checkAndUpdate(doc, { lightweight });
  if (!updated) return null;
  emitVmStatus(io, updated, result);

  if (
    lightweight
    && updated.status === 'online'
    && options.scheduleInventory !== false
    && needsBackgroundInventory(updated)
  ) {
    queueBackgroundInventory(updated._id, io);
  }

  return updated;
}

async function runBackgroundInventoryJob(vmId, io) {
  const id = String(vmId);
  try {
    const doc = await VM.findById(id).select('+wmiPassword');
    if (!doc || !needsBackgroundInventory(doc)) return;
    logger.debug(`Background agent inventory: ${doc.name}`);
    const { result, vm: updated } = await connectivity.checkAndUpdate(doc, { lightweight: false });
    if (!updated) return;
    emitVmStatus(io, updated, result);
  } catch (err) {
    logger.debug(`Background inventory ${id}: ${err.message}`);
  } finally {
    inventoryInFlight.delete(id);
    inventoryWorkers = Math.max(0, inventoryWorkers - 1);
    drainBackgroundInventory(io);
  }
}

function drainBackgroundInventory(io) {
  while (inventoryWorkers < INVENTORY_MAX_CONCURRENT && inventoryPending.length) {
    const nextId = inventoryPending.shift();
    if (!nextId || inventoryInFlight.has(nextId)) continue;
    inventoryInFlight.add(nextId);
    inventoryWorkers += 1;
    setImmediate(() => runBackgroundInventoryJob(nextId, io));
  }
}

/** Deferred full agent inventory — bounded concurrency; does not block online detection. */
function queueBackgroundInventory(vmId, io) {
  const id = String(vmId);
  if (inventoryInFlight.has(id) || inventoryPending.includes(id)) return;
  inventoryPending.push(id);
  drainBackgroundInventory(io);
}

/** Fire-and-forget WMI check — does not block the HTTP response. */
function queueVmCheck(vmId, io, options = {}) {
  setImmediate(() => {
    checkVmRecord(vmId, io, options).catch((err) => {
      logger.debug(`Quick check ${vmId}: ${err.message}`);
    });
  });
}

/** Parallel lightweight checks for newly imported/added hosts. */
function queueVmChecks(vmIds, io, options = {}) {
  const ids = [...new Set((vmIds || []).map(String).filter(Boolean))];
  if (!ids.length) return;

  setImmediate(async () => {
    const concurrency = parseInt(process.env.QUICK_CHECK_CONCURRENCY || '25', 10);
    try {
      const vms = await VM.find({ _id: { $in: ids } }).select('+wmiPassword').lean();
      await runPool(vms, concurrency, async (vm) => {
        try {
          await checkVmRecord(vm, io, { lightweight: true, ...options });
        } catch (err) {
          logger.debug(`Quick check ${vm.name}: ${err.message}`);
        }
      });
    } catch (err) {
      logger.warn(`Quick check batch failed: ${err.message}`);
    }
  });
}

/** Check all monitorable VMs on startup — bypasses monitor backoff. */
function queueAllVmChecks(io, options = {}) {
  setImmediate(async () => {
    const concurrency = parseInt(process.env.QUICK_CHECK_CONCURRENCY || '25', 10);
    try {
      const vms = await VM.find(getMonitorableVmQuery()).select('+wmiPassword').lean();
      if (!vms.length) return;
      logger.info(`Startup: checking ${vms.length} VM(s) (lightweight WMI)`);
      await runPool(vms, concurrency, async (vm) => {
        try {
          await checkVmRecord(vm, io, { lightweight: true, ...options });
        } catch (err) {
          logger.debug(`Startup check ${vm.name}: ${err.message}`);
        }
      });
      logger.info(`Startup VM check sweep finished (${vms.length} host(s))`);
    } catch (err) {
      logger.warn(`Startup VM check sweep failed: ${err.message}`);
    }
  });
}

module.exports = {
  checkVmRecord,
  queueVmCheck,
  queueVmChecks,
  queueAllVmChecks,
  queueBackgroundInventory,
  emitVmStatus,
  needsBackgroundInventory,
};
