const VM = require('../models/VM');
const Job = require('../models/Job');
const ActivityLog = require('../models/ActivityLog');
const endpointSync = require('./endpointSync');
const { countFleetReady } = require('../utils/readinessSummary');

const CHART_PRIMARY = '#F55A4D';
const CHART_COLORS = ['#F55A4D', '#052140', '#5B6FD6', '#8FA4E8', '#94A3B8'];

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

function buildVmQuery(filter = {}) {
  const base = { excluded: false, osType: 'windows' };
  if (filter.status === 'online') return { ...base, status: 'online' };
  if (filter.status === 'offline') return { ...base, status: 'offline' };
  return base;
}

/** DB-synced widgets — updated on full sync or manual synced refresh */
async function getDashboardSynced(filter = {}) {
  const vmQuery = buildVmQuery(filter);
  const allVms = await VM.find(vmQuery)
    .select('status agentStatus version localUsers powerState lastFullSyncAt rscdStatus crowdStrikeStatus vcRedist2015X64 readiness')
    .lean();

  const total = allVms.length;
  const online = allVms.filter((v) => v.status === 'online').length;
  const offline = allVms.filter((v) => v.status === 'offline').length;
  const activeAgents = allVms.filter(
    (v) => v.agentStatus !== 'removed' && v.version !== 'removed',
  ).length;
  const rscdActive = allVms.filter((v) => v.rscdStatus === 'installed' || (v.agentStatus === 'active' && v.version && v.version !== 'removed')).length;
  const rscdAbsent = allVms.filter((v) => v.rscdStatus === 'absent' || v.agentStatus === 'removed').length;
  const csInstalled = allVms.filter((v) => v.crowdStrikeStatus === 'installed').length;

  const requiredPerHost = 3;
  const localPresent = allVms.reduce((s, v) => s + (v.localUsers?.present || 0), 0);
  const localRequired = allVms.length * requiredPerHost;
  const onlinePct = total ? Math.round((online / total) * 100) : 0;

  const days = lastNDays(7);
  const since = days[0];
  const [monitorLogs, auditLogs, syncLogs] = await Promise.all([
    ActivityLog.find({ category: 'monitor', timestamp: { $gte: since } })
      .sort({ timestamp: 1 })
      .select('timestamp meta')
      .lean(),
    ActivityLog.find({ category: 'sync', timestamp: { $gte: since } })
      .sort({ timestamp: 1 })
      .select('timestamp status meta')
      .lean(),
    ActivityLog.find({ action: 'sync.full', status: 'success', timestamp: { $gte: since } })
      .sort({ timestamp: 1 })
      .select('timestamp meta')
      .lean(),
  ]);

  const trend = days.map((d) => {
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    const dayMonitors = monitorLogs.filter((l) => l.timestamp >= d && l.timestamp < next);
    const lastMonitor = dayMonitors[dayMonitors.length - 1];
    const daySyncs = syncLogs.filter((l) => l.timestamp >= d && l.timestamp < next);
    const lastSync = daySyncs[daySyncs.length - 1];
    const syncedOnline = lastSync?.meta?.ok ?? lastMonitor?.meta?.online ?? null;
    const dayAudits = auditLogs.filter((l) => l.timestamp >= d && l.timestamp < next);
    return {
      date: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      online: syncedOnline != null ? syncedOnline : (dayAudits.length ? dayAudits.filter((l) => l.status === 'success').length : 0),
      events: dayAudits.length,
    };
  });

  if (trend.length && online > 0) {
    trend[trend.length - 1].online = online;
  }

  const donutSegments = [
    { name: 'Online', value: online, color: CHART_PRIMARY },
    { name: 'Offline', value: offline, color: '#052140' },
    { name: 'In progress', value: allVms.filter((v) => v.status === 'in_progress').length, color: '#FF9500' },
    { name: 'Excluded', value: await VM.countDocuments({ excluded: true, osType: 'windows' }), color: '#8E8E93' },
  ].filter((s) => s.value > 0);

  const readyCounts = countFleetReady(allVms);

  const jobs = await Job.find({}).select('status').lean();
  const jobsTotal = jobs.length;
  const jobsCompleted = jobs.filter((j) => j.status === 'completed').length;

  const syncStatus = endpointSync.getSyncStatus();
  const lastSyncAt = syncStatus.lastSyncAt
    || allVms.reduce((max, v) => (v.lastFullSyncAt && (!max || v.lastFullSyncAt > max) ? v.lastFullSyncAt : max), null);

  return {
    stats: {
      totalEndpoints: { value: total, unit: 'endpoints' },
      onlineEndpoints: { value: online, unit: 'synced online' },
    },
    kpis: {
      total,
      online,
      offline,
      rscdActive,
      rscdAbsent,
      crowdStrikeInstalled: csInstalled,
      ready: readyCounts.ready,
      notReady: readyCounts.notReady,
      readyUnknown: readyCounts.unknown,
    },
    trend: {
      series: trend,
      legend: [
        { key: 'online', label: 'Online (synced)', color: CHART_PRIMARY },
        { key: 'events', label: 'Sync events', color: '#5B6FD6' },
      ],
    },
    donut: {
      segments: donutSegments,
      centerPercent: onlinePct,
      caption: 'Fleet connectivity (last sync)',
      legend: donutSegments.map((s) => ({ name: s.name, value: s.value })),
    },
    progress: {
      items: [
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
      ],
    },
    meta: {
      source: 'synced',
      lastSyncAt: lastSyncAt ? new Date(lastSyncAt).toISOString() : null,
      generatedAt: new Date().toISOString(),
      filter: filter.status || 'all',
      colors: CHART_COLORS,
    },
  };
}

