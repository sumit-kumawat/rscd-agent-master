import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from './api';
import { useRefresh } from './context/RefreshContext';
import { useSync } from './context/SyncContext';
import { useLayoutFilter } from './Layout';
import { useLiveData } from './hooks/useLiveData';
import CardShell from './components/ui/CardShell';
import TrendChartCard from './components/ui/TrendChartCard';
import DonutCard from './components/ui/DonutCard';
import ListCard from './components/ui/ListCard';
import MiniProgressCard from './components/ui/MiniProgressCard';
import MiniBarChartCard from './components/ui/MiniBarChartCard';

function FleetTotals({ stats, liveStats }) {
  const total = stats?.totalEndpoints?.value ?? '—';
  const online = liveStats?.onlineNow?.value ?? stats?.onlineEndpoints?.value ?? '—';
  const offline = (typeof total === 'number' && typeof online === 'number') ? Math.max(0, total - online) : '—';
  return (
    <CardShell title="Endpoints" subtitle="Total / Online / Offline" className="dash-totals-card">
      <div className="dash-totals-row dash-totals-inline">
        <div className="dash-total-item">
          <span className="dash-total-label">Total</span>
          <span className="dash-total-value">{total}</span>
        </div>
        <div className="dash-total-item">
          <span className="dash-total-label">Online</span>
          <span className="dash-total-value stat-success">{online}</span>
        </div>
        <div className="dash-total-item">
          <span className="dash-total-label">Offline</span>
          <span className="dash-total-value stat-danger">{offline}</span>
        </div>
      </div>
    </CardShell>
  );
}

export default function DashboardPage() {
  const filter = useLayoutFilter();
  const { tick } = useRefresh();
  const { syncedTick } = useSync();
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

  const stats = synced?.stats;
  const liveStats = live?.stats;

  return (
    <div className="dashboard-page dashboard-page-fixed">
      <div className="dashboard-v2">
        <FleetTotals stats={stats} liveStats={liveStats} />
        <div className="dashboard-v2-five">
          <ListCard
            title="Needs Attention"
            subtitle="Live health"
            items={live?.list?.items}
            loading={false}
            empty={!live?.list?.items?.length}
            onItemClick={(item) => nav('/vms', { state: { openVmId: item.id } })}
          />
          <MiniBarChartCard
            title="Job Activities"
            subtitle={live?.bars?.label || 'Throughput'}
            items={live?.bars?.items}
            loading={false}
            empty={!live?.bars?.items?.length}
          />
          <MiniProgressCard
            title="Fleet Progress"
            subtitle="Compliance"
            items={synced?.progress?.items}
            loading={false}
            empty={!synced?.progress?.items?.length}
          />
          <TrendChartCard
            title="Connectivity Trends"
            subtitle="7-day history"
            data={synced?.trend}
            legend={synced?.trend?.legend}
            loading={false}
            empty={!synced?.trend?.series?.length}
          />
          <DonutCard
            title="Fleet Status"
            subtitle="Last sync"
            segments={synced?.donut?.segments}
            centerPercent={synced?.donut?.centerPercent ?? 0}
            caption={synced?.donut?.caption}
            legend={synced?.donut?.legend}
            loading={false}
            empty={!synced?.donut?.segments?.length}
          />
        </div>
      </div>
    </div>
  );
}
