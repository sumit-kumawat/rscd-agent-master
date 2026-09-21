const VM = require('../models/VM');
const Job = require('../models/Job');
const ActivityLog = require('../models/ActivityLog');

const CHART_PRIMARY = '#2F3EA0';
const CHART_COLORS = ['#2F3EA0', '#5B6FD6', '#8FA4E8', '#C5D0F5', '#94A3B8'];

function dayKey(d) {
  return d.toISOString().slice(0, 10);
}

function lastNDays(n) {
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    days.push(d);
  }
  return days;
}

async function getDashboard(filter = {}) {
  const base = { excluded: false, osType: 'windows' };
  let vmQuery = { ...base };
  if (filter.status === 'online') vmQuery.status = 'online';
  else if (filter.status === 'offline') vmQuery.status = 'offline';

  const vms = await VM.find(vmQuery)
    .select('name status agentStatus version connectivityState localUsers powerState lastSeenAt lastCheck')
    .sort({ name: 1 })
    .lean();

  const statsQuery = { ...base };
  if (filter.status === 'online') statsQuery.status = 'online';
  else if (filter.status === 'offline') statsQuery.status = 'offline';
  const allVms = await VM.find(statsQuery).select('status agentStatus version localUsers powerState').lean();

  const total = allVms.length;
  const online = allVms.filter((v) => v.status === 'online').length;
  const offline = allVms.filter((v) => v.status === 'offline').length;
  const activeAgents = allVms.filter(
    (v) => v.agentStatus !== 'removed' && v.version !== 'removed',
  ).length;
  const removedAgents = total - activeAgents;

  const requiredPerHost = 3;
  const localUsersCompliant = allVms.filter((v) => {
    const lu = v.localUsers;
    return lu && (lu.present || 0) >= (lu.required || requiredPerHost);
  }).length;

  const days = lastNDays(7);
  const since = days[0];
  const [monitorLogs, auditLogs, recentJobs] = await Promise.all([
    ActivityLog.find({ category: 'monitor', timestamp: { $gte: since } })
      .sort({ timestamp: 1 })
      .select('timestamp meta message')
      .lean(),
    ActivityLog.find({ timestamp: { $gte: since } })
      .sort({ timestamp: 1 })
      .select('timestamp status level category')
      .lean(),
    Job.find({ createdAt: { $gte: since } })
      .select('createdAt status statistics')
      .lean(),
  ]);

  const trend = days.map((d) => {
    const key = dayKey(d);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    const dayMonitors = monitorLogs.filter((l) => l.timestamp >= d && l.timestamp < next);
    const lastMonitor = dayMonitors[dayMonitors.length - 1];
    const onlineCount = lastMonitor?.meta?.online ?? (dayMonitors.length ? null : null);
    const dayAudits = auditLogs.filter((l) => l.timestamp >= d && l.timestamp < next);
    return {
      date: key,
      label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      online: onlineCount != null ? onlineCount : dayAudits.filter((l) => l.status === 'success').length,
      events: dayAudits.length,
      errors: dayAudits.filter((l) => l.level === 'error' || l.status === 'failed').length,
    };
  });

  if (trend.length && trend[trend.length - 1].online === 0 && online > 0) {
    trend[trend.length - 1].online = online;
  }

  const onlinePct = total ? Math.round((online / total) * 100) : 0;
  const powerOn = allVms.filter((v) => v.powerState === 'on' || v.status === 'online').length;
  const powerOff = allVms.filter((v) => v.powerState === 'off').length;
  const powerUnknown = total - powerOn - powerOff;

  const donutSegments = [
    { name: 'Online', value: online, color: CHART_PRIMARY },
    { name: 'Offline', value: offline, color: '#EF4444' },
    { name: 'In progress', value: allVms.filter((v) => v.status === 'in_progress').length, color: '#F59E0B' },
    { name: 'Excluded', value: await VM.countDocuments({ excluded: true, osType: 'windows' }), color: '#94A3B8' },
  ].filter((s) => s.value > 0);

  const list = vms
    .map((v) => {
      const lu = v.localUsers;
      const luStr = lu ? `${lu.present || 0}/${lu.required || requiredPerHost}` : null;
      const needsAttention = v.status !== 'online'
        || (lu && (lu.present || 0) < (lu.required || requiredPerHost));
      return {
        id: String(v._id),
        label: v.name,
        sub: v.connectivityState || v.status || 'unknown',
        value: luStr || (v.powerState || '—'),
        status: v.status,
        needsAttention,
      };
    })
    .filter((r) => r.needsAttention)
    .slice(0, 5);

  const jobs = await Job.find({}).select('status statistics progress').lean();
  const jobsTotal = jobs.length;
  const jobsCompleted = jobs.filter((j) => j.status === 'completed').length;
  const jobsRunning = jobs.filter((j) => j.status === 'running').length;
  const jobsFailed = jobs.filter((j) => j.status === 'failed').length;

  const localPresent = allVms.reduce((s, v) => s + (v.localUsers?.present || 0), 0);
  const localRequired = allVms.length * requiredPerHost;

  const progress = [
    {
      label: 'Local users provisioned',
      value: localRequired ? Math.round((localPresent / localRequired) * 100) : 0,
      detail: `${localPresent} / ${localRequired} accounts`,
    },
    {
      label: 'Agents active',
      value: total ? Math.round((activeAgents / total) * 100) : 0,
      detail: `${activeAgents} / ${total} endpoints`,
    },
    {
      label: 'Jobs completed',
      value: jobsTotal ? Math.round((jobsCompleted / jobsTotal) * 100) : 0,
      detail: `${jobsCompleted} / ${jobsTotal} jobs`,
    },
    {
      label: 'Endpoints online',
      value: onlinePct,
      detail: `${online} / ${total} online`,
    },
  ];

  const barDays = lastNDays(6);
  const bars = barDays.map((d) => {
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    const count = recentJobs.filter((j) => j.createdAt >= d && j.createdAt < next).length;
    return {
      label: d.toLocaleDateString('en-US', { weekday: 'short' }),
      value: count,
    };
  });

  return {
    stats: {
      totalEndpoints: { value: total, unit: 'endpoints' },
      onlineEndpoints: { value: online, unit: 'online' },
      activeAgents: { value: activeAgents, unit: 'active agents' },
      localUsersCompliant: { value: localUsersCompliant, unit: `of ${total} compliant` },
    },
    trend: {
      series: trend,
      legend: [
        { key: 'online', label: 'Online (monitor)', color: CHART_PRIMARY },
        { key: 'events', label: 'Audit events', color: '#5B6FD6' },
      ],
    },
    donut: {
      segments: donutSegments,
      centerPercent: onlinePct,
      caption: 'Endpoint connectivity',
      legend: donutSegments.map((s) => ({ name: s.name, value: s.value })),
    },
    list: {
      title: 'Needs attention',
      items: list,
    },
    progress: { items: progress },
    bars: { items: bars, label: 'Jobs created (6 days)' },
    meta: {
      generatedAt: new Date().toISOString(),
      filter: filter.status || 'all',
      colors: CHART_COLORS,
    },
  };
}

module.exports = { getDashboard };
