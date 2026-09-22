import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from './api';
import { useRefresh } from './context/RefreshContext';
import { useSync } from './context/SyncContext';
import { useLayoutFilter } from './Layout';
import { useLiveData } from './hooks/useLiveData';
import TrendChartCard from './components/ui/TrendChartCard';
import DonutCard from './components/ui/DonutCard';
import ListCard from './components/ui/ListCard';
import MiniProgressCard from './components/ui/MiniProgressCard';
import MiniBarChartCard from './components/ui/MiniBarChartCard';
import ActivityTrackCard from './components/ui/ActivityTrackCard';
import { Link } from 'react-router-dom';

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

function KpiStrip({ kpis, lastSyncAt }) {
  const items = kpis || [];
  return (
    <section className="dash-kpi-strip" aria-label="Fleet KPIs">
      {items.map((k) => (
        <div key={k.key} className="dash-kpi-tile">
          <span className="dash-kpi-label">{k.label}</span>
          <span className={`dash-kpi-value ${k.tone || ''}`}>{k.value}</span>
          {k.hint ? <span className="dash-kpi-hint">{k.hint}</span> : null}
        </div>
      ))}
      {lastSyncAt ? (
        <div className="dash-kpi-tile dash-kpi-sync">
          <span className="dash-kpi-label">Last full sync</span>
          <span className="dash-kpi-value dash-kpi-value-sm">
            {new Date(lastSyncAt).toLocaleString()}
          </span>
        </div>
      ) : null}
    </section>
  );
}

export default function DashboardPage() {
  const filter = useLayoutFilter();
  const { tick } = useRefresh();
  const { syncedTick, lastSyncAt } = useSync();
  const nav = useNavigate();

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

  const kpis = useMemo(() => {
    const s = synced?.kpis;
    const l = live?.kpis;
    if (!s && !l) return [];
    return [
      { key: 'total', label: 'Endpoints', value: s?.total ?? '—', hint: 'Windows fleet' },
      { key: 'online', label: 'Online (live)', value: l?.online ?? '—', tone: 'stat-success', hint: 'WMI reachable' },
      { key: 'offline', label: 'Offline', value: l?.offline ?? '—', tone: 'stat-danger' },
      { key: 'rscd', label: 'RSCD active', value: s?.rscdActive ?? '—', tone: 'stat-success', hint: 'Installed agents' },
      { key: 'jobs', label: 'Jobs running', value: l?.jobsRunning ?? '—', tone: l?.jobsRunning > 0 ? 'stat-warn' : '' },
      { key: 'power', label: 'Power on', value: l?.powerOn ?? '—', hint: l?.powerOff != null ? `${l.powerOff} off` : undefined },
    ];
  }, [synced, live]);

  const syncMeta = synced?.meta?.lastSyncAt || lastSyncAt;
  const fleetTotal = synced?.kpis?.total ?? synced?.stats?.totalEndpoints?.value;
  const showEmptyFleet = fleetTotal === 0;

  return (
    <div className="page dashboard-page">
      {showEmptyFleet && <DashboardEmptyBanner />}
      <KpiStrip kpis={kpis} lastSyncAt={syncMeta} />

      <div className="dashboard-grid-v3">
        <div className="dashboard-grid-main">
          <TrendChartCard
            title="Connectivity trends"
            subtitle="7-day online & sync activity"
            data={synced?.trend}
            legend={synced?.trend?.legend}
            loading={false}
            empty={!synced?.trend?.series?.length}
          />
          <DonutCard
            title="Fleet status"
            subtitle="Last sync snapshot"
            segments={synced?.donut?.segments}
            centerPercent={synced?.donut?.centerPercent ?? 0}
            caption={synced?.donut?.caption}
            legend={synced?.donut?.legend}
            loading={false}
            empty={!synced?.donut?.segments?.length}
          />
        </div>

        <div className="dashboard-grid-side">
          <ListCard
            title="Needs attention"
            subtitle="Offline or incomplete local users"
            items={live?.list?.items}
            loading={false}
            empty={!live?.list?.items?.length}
            onItemClick={(item) => nav('/vms', { state: { openVmId: item.id } })}
          />
          <MiniBarChartCard
            title="Job activity"
            subtitle={live?.bars?.label || 'Jobs created'}
            items={live?.bars?.items}
            loading={false}
            empty={!live?.bars?.items?.length}
          />
          <MiniProgressCard
            title="Fleet progress"
            subtitle="Compliance & completion"
            items={synced?.progress?.items}
            loading={false}
            empty={!synced?.progress?.items?.length}
          />
        </div>

        <div className="dashboard-grid-track">
          <ActivityTrackCard
            title="Activity track"
            subtitle="Live feed — monitor, sync, and jobs (24h)"
            items={live?.track?.items}
            loading={false}
            empty={!live?.track?.items?.length}
          />
        </div>
      </div>
    </div>
  );
}
