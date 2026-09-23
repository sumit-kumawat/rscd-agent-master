import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import api from './api';
import { useRefresh } from './context/RefreshContext';
import { useSync } from './context/SyncContext';
import { useLayoutFilter } from './Layout';
import { useLiveData } from './hooks/useLiveData';

function DashboardEmptyBanner() {
  return (
    <div className="dashboard-empty-banner" role="status">
      <p><strong>No endpoints in inventory.</strong> Import a host list or add assets to populate the dashboard.</p>
      <div className="dashboard-empty-actions">
        <Link to="/vms" className="btn btn-primary btn-sm">Go to Assets</Link>
      </div>
    </div>
  );
}

function CountSection({ title, counts }) {
  if (!counts?.length) return null;
  return (
    <section className="dash-count-section" aria-label={title}>
      <h2 className="dash-count-section-title">{title}</h2>
      <div
        className="dash-kpi-strip dash-kpi-strip-fill"
        style={{ '--kpi-cols': counts.length }}
      >
        {counts.map((k) => (
          <div key={k.key} className="dash-kpi-tile">
            <span className="dash-kpi-label">{k.label}</span>
            <span className={`dash-kpi-value ${k.tone || ''}`}>{k.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function DashboardPage() {
  const filter = useLayoutFilter();
  const { tick } = useRefresh();
  const { syncedTick } = useSync();

  const q = useMemo(
    () => (filter ? `?status=${encodeURIComponent(filter)}` : ''),
    [filter],
  );

  const { data: synced } = useLiveData(
    async () => {
      const r = await api.get(`/dashboard/synced${q}`);
      return r.data ?? r;
    },
    [q, syncedTick],
  );

  const { data: live } = useLiveData(
    async () => {
      const r = await api.get(`/dashboard/live${q}`);
      return r.data ?? r;
    },
    [q, tick],
  );

  const endpointCounts = useMemo(() => {
    const s = synced?.kpis;
    const l = live?.kpis;
    if (!s && !l) return [];
    const total = s?.total ?? '—';
    const online = l?.online ?? s?.online ?? '—';
    const offline = l?.offline ?? s?.offline ?? '—';
    const unknown = l?.unknown ?? (typeof total === 'number' && typeof online === 'number' && typeof offline === 'number'
      ? Math.max(0, total - online - offline)
      : '—');
    return [
      { key: 'total', label: 'Total', value: total },
      { key: 'online', label: 'Online', value: online, tone: 'stat-success' },
      { key: 'offline', label: 'Offline', value: offline, tone: 'stat-danger' },
      { key: 'unknown', label: 'Other', value: unknown },
      { key: 'rscd', label: 'RSCD installed', value: s?.rscdActive ?? '—' },
      { key: 'cs', label: 'CrowdStrike installed', value: s?.crowdStrikeInstalled ?? '—' },
    ];
  }, [synced, live]);

  const jobCounts = useMemo(() => {
    const j = live?.kpis;
    if (!j) return [];
    return [
      { key: 'running', label: 'Running', value: j.jobsRunning ?? 0, tone: j.jobsRunning > 0 ? 'stat-warn' : '' },
      { key: 'pending', label: 'Queued', value: j.jobsPending ?? 0 },
      { key: 'completed', label: 'Completed', value: j.jobsCompleted ?? 0 },
      { key: 'failed', label: 'Failed', value: j.jobsFailed ?? 0, tone: j.jobsFailed > 0 ? 'stat-danger' : '' },
      { key: 'cancelled', label: 'Cancelled', value: j.jobsCancelled ?? 0 },
    ];
  }, [live]);

  const fleetTotal = synced?.kpis?.total ?? synced?.stats?.totalEndpoints?.value;
  const showEmptyFleet = fleetTotal === 0;
  const lastSync = synced?.meta?.lastSyncAt;

  return (
    <div className="page dashboard-page dashboard-page-minimal">
      {showEmptyFleet && <DashboardEmptyBanner />}
      <CountSection title="Endpoints" counts={endpointCounts} />
      <CountSection title="Jobs" counts={jobCounts} />
      {lastSync && (
        <p className="dashboard-meta-line" role="status">
          Last inventory sync: {new Date(lastSync).toLocaleString()}
        </p>
      )}
    </div>
  );
}
