/**
 * Pre-deploy readiness task list: RSCD uninstalled, provision local users, VC++ 2015 x64.
 */
const VM = require('../models/VM');
const Job = require('../models/Job');
const endpointOps = require('./endpointOps');
const { detectRscd } = require('./rscdDetection');
const vcRedist2015 = require('./vcRedist2015');
const { parseProvisionUsers } = require('../config/localUsers');
const { isAgentRemoved } = require('../utils/agentStatus');
const { isVcRedist2015X64Installed } = vcRedist2015;
const localUserProvision = require('./localUserProvision');
const activityLog = require('./activityLog');
const { runPool } = require('../utils/pool');
const { isOnline } = require('./endpointInventory');
const logger = require('../utils/logger');

const CONCURRENCY = parseInt(process.env.READINESS_CONCURRENCY || '5', 10);

const TASK_DEFS = [
  {
    id: 'rscd_uninstalled',
    label: 'RSCD agent uninstalled',
    description: 'No BMC BladeLogic RSCD agent installed on the host',
  },
  {
    id: 'local_users',
    label: 'Provision local users',
    description: 'All configured local accounts exist (default: rdsroot, rdsmon, administrator)',
  },
  {
    id: 'vcredist_2015_x64',
    label: 'Microsoft Visual C++ 2015 Redistributable (x64)',
    description: '64-bit VC++ 2015 runtime (or 2015–2022 bundle)',
  },
];

function isRscdInstalledOnVm(vm) {
  if (isAgentRemoved(vm)) return false;
  if (vm.rscdStatus === 'installed') return true;
  if (vm.agentStatus === 'active' && vm.version && vm.version !== 'unknown' && vm.version !== 'removed') {
    return true;
  }
  return false;
}

function rscdTaskFromInventory(vm) {
  if (isAgentRemoved(vm)) {
    return { status: 'pass', message: 'Marked removed in inventory' };
  }
  if (vm.rscdStatus === 'absent') {
    return { status: 'pass', message: 'RSCD not installed (inventory)' };
  }
  if (isRscdInstalledOnVm(vm)) {
    return { status: 'fail', message: 'RSCD still reported as installed' };
  }
  return { status: 'unknown', message: 'Connect to host to verify' };
}

function usersTaskFromInventory(vm) {
  const expected = parseProvisionUsers().map((u) => u.username);
  const users = vm.localUsers?.users || [];
  const missing = expected.filter((name) => {
    const row = users.find((u) => String(u.name).toLowerCase() === name.toLowerCase());
    return !row?.present;
  });
  const required = expected.length;
  const present = users.filter((u) => u.present).length;
  if (missing.length === 0 && present >= required) {
    return { status: 'pass', message: `${present}/${required} users present`, missing: [] };
  }
  if (!vm.localUsers?.checkedAt) {
    return {
      status: missing.length ? 'fail' : 'unknown',
      message: missing.length ? `Missing: ${missing.join(', ')}` : 'Not checked yet',
      missing,
    };
  }
  return {
    status: missing.length ? 'fail' : 'pass',
    message: missing.length ? `Missing: ${missing.join(', ')}` : `${present}/${required} users present`,
    missing,
  };
}

function vcTaskFromInventory(vm) {
  const st = vm.vcRedist2015X64?.status;
  if (st === 'installed') {
    const ver = vm.vcRedist2015X64?.version;
    return { status: 'pass', message: ver ? `Installed (${ver})` : 'Installed' };
  }
  if (st === 'missing') {
    return { status: 'fail', message: 'Not installed' };
  }
  const fromSnap = vm.softwareSnapshot?.programs;
  if (Array.isArray(fromSnap) && isVcRedist2015X64Installed(
    fromSnap.map((p) => ({ displayName: p.name, name: p.name, version: p.version })),
  )) {
    return { status: 'pass', message: 'Found in software snapshot' };
  }
  return { status: 'unknown', message: 'Connect to host to verify' };
}

