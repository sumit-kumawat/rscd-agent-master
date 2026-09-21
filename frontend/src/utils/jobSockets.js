/** Patch a job row from a socket payload without a full API reload. */
export function patchJob(job, data) {
  if (!job || String(job._id) !== String(data.jobId)) return job;
  return {
    ...job,
    ...(data.status ? { status: data.status } : {}),
    ...(data.progress != null ? { progress: data.progress } : {}),
    ...(data.statistics ? { statistics: data.statistics } : {}),
    ...(data.job ? data.job : {}),
  };
}

export function patchJobList(jobs, data) {
  if (!data?.jobId) return jobs;
  const idx = jobs.findIndex((j) => String(j._id) === String(data.jobId));
  if (idx < 0) return jobs;
  const next = [...jobs];
  next[idx] = patchJob(next[idx], data);
  return next;
}
