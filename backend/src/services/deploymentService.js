const Job = require('../models/Job');
const VM = require('../models/VM');
const deployConfig = require('../config/deployConfig');
const { runPool } = require('../utils/pool');
const deployInstall = require('./deployInstall');
const deployUninstall = require('./deployUninstall');
const packageStore = require('./packageStore');
const activityLog = require('./activityLog');
const { decryptIfNeeded } = require('../utils/credentialCrypto');

const running = new Set();
const cancelFlags = new Set();

function concurrencyForEnv(environment) {
  return environment === 'prod' ? deployConfig.prodConcurrency : deployConfig.rndConcurrency;
}

function emitJob(io, jobId, payload) {
  io?.emit('job:progress', { jobId, ...payload });
  io?.to(`job:${jobId}`).emit('deployment:update', { jobId, ...payload });
}

async function updateEndpointResult(jobId, endpointId, patch, io) {
  const setFields = {};
  for (const [k, v] of Object.entries(patch)) {
    setFields[`endpointResults.$[elem].${k}`] = v;
  }
  await Job.updateOne(
    { _id: jobId },
    { $set: setFields },
    { arrayFilters: [{ 'elem.endpointId': endpointId }] },
  );
  io?.to(`job:${jobId}`).emit('deployment:endpoint', { jobId, endpointId, ...patch });
}

function initEndpointResults(vms, environment) {
  return vms.map((vm) => ({
    endpointId: vm._id,
    name: vm.name,
    ip: vm.ip || '',
    environment: vm.environment || environment,
    status: 'queued',
    step: 'queued',
    message: '',
  }));
}

async function createInstallJob(body, io, actor = 'system') {
  const {
    name, endpointIds, packageId, environment = deployConfig.defaultEnvironment,
    options = {},
  } = body;
  if (environment === 'prod' && !options.confirmedProd) {
    throw new Error('PROD install requires confirmedProd=true');
  }
  const pkg = await packageStore.getPackage(packageId);
  if (!pkg) throw new Error('Package not found');

  const vms = await VM.find({ _id: { $in: endpointIds }, excluded: false }).select('+wmiPassword');
  if (!vms.length) throw new Error('No endpoints matched');

  const job = await Job.create({
    name: name || `Install — ${pkg.name}`,
    type: 'install_package',
    environment,
    packageId: pkg._id,
    vms: vms.map((v) => v._id),
    endpointResults: initEndpointResults(vms, environment),
    config: { options, productName: options.productName || pkg.name },
    statistics: { total: vms.length, success: 0, failed: 0, skipped: 0, cancelled: 0 },
  });

  await activityLog.write({
    category: 'job',
    level: 'info',
    message: `Install job created: ${job.name} (${vms.length} endpoints, ${environment})`,
    jobId: job._id,
  }, io);

  setImmediate(() => runJob(job._id.toString(), io, actor));
  return job;
}

async function createUninstallJob(body, io, actor = 'system') {
  const {
    name,
    endpointIds,
    environment = deployConfig.defaultEnvironment,
    target = 'rscd',
    productName,
    productVersions,
    options = {},
  } = body;

  if (environment === 'prod' && !options.confirmedProd) {
    throw new Error('PROD uninstall requires confirmedProd=true');
  }
  if (endpointIds?.length >= deployConfig.bulkConfirmThreshold && !options.bulkConfirmed) {
    throw new Error(`Bulk operation requires bulkConfirmed=true (${endpointIds.length} endpoints)`);
  }

  const vms = await VM.find({ _id: { $in: endpointIds }, excluded: false }).select('+wmiPassword');
  if (!vms.length) throw new Error('No endpoints matched');

  const envMismatch = vms.filter((v) => (v.environment || 'rnd') !== environment);
  if (envMismatch.length) {
    throw new Error('Endpoint environment does not match selected environment');
  }

  const job = await Job.create({
    name: name || (target === 'rscd' ? 'Uninstall RSCD' : `Uninstall — ${productName || target}`),
    type: target === 'rscd' ? 'uninstall_rscd' : 'uninstall_program',
    environment,
    vms: vms.map((v) => v._id),
    endpointResults: initEndpointResults(vms, environment),
    config: {
      target,
      productName,
      productVersions: productVersions || [],
      options,
    },
    statistics: { total: vms.length, success: 0, failed: 0, skipped: 0, cancelled: 0 },
  });

  await activityLog.write({
    category: 'job',
    level: 'warning',
    message: `Uninstall job created: ${job.name} (${vms.length} endpoints, ${environment})`,
    jobId: job._id,
  }, io);

  setImmediate(() => runJob(job._id.toString(), io, actor));
  return job;
}