/** Live/agent widgets — auto-refresh on tick */
async function getDashboardLive(filter = {}) {
  const vmQuery = buildVmQuery(filter);
  const vms = await VM.find(vmQuery)
    .select('name status agentStatus version connectivityState localUsers powerState lastSeenAt lastCheck rscdStatus vcRedist2015X64 readiness')
    .sort({ name: 1 })
    .lean();

  const readyCounts = countFleetReady(vms);

  const requiredPerHost = 3;
  const onlineNow = vms.filter((v) => v.status === 'online').length;
  const powerOn = vms.filter((v) => v.powerState === 'on').length;
  const powerOff = vms.filter((v) => v.powerState === 'off').length;

  const list = vms
    .map((v) => {
      const lu = v.localUsers;
      const needsAttention = v.status !== 'online'
        || (lu && (lu.present || 0) < (lu.required || requiredPerHost));
      return {
        id: String(v._id),
        label: v.name,
        sub: `${v.connectivityState || v.status || 'unknown'} · power ${v.powerState || 'unknown'}`,
        value: v.status === 'online' ? 'online' : (v.powerState || 'offline'),
        status: v.status,
        needsAttention,
      };
    })
    .filter((r) => r.needsAttention)
    .slice(0, 5);

  const since = lastNDays(6)[0];
  const recentJobs = await Job.find({ createdAt: { $gte: since } })
    .select('createdAt status')
    .lean();
  const [jobsRunning, jobsPending, jobsCompleted, jobsFailed, jobsCancelled] = await Promise.all([
    Job.countDocuments({ status: 'running' }),
    Job.countDocuments({ status: 'pending' }),
    Job.countDocuments({ status: 'completed' }),
    Job.countDocuments({ status: 'failed' }),
    Job.countDocuments({ status: 'cancelled' }),
  ]);
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

  const since24h = new Date(Date.now() - 86400000);
  const trackLogs = await ActivityLog.find({
    timestamp: { $gte: since24h },
  })
    .sort({ timestamp: -1 })
    .limit(60)
    .select('message timestamp category level status meta vmName actor')
    .lean();

  const offlineNow = vms.length - onlineNow;

  return {
    stats: {
      onlineNow: { value: onlineNow, unit: 'live online' },
      powerOn: { value: powerOn, unit: 'power on' },
      powerOff: { value: powerOff, unit: 'power off' },
      jobsRunning: { value: jobsRunning, unit: 'running jobs' },
    },
    kpis: {
      online: onlineNow,
      offline: offlineNow,
      unknown: Math.max(0, vms.length - onlineNow - offlineNow),
      jobsRunning,
      jobsPending,
      jobsCompleted,
      jobsFailed,
      jobsCancelled,
      powerOn,
      powerOff,
      ready: readyCounts.ready,
      notReady: readyCounts.notReady,
      readyUnknown: readyCounts.unknown,
    },
    track: {
      items: trackLogs.map((l) => ({
        id: String(l._id),
        message: l.message,
        time: l.timestamp,
        category: l.category || 'activity',
        level: l.level || (l.status === 'failed' || l.status === 'error' ? 'error' : 'info'),
        detail: l.vmName || l.meta?.vm || l.meta?.endpoint || (l.actor && l.actor !== 'system' ? `actor: ${l.actor}` : ''),
      })),
    },
    list: { title: 'Needs attention', items: list },
    bars: { items: bars, label: 'Jobs created (6 days)' },
    meta: {
      source: 'live',
      generatedAt: new Date().toISOString(),
      filter: filter.status || 'all',
    },
  };
}

async function getDashboard(filter = {}) {
  const [synced, live] = await Promise.all([
    getDashboardSynced(filter),
    getDashboardLive(filter),
  ]);
  return { synced, live };
}

module.exports = { getDashboard, getDashboardSynced, getDashboardLive };