function buildTaskList(vm, parts = {}) {
  const rscd = parts.rscd || rscdTaskFromInventory(vm);
  const users = parts.users || usersTaskFromInventory(vm);
  const vc = parts.vc || vcTaskFromInventory(vm);

  const tasks = [
    { ...TASK_DEFS[0], ...rscd },
    { ...TASK_DEFS[1], ...users, expectedUsers: parseProvisionUsers().map((u) => u.username) },
    { ...TASK_DEFS[2], ...vc },
  ];
  const allPass = tasks.every((t) => t.status === 'pass');
  return { tasks, allPass, checkedAt: parts.checkedAt || vm.readiness?.checkedAt || null };
}

function rscdFromDetect(state) {
  const installed = state.serviceInstalled
    || (state.programs && state.programs.length > 0)
    || (state.productCodes && state.productCodes.length > 0)
    || (state.installPaths && state.installPaths.length > 0);
  if (!installed) {
    return { status: 'pass', message: 'RSCD not detected on host' };
  }
  const detail = state.programs?.[0] || state.serviceStatus || 'RSCD present';
  return { status: 'fail', message: `RSCD still present (${detail})` };
}

async function assessEndpoint(vm, options = {}) {
  const { live = true } = options;
  const plain = vm.toObject ? vm.toObject() : vm;

  if (!live || !isOnline(plain)) {
    const snapshot = buildTaskList(plain);
    return { ...snapshot, stale: true, offline: !isOnline(plain) };
  }

  const parts = { checkedAt: new Date() };
  const errors = [];

  try {
    const session = await endpointOps.connectOps(plain);
    const state = await detectRscd(session, () => {}, { passwords: [session.password] });
    parts.rscd = rscdFromDetect(state);
    const installed = parts.rscd.status === 'fail';
    await VM.findByIdAndUpdate(plain._id, {
      $set: { rscdStatus: installed ? 'installed' : 'absent' },
    });
  } catch (err) {
    errors.push(`RSCD: ${err.message}`);
    parts.rscd = rscdTaskFromInventory(plain);
    parts.rscd.message = `${parts.rscd.message} (live check failed)`;
  }

  try {
    const lu = await endpointOps.fetchLocalUsers(plain);
    await VM.findByIdAndUpdate(plain._id, { localUsers: { ...lu, checkedAt: new Date() } });
    const missing = lu.users.filter((u) => !u.present).map((u) => u.name);
    parts.users = missing.length
      ? { status: 'fail', message: `Missing: ${missing.join(', ')}`, missing }
      : { status: 'pass', message: `${lu.present}/${lu.required} users present`, missing: [] };
  } catch (err) {
    errors.push(`Users: ${err.message}`);
    parts.users = usersTaskFromInventory(plain);
  }

  try {
    const result = await vcRedist2015.ensureOnEndpoint(plain, { install: false, allowRemoved: true });
    if (result.status === 'installed' || result.skipped) {
      parts.vc = {
        status: 'pass',
        message: result.version ? `Installed (${result.version})` : 'Installed',
      };
    } else if (result.status === 'missing') {
      parts.vc = { status: 'fail', message: 'Not installed' };
    } else {
      parts.vc = { status: 'fail', message: result.message || 'Not installed' };
    }
  } catch (err) {
    errors.push(`VC++: ${err.message}`);
    parts.vc = vcTaskFromInventory(plain);
  }

  const snapshot = buildTaskList(plain, parts);
  await VM.findByIdAndUpdate(plain._id, {
    $set: {
      readiness: {
        checkedAt: parts.checkedAt,
        allPass: snapshot.allPass,
        tasks: snapshot.tasks.map((t) => ({
          id: t.id,
          status: t.status,
          message: t.message,
        })),
      },
    },
  });

  return { ...snapshot, stale: false, offline: false, errors };
}

async function remediateEndpoint(vm, options = {}) {
  const remediateUsers = options.users !== false;
  const remediateVc = options.vcredist !== false;
  const results = { users: null, vcredist: null };

  if (remediateUsers) {
    const silent = { log: async () => {}, progress: async () => {} };
    const users = parseProvisionUsers();
    const passwords = users.map((u) => u.password);
    results.users = await localUserProvision.provisionVm(
      vm,
      users,
      silent,
      passwords,
      { allowRemoved: true },
    );
  }
  if (remediateVc) {
    results.vcredist = await vcRedist2015.ensureOnEndpoint(vm, {
      install: true,
      jobId: `readiness-vc-${vm._id}`,
      allowRemoved: true,
    });
  }

  const assessment = await assessEndpoint(vm, { live: true });
  return { assessment, remediate: results };
}