async function runJob(jobId, io, actor) {
  if (running.has(jobId)) return;
  running.add(jobId);
  cancelFlags.delete(jobId);

  const job = await Job.findById(jobId).populate({ path: 'vms', select: '+wmiPassword' });
  if (!job) {
    running.delete(jobId);
    return;
  }

  const stats = { success: 0, failed: 0, skipped: 0, cancelled: 0 };
  const total = job.vms.length;
  let done = 0;

  await Job.findByIdAndUpdate(jobId, { status: 'running', startedAt: new Date() });
  io?.emit('job:started', { jobId, status: 'running', progress: 0, statistics: { total, ...stats } });

  const pkg = job.packageId ? await packageStore.getPackage(job.packageId) : null;
  const concurrency = concurrencyForEnv(job.environment);

  const worker = async (vm) => {
    if (cancelFlags.has(jobId)) {
      stats.cancelled++;
      await updateEndpointResult(jobId, vm._id, { status: 'cancelled', step: 'cancelled', message: 'Cancelled' }, io);
      done++;
      emitJob(io, jobId, { progress: Math.round((done / total) * 100), statistics: { total, ...stats } });
      return;
    }

    const plain = { ...vm.toObject(), wmiPassword: decryptIfNeeded(vm.wmiPassword) };
    const started = Date.now();
    await updateEndpointResult(jobId, vm._id, { status: 'connecting', step: 'connecting', startedAt: new Date() }, io);

    const hooks = {
      onStatus: (step) => updateEndpointResult(jobId, vm._id, { status: step, step }, io),
      onLog: (step, message, level = 'info') => {
        const entry = { timestamp: new Date(), level, message, vm: vm.name };
        io?.emit('log:new', { jobId, entry });
        Job.findByIdAndUpdate(jobId, { $push: { logs: entry } }).catch(() => {});
      },
    };

    let result;
    if (job.type === 'install_package') {
      result = await deployInstall.installOnEndpoint(plain, jobId, pkg, {
        ...job.config.options,
        productName: job.config.productName,
        environment: job.environment,
      }, hooks);
    } else {
      result = await deployUninstall.uninstallProgramOnEndpoint(plain, jobId, {
        target: job.config.target,
        productName: job.config.productName,
        productVersions: job.config.productVersions,
        environment: job.environment,
      }, job.config.options || {}, hooks);
    }

    const durationMs = Date.now() - started;
    if (result.skipped) stats.skipped++;
    else if (result.ok) stats.success++;
    else stats.failed++;

    await updateEndpointResult(jobId, vm._id, {
      status: result.skipped ? 'skipped' : (result.ok ? 'done' : 'failed'),
      step: result.skipped ? 'skipped' : (result.ok ? 'done' : 'failed'),
      agentName: result.agentName || '',
      agentVersion: result.agentVersion || '',
      message: result.message || '',
      endedAt: new Date(),
      durationMs,
    }, io);

    if (job.config.target === 'rscd' && result.ok && !result.skipped) {
      await VM.findByIdAndUpdate(vm._id, { agentStatus: 'removed', version: 'removed', rscdStatus: 'absent', rscdVersion: '' });
    }

    done++;
    const progress = Math.min(100, Math.round((done / total) * 100));
    emitJob(io, jobId, { progress, statistics: { total, ...stats } });
    await Job.findByIdAndUpdate(jobId, { progress, statistics: { total, ...stats } });
  };

  await runPool(job.vms, concurrency, worker);

  const finalStatus = stats.failed > 0 && stats.success === 0 ? 'failed' : 'completed';
  await Job.findByIdAndUpdate(jobId, {
    status: finalStatus,
    progress: 100,
    completedAt: new Date(),
    statistics: { total, ...stats },
  });
  io?.emit('job:completed', { jobId, job: { status: finalStatus }, statistics: { total, ...stats } });
  running.delete(jobId);
}

async function cancelJob(jobId, io) {
  const job = await Job.findById(jobId);
  if (!job) throw new Error('Job not found');
  if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;
  cancelFlags.add(jobId);
  job.status = 'cancelled';
  job.completedAt = new Date();
  await job.save();
  io?.emit('job:cancelled', { jobId });
  return job;
}

async function retryFailed(jobId, io) {
  const job = await Job.findById(jobId);
  if (!job) throw new Error('Job not found');
  const failedIds = (job.endpointResults || [])
    .filter((r) => r.status === 'failed')
    .map((r) => r.endpointId);
  if (!failedIds.length) throw new Error('No failed endpoints to retry');
  const opts = { ...job.config?.options, bulkConfirmed: true, confirmedProd: job.environment === 'prod' };
  if (job.type === 'install_package') {
    return createInstallJob({
      name: `${job.name} — retry failed`,
      endpointIds: failedIds,
      environment: job.environment,
      packageId: job.packageId,
      options: opts,
    }, io);
  }
  return createUninstallJob({
    name: `${job.name} — retry failed`,
    endpointIds: failedIds,
    environment: job.environment,
    target: job.config.target,
    productName: job.config.productName,
    productVersions: job.config.productVersions,
    options: opts,
  }, io);
}

module.exports = {
  createInstallJob,
  createUninstallJob,
  cancelJob,
  retryFailed,
  runJob,
};
