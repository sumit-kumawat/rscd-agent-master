import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import CardShell, { CardEmpty, CardLoading } from './CardShell';

const PRIMARY = '#2F3EA0';

export default function MiniBarChartCard({ title, subtitle, items, loading, empty }) {
  if (loading) {
    return (
      <CardShell title={title} subtitle={subtitle}>
        <CardLoading />
      </CardShell>
    );
  }
  if (empty || !items?.length) {
    return (
      <CardShell title={title} subtitle={subtitle}>
        <CardEmpty message="No jobs recorded in this period" />
      </CardShell>
    );
  }

  return (
    <CardShell title={title} subtitle={subtitle}>
      <div className="mini-bar-chart">
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={items} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 12 }} />
            <Bar dataKey="value" fill={PRIMARY} radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </CardShell>
  );
}