let fleetInFlight = false;

async function runFleetReadiness(io, options = {}) {
  if (fleetInFlight) {
    logger.debug('Readiness fleet job already running');
    return null;
  }
  fleetInFlight = true;

  const remediateUsers = options.remediateUsers === true;
  const remediateVc = options.remediateVc === true;
  const onlineOnly = options.onlineOnly !== false;
  const endpointIds = options.endpointIds;

  const query = { excluded: false, osType: { $in: ['windows', null] } };
  if (onlineOnly) query.status = 'online';
  if (endpointIds?.length) query._id = { $in: endpointIds };

  const vms = await VM.find(query).select('+wmiPassword');
  const job = await Job.create({
    name: `Endpoint readiness — ${new Date().toLocaleString()}`,
    type: 'readiness',
    status: 'running',
    startedAt: new Date(),
    vms: vms.map((v) => v._id),
    config: {
      remediateUsers,
      remediateVc,
      trigger: options.reason || 'api',
    },
    statistics: { total: vms.length, success: 0, failed: 0, skipped: 0 },
    progress: 0,
  });

  const jobId = job._id.toString();
  io?.emit('job:started', { jobId, status: 'running', progress: 0 });

  const stats = { total: vms.length, success: 0, failed: 0, skipped: 0 };
  let done = 0;

  const log = async (level, message) => {
    const entry = { timestamp: new Date(), level, message };
    io?.emit('log:new', { jobId, entry });
    await Job.findByIdAndUpdate(jobId, { $push: { logs: entry } });
  };

  try {
    await log('info', `Readiness check on ${vms.length} endpoint(s) (remediate users=${remediateUsers}, vc++=${remediateVc})`);

    await runPool(vms, CONCURRENCY, async (vm) => {
      try {
        if (remediateUsers || remediateVc) {
          await remediateEndpoint(vm, { users: remediateUsers, vcredist: remediateVc });
        } else {
          await assessEndpoint(vm, { live: true });
        }
        const fresh = await VM.findById(vm._id).lean();
        if (fresh?.readiness?.allPass) stats.success++;
        else stats.failed++;
      } catch (err) {
        stats.failed++;
        await log('error', `${vm.name}: ${err.message}`);
      }
      done++;
      const progress = stats.total ? Math.round((done / stats.total) * 100) : 100;
      await Job.findByIdAndUpdate(jobId, { $set: { progress, statistics: stats } });
      io?.emit('job:progress', { jobId, progress, statistics: stats });
    });

    const finalStatus = stats.failed > 0 && stats.success === 0 ? 'failed' : 'completed';
    await Job.findByIdAndUpdate(jobId, {
      $set: { status: finalStatus, progress: 100, statistics: stats, completedAt: new Date() },
    });
    io?.emit('job:completed', { jobId, status: finalStatus, progress: 100, statistics: stats });
    await activityLog.write({
      category: 'readiness',
      level: finalStatus === 'failed' ? 'error' : 'success',
      message: `Readiness ${finalStatus}: pass ${stats.success}, fail ${stats.failed}`,
      jobId: job._id,
      meta: stats,
    }, io);
    return job;
  } finally {
    fleetInFlight = false;
  }
}

function queueFleetReadiness(io, options = {}) {
  setImmediate(() => {
    runFleetReadiness(io, options).catch((err) => {
      logger.error(`Fleet readiness failed: ${err.message}`);
      fleetInFlight = false;
    });
  });
}

function queueReadinessOnLogin(io, options = {}) {
  setImmediate(() => {
    runFleetReadiness(io, {
      ...options,
      reason: 'login',
      onlineOnly: true,
      remediateUsers: options.remediateUsers !== false,
      remediateVc: options.remediateVc !== false,
    }).catch((err) => {
      logger.error(`Login readiness failed: ${err.message}`);
      fleetInFlight = false;
    });
  });
}

module.exports = {
  TASK_DEFS,
  buildTaskList,
  assessEndpoint,
  remediateEndpoint,
  runFleetReadiness,
  queueFleetReadiness,
  queueReadinessOnLogin,
};
