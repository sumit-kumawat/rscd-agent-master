import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from './api';
import { onSocket } from './socket';
import { useRefresh } from './context/RefreshContext';
import StatCard from './components/ui/StatCard';
import TrendChartCard from './components/ui/TrendChartCard';
import DonutCard from './components/ui/DonutCard';
import ListCard from './components/ui/ListCard';
import MiniProgressCard from './components/ui/MiniProgressCard';
import MiniBarChartCard from './components/ui/MiniBarChartCard';

export default function DashboardPage({ filter = '' }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const { tick } = useRefresh();
  const nav = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = filter ? `?status=${encodeURIComponent(filter)}` : '';
      const r = await api.get(`/dashboard${q}`);
      setData(r.data ?? r);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load, tick]);
  useEffect(() => onSocket('vm:status', load), [load]);
  useEffect(() => onSocket('monitor:cycle', load), [load]);
  useEffect(() => onSocket('job:completed', load), [load]);
  useEffect(() => onSocket('log:activity', load), [load]);

  const stats = data?.stats;
  const hasData = data && stats?.totalEndpoints?.value > 0;

  return (
    <div className="dashboard-page">
      <div className="dashboard-grid">
        <div className="dashboard-col-narrow">
          <StatCard
            title="Total Endpoints"
            subtitle="Managed Windows hosts"
            value={stats?.totalEndpoints?.value}
            unit={stats?.totalEndpoints?.unit}
            loading={loading}
            empty={!hasData}
          />
          <StatCard
            title="Online Now"
            subtitle="WMI reachable"
            value={stats?.onlineEndpoints?.value}
            unit={stats?.onlineEndpoints?.unit}
            loading={loading}
            empty={!hasData}
          />
        </div>
        <div className="dashboard-col-wide">
          <TrendChartCard
            title="Connectivity Trend"
            subtitle="Monitor cycles & audit activity (7 days)"
            data={data?.trend}
            legend={data?.trend?.legend}
            loading={loading}
            empty={!data?.trend?.series?.length}
          />
        </div>

        <div className="dashboard-col-donut">
          <DonutCard
            title="Fleet Status"
            subtitle="Connectivity distribution"
            segments={data?.donut?.segments}
            centerPercent={data?.donut?.centerPercent ?? 0}
            caption={data?.donut?.caption}
            legend={data?.donut?.legend}
            loading={loading}
            empty={!data?.donut?.segments?.length}
          />
        </div>
        <div className="dashboard-col-list">
          <ListCard
            title={data?.list?.title || 'Needs attention'}
            subtitle="Offline or incomplete local users"
            items={data?.list?.items}
            loading={loading}
            empty={!data?.list?.items?.length}
            onItemClick={(item) => nav('/vms', { state: { openVmId: item.id } })}
          />
        </div>
        <div className="dashboard-col-stack">
          <MiniProgressCard
            title="Fleet Progress"
            subtitle="Provisioning & compliance"
            items={data?.progress?.items}
            loading={loading}
            empty={!data?.progress?.items?.length}
          />
          <MiniBarChartCard
            title="Job Activity"
            subtitle={data?.bars?.label || 'Jobs created'}
            items={data?.bars?.items}
            loading={loading}
            empty={!data?.bars?.items?.length}
          />
        </div>
      </div>
    </div>
  );
}
