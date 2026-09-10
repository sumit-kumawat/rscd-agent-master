const VM = require('../models/VM');
const Job = require('../models/Job');
const uninstall = require('./uninstall');
const activityLog = require('./activityLog');

async function cleanupJobsForVms(vmIds, io) {
  const idSet = new Set(vmIds.map((id) => String(id)));
  const jobs = await Job.find({ vms: { $in: vmIds } });
  let deletedJobs = 0;
  let updatedJobs = 0;

  for (const job of jobs) {
    const remaining = job.vms.filter((v) => !idSet.has(String(v)));
    if (remaining.length === 0) {
      if (job.status === 'running') {
        try {
          await uninstall.cancel(job._id.toString(), io);
        } catch {
          job.status = 'cancelled';
          job.completedAt = new Date();
          await job.save();
        }
      }
      await Job.deleteOne({ _id: job._id });
      deletedJobs++;
      await activityLog.write({
        category: 'job',
        level: 'info',
        message: `Job removed (VM deleted): ${job.name}`,
        jobId: job._id,
      }, io);
    } else {
      job.vms = remaining;
      job.statistics.total = remaining.length;
      if (job.progress > 0 && job.statistics) {
        const done = (job.statistics.success || 0) + (job.statistics.failed || 0) + (job.statistics.skipped || 0);
        job.progress = Math.min(100, Math.round((done / remaining.length) * 100));
      }
      await job.save();
      updatedJobs++;
      await activityLog.write({
        category: 'job',
        level: 'info',
        message: `Job updated (VM removed): ${job.name} — ${remaining.length} VM(s) left`,
        jobId: job._id,
      }, io);
    }
  }

  return { deletedJobs, updatedJobs };
}

async function deleteVmsWithCleanup(vmIds, io) {
  const vms = await VM.find({ _id: { $in: vmIds } }).lean();
  if (!vms.length) return { deleted: 0, deletedJobs: 0, updatedJobs: 0 };

  const jobResult = await cleanupJobsForVms(vmIds, io);
  await VM.deleteMany({ _id: { $in: vmIds } });

  for (const vm of vms) {
    await activityLog.write({
      category: 'vm',
      level: 'warning',
      message: `VM deleted: ${vm.name} (${vm.ip})`,
      vmId: vm._id,
      vmName: vm.name,
      meta: { jobsRemoved: jobResult.deletedJobs },
    }, io);
  }

  io?.emit('vms:deleted', { ids: vmIds.map(String), count: vms.length });

  return { deleted: vms.length, ...jobResult };
}

module.exports = { deleteVmsWithCleanup, cleanupJobsForVms };
