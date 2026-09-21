import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from './api';
import { useRefresh } from './context/RefreshContext';
import { useSync } from './context/SyncContext';
import { useLayoutFilter } from './Layout';
import { useApiQuery } from './hooks/useApiQuery';
import StatCard from './components/ui/StatCard';
import TrendChartCard from './components/ui/TrendChartCard';
import DonutCard from './components/ui/DonutCard';
import ListCard from './components/ui/ListCard';
import MiniProgressCard from './components/ui/MiniProgressCard';
import MiniBarChartCard from './components/ui/MiniBarChartCard';

export default function DashboardPage() {
  const filter = useLayoutFilter();
  const { tick } = useRefresh();
  const { syncedTick } = useSync();
  const nav = useNavigate();

  const q = useMemo(
    () => (filter ? `?status=${encodeURIComponent(filter)}` : ''),
    [filter],
  );

  const syncedQuery = useApiQuery(
    async ({ timeout, signal }) => {
      const r = await api.get(`/dashboard/synced${q}`, { timeout, signal });
      return r.data ?? r;
    },
    [q, syncedTick],
  );

  const liveQuery = useApiQuery(
    async ({ timeout, signal }) => {
      const r = await api.get(`/dashboard/live${q}`, { timeout, signal });
      return r.data ?? r;
    },
    [q, tick],
  );

  const synced = syncedQuery.data;
  const live = liveQuery.data;
  const stats = synced?.stats;
  const liveStats = live?.stats;
  const hasData = stats?.totalEndpoints?.value > 0;

  return (
    <div className="dashboard-page">
      <div className="dashboard-grid">
        <div className="dashboard-col-narrow">
          <StatCard
            title="Total Endpoints"
            subtitle="From last full sync"
            value={stats?.totalEndpoints?.value}
            unit={stats?.totalEndpoints?.unit}
            loading={syncedQuery.isLoading}
            empty={!hasData}
          />
          <StatCard
            title="Online Now"
            subtitle="Live agent status"
            value={liveStats?.onlineNow?.value}
            unit={liveStats?.onlineNow?.unit}
            loading={liveQuery.isLoading}
            empty={!hasData && liveStats?.onlineNow?.value == null}
          />
        </div>
        <div className="dashboard-col-wide">
          <TrendChartCard
            title="Connectivity Trend"
            subtitle="Synced fleet history (7 days)"
            data={synced?.trend}
            legend={synced?.trend?.legend}
            loading={syncedQuery.isLoading}
            empty={!synced?.trend?.series?.length}
          />
        </div>
        <div className="dashboard-col-donut">
          <DonutCard
            title="Fleet Status"
            subtitle="Last sync snapshot"
            segments={synced?.donut?.segments}
            centerPercent={synced?.donut?.centerPercent ?? 0}
            caption={synced?.donut?.caption}
            legend={synced?.donut?.legend}
            loading={syncedQuery.isLoading}
            empty={!synced?.donut?.segments?.length}
          />
        </div>
        <div className="dashboard-col-list">
          <ListCard
            title={live?.list?.title || 'Needs attention'}
            subtitle="Live health & power"
            items={live?.list?.items}
            loading={liveQuery.isLoading}
            empty={!live?.list?.items?.length}
            onItemClick={(item) => nav('/vms', { state: { openVmId: item.id } })}
          />
        </div>
        <div className="dashboard-col-stack">
          <MiniProgressCard
            title="Fleet Progress"
            subtitle="Synced compliance metrics"
            items={synced?.progress?.items}
            loading={syncedQuery.isLoading}
            empty={!synced?.progress?.items?.length}
          />
          <MiniBarChartCard
            title="Job Activity"
            subtitle={live?.bars?.label || 'Live job throughput'}
            items={live?.bars?.items}
            loading={liveQuery.isLoading}
            empty={!live?.bars?.items?.length}
          />
        </div>
      </div>
    </div>
  );
}
