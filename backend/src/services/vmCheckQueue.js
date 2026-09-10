const VM = require('../models/VM');
const connectivity = require('./connectivity');
const logger = require('../utils/logger');
const { runPool } = require('../utils/pool');

function emitVmStatus(io, vm, result) {
  if (!io || !vm) return;
  io.emit('vm:status', {
    vmId: vm._id,
    name: vm.name,
    status: vm.status,
    connectivity: result?.connectivity,
    agentStatus: vm.agentStatus,
    ip: vm.ip,
    version: vm.version,
    lastCheck: vm.lastCheck,
  });
}

async function checkVmRecord(vm, io) {
  const doc = vm.wmiPassword !== undefined
    ? vm
    : await VM.findById(vm._id || vm).select('+wmiPassword');
  if (!doc) return null;
  const { result, vm: updated } = await connectivity.checkAndUpdate(doc);
  emitVmStatus(io, updated, result);
  return updated;
}

/** Fire-and-forget WMI check — does not block the HTTP response. */
function queueVmCheck(vmId, io) {
  setImmediate(() => {
    checkVmRecord(vmId, io).catch((err) => {
      logger.debug(`Quick check ${vmId}: ${err.message}`);
    });
  });
}

/** Parallel quick checks for newly imported/added hosts. */
function queueVmChecks(vmIds, io) {
  const ids = [...new Set((vmIds || []).map(String).filter(Boolean))];
  if (!ids.length) return;

  setImmediate(async () => {
    const concurrency = parseInt(process.env.QUICK_CHECK_CONCURRENCY || '25', 10);
    try {
      const vms = await VM.find({ _id: { $in: ids } }).select('+wmiPassword').lean();
      await runPool(vms, concurrency, async (vm) => {
        try {
          await checkVmRecord(vm, io);
        } catch (err) {
          logger.debug(`Quick check ${vm.name}: ${err.message}`);
        }
      });
    } catch (err) {
      logger.warn(`Quick check batch failed: ${err.message}`);
    }
  });
}

module.exports = { checkVmRecord, queueVmCheck, queueVmChecks, emitVmStatus };
