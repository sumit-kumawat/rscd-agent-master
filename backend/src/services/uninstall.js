const Job = require('../models/Job');
const VM = require('../models/VM');
const winRemote = require('./winRemote');
const connectivity = require('./connectivity');
const activityLog = require('./activityLog');
const logger = require('../utils/logger');
const { toVmPlain } = require('../utils/vmPlain');
const { isAgentRemoved } = require('../utils/agentStatus');
const { isBelowVersion, DEFAULT_UNINSTALL_BELOW } = require('../utils/versionUtils');
const { runPool } = require('../utils/pool');
const { emitVmStatus } = require('./vmCheckQueue');

const uninstallConfig = require('../config/uninstallConfig');
const UNINSTALL_CONCURRENCY = uninstallConfig.concurrency;

function createJobUpdater(jobId, io) {
  let chain = Promise.resolve();
  const stats = { success: 0, failed: 0, skipped: 0 };
  let done = 0;
  let total = 0;
  const inFlight = new Map();

  const computeProgress = () => {
    if (!total) return 0;
    let units = done;
    for (const { step, total: steps, percent } of inFlight.values()) {
      const stepFrac = steps ? ((step - 1) + (percent || 0) / 100) / steps : 0;
      units += Math.min(0.99, stepFrac);
    }
    return Math.min(done >= total ? 100 : 99, Math.round((units / total) * 100));
  };

  const emitProgress = (status) => {
    const progress = computeProgress();
    const statistics = { total, ...stats };
    const payload = { jobId, progress, statistics };
    if (status) payload.status = status;
    io?.emit('job:progress', payload);
    return enqueue(() => Job.findByIdAndUpdate(jobId, { $set: { progress, statistics, ...(status ? { status } : {}) } }));
  };

  const enqueue = (fn) => {
    chain = chain.then(fn).catch((err) => {
      logger.error(`Job ${jobId} update error: ${err.message}`);
    });
    return chain;
  };

  return {
    stats,
    setTotal(n) { total = n; },
    log(level, message, vm = '') {
      const entry = { timestamp: new Date(), level, message, vm };
      io?.emit('log:new', { jobId, entry });
      return enqueue(() => Job.findByIdAndUpdate(jobId, { $push: { logs: entry } }));
    },
    vmStep(vm, stepInfo) {
      inFlight.set(vm, stepInfo);
      return emitProgress();
    },
    clearVm(vm) {
      inFlight.delete(vm);
    },
    tick() {
      done++;
      return emitProgress();
    },
    finish(status) {
      const statistics = { total, ...stats };
      return enqueue(() => Job.findByIdAndUpdate(jobId, {
        $set: {
          status,
          progress: 100,
          statistics,
          completedAt: new Date(),
        },
      }, { new: true }));
    },
    wait() { return chain; },
  };
}

class UninstallService {
  constructor() {
    this.running = new Set();
  }

  async createJob(data, io) {
    const query = { excluded: false, osType: 'windows' };
    if (data.filter?.status) query.status = data.filter.status;
    if (data.vmIds?.length) query._id = { $in: data.vmIds };

    let vms = await VM.find(query).select('+wmiPassword');
    const below = data.filter?.belowVersion || data.belowVersion || DEFAULT_UNINSTALL_BELOW;
    const useBelowVersion = data.filter?.useBelowVersion === true;
    if (useBelowVersion) {
      vms = vms.filter((vm) => isBelowVersion(vm.version, below) || vm.version === 'unknown');
    }

    const job = await Job.create({
      name: data.name || (useBelowVersion ? `Uninstall below ${below}` : 'Uninstall all RSCD agents'),
      vms: vms.map((v) => v._id),
      config: { belowVersion: below, useBelowVersion },
      statistics: { total: vms.length, success: 0, failed: 0, skipped: 0 },
    });

    await activityLog.write({
      category: 'job',
      level: 'info',
      message: `Job created: ${job.name} (${vms.length} VM(s), concurrency ${UNINSTALL_CONCURRENCY})`,
      jobId: job._id,
      meta: { total: vms.length },
    }, io);
    setImmediate(() => this.run(job._id.toString(), io));
    return job;
  }

