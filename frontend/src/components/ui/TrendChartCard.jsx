import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import CardShell, { CardEmpty, CardLoading } from './CardShell';

const PRIMARY = '#2F3EA0';

export default function TrendChartCard({
  title, subtitle, data, legend, loading, empty, rangeLabel = '7d',
}) {
  if (loading) {
    return (
      <CardShell title={title} subtitle={subtitle} className="trend-card-wrap">
        <CardLoading />
      </CardShell>
    );
  }
  const series = data?.series || [];
  if (empty || !series.length) {
    return (
      <CardShell title={title} subtitle={subtitle} className="trend-card-wrap">
        <CardEmpty message="No trend data yet — monitor cycles will populate this chart" />
      </CardShell>
    );
  }

  return (
    <CardShell
      title={title}
      subtitle={subtitle}
      className="trend-card-wrap"
      action={<span className="dash-pill muted-pill">{rangeLabel}</span>}
    >
      <div className="trend-legend">
        {(legend || []).map((l) => (
          <span key={l.key} className="legend-pill">
            <span className="legend-dot" style={{ background: l.color || PRIMARY }} />
            {l.label}
          </span>
        ))}
      </div>
      <div className="trend-chart">
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={PRIMARY} stopOpacity={0.35} />
                <stop offset="100%" stopColor={PRIMARY} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={32} />
            <Tooltip
              contentStyle={{ borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 12 }}
              formatter={(v, name) => [v, name === 'online' ? 'Online' : name]}
            />
            <Area type="monotone" dataKey="online" stroke={PRIMARY} fill="url(#trendGrad)" strokeWidth={2} />
            <Area type="monotone" dataKey="events" stroke="#5B6FD6" fill="none" strokeWidth={1.5} strokeDasharray="4 4" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </CardShell>
  );
}