  async run(jobId, io) {
    if (this.running.has(jobId)) return;
    this.running.add(jobId);

    const job = await Job.findById(jobId).populate({ path: 'vms', select: '+wmiPassword' });
    if (!job || job.status === 'cancelled') {
      this.running.delete(jobId);
      return;
    }

    const vms = job.vms || [];
    const updater = createJobUpdater(jobId, io);
    updater.setTotal(vms.length);

    await Job.findByIdAndUpdate(jobId, { status: 'running', startedAt: new Date(), progress: 0 });
    io?.emit('job:started', { jobId, status: 'running', progress: 0, statistics: { total: vms.length, ...updater.stats } });
    await updater.log('warning', 'PRODUCTION — Windows RSCD agents will be uninstalled via WMI');

    if (!vms.length) {
      await updater.log('error', 'No Windows VMs matched criteria');
      await updater.finish('failed');
      io?.emit('job:completed', { jobId });
      this.running.delete(jobId);
      return;
    }

    const emitVmPhase = (vmDoc, phase, extra = {}) => {
      io?.emit('job:vm-phase', {
        jobId,
        vmId: vmDoc._id,
        vm: vmDoc.name,
        phase,
        ...extra,
      });
    };

    const processVm = async (vm) => {
      const cancelled = (await Job.findById(jobId))?.status === 'cancelled';
      if (cancelled) {
        updater.stats.skipped++;
        emitVmPhase(vm, 'cancelled');
        await updater.log('info', 'Skipped — job cancelled before start', vm.name);
        await updater.tick();
        return;
      }

      const doc = vm.wmiPassword !== undefined
        ? vm
        : await VM.findById(vm._id).select('+wmiPassword');
      const plain = toVmPlain(doc || vm);

      if (isAgentRemoved(plain)) {
        updater.stats.skipped++;
        await updater.log('info', 'Agent already Removed — skipping uninstall', plain.name);
        await updater.tick();
        return;
      }

      if (
        job.config.useBelowVersion
        && plain.version
        && plain.version !== 'unknown'
        && !isBelowVersion(plain.version, job.config.belowVersion)
      ) {
        updater.stats.skipped++;
        await VM.findByIdAndUpdate(vm._id, { status: 'online' });
        await updater.log('info', `Skipped — cached version ${plain.version} >= ${job.config.belowVersion}`, plain.name);
        await updater.tick();
        return;
      }

      const inProgressVm = await VM.findByIdAndUpdate(
        vm._id,
        { status: 'in_progress', connectivityState: 'in_progress' },
        { new: true },
      );
      emitVmStatus(io, inProgressVm, { connectivityState: 'in_progress' });
      emitVmPhase(vm, 'queued');

      try {
        const result = await winRemote.runUninstall(plain, {
          onLog: (level, message) => updater.log(level, message, plain.name),
          onStep: (progress) => {
            updater.vmStep(plain.name, progress);
            io?.emit('job:vm-step', { jobId, vm: plain.name, vmId: vm._id, ...progress });
          },
          onPhase: ({ phase, result: phaseResult, rebootRequired }) => {
            emitVmPhase(vm, phase, { result: phaseResult, rebootRequired });
          },
        });

        if (result.alreadyRemoved || result.notPresent) {
          updater.stats.skipped++;
          await VM.findByIdAndUpdate(vm._id, {
            $set: { agentStatus: 'removed', version: 'removed', installRoot: result.installRoot },
          });
          const { vm: afterVm, result: probe } = await connectivity.checkAndUpdate(
            await VM.findById(vm._id).select('+wmiPassword'),
          );
          emitVmStatus(io, afterVm, probe);
          await updater.log('success', 'Step 6 — MongoDB updated: agentStatus = removed', plain.name);
        } else if (
          job.config.useBelowVersion
          && !isBelowVersion(result.version, job.config.belowVersion)
          && result.version !== 'unknown'
        ) {
          updater.stats.skipped++;
          await updater.log('info', `Skipped — version ${result.version} >= ${job.config.belowVersion}`, plain.name);
          await VM.findByIdAndUpdate(vm._id, { status: 'online' });
        } else if (result.success) {
          updater.stats.success++;
          const vmUpdates = {
            agentStatus: 'removed',
            version: 'removed',
            installRoot: result.installRoot,
          };
          if (result.rebootRequired) vmUpdates.rebootRequired = true;
          await VM.findByIdAndUpdate(vm._id, { $set: vmUpdates });
          const { vm: afterVm, result: probe } = await connectivity.checkAndUpdate(
            await VM.findById(vm._id).select('+wmiPassword'),
          );
          emitVmStatus(io, afterVm, probe);
          await updater.log('success', `Uninstall completed via WMI (${result.username}@${result.host})`, plain.name);
          await updater.log('success', 'Step 6 — MongoDB updated: agentStatus = removed', plain.name);
        } else {
          updater.stats.failed++;
          const detail = result.uninstallMessage || 'Remote verification failed';
          await updater.log('error', `Uninstall failed — ${detail.slice(0, 500)}`, plain.name);
          const { vm: afterVm, result: probe } = await connectivity.checkAndUpdate(
            await VM.findById(vm._id).select('+wmiPassword'),
          );
          emitVmStatus(io, afterVm, probe);
        }
      } catch (err) {
        updater.stats.failed++;
        const failedVm = await VM.findByIdAndUpdate(
          vm._id,
          { status: 'offline', wmiReachable: false, connectivityMethod: 'none', connectivityState: 'offline' },
          { new: true },
        );
        emitVmStatus(io, failedVm, { connectivityState: 'offline' });
        await updater.log('error', err.message, plain.name);
      }

      updater.clearVm(plain.name);
      await updater.tick();
    };

    await runPool(vms, UNINSTALL_CONCURRENCY, processVm);

    const finalStatus = updater.stats.failed > 0 && updater.stats.success === 0 ? 'failed' : 'completed';
    const finalJob = await updater.finish(finalStatus);
    await updater.wait();
    io?.emit('job:completed', { jobId, job: finalJob });
    await activityLog.write({
      category: 'job',
      level: finalStatus === 'failed' ? 'error' : 'success',
      message: `Job ${finalStatus}: ${job.name} — ✓${updater.stats.success} ✗${updater.stats.failed} ⊘${updater.stats.skipped}`,
      jobId: job._id,
      meta: { total: vms.length, ...updater.stats },
    }, io);
    this.running.delete(jobId);
    logger.info(`Job ${jobId} done`, updater.stats);
  }

  async cancel(jobId, io) {
    const job = await Job.findById(jobId);
    if (!job) throw new Error('Job not found');
    job.status = 'cancelled';
    job.completedAt = new Date();
    await job.save();
    this.running.delete(jobId);
    io?.emit('job:cancelled', { jobId, status: 'cancelled' });
    return job;
  }
}

module.exports = new UninstallService();
