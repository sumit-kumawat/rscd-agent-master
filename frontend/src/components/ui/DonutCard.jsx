import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import CardShell, { CardEmpty, CardLoading } from './CardShell';

export default function DonutCard({
  title, subtitle, segments, centerPercent, caption, legend, loading, empty,
}) {
  if (loading) {
    return (
      <CardShell title={title} subtitle={subtitle}>
        <CardLoading />
      </CardShell>
    );
  }
  if (empty || !segments?.length) {
    return (
      <CardShell title={title} subtitle={subtitle}>
        <CardEmpty message="No endpoints in inventory" />
      </CardShell>
    );
  }

  return (
    <CardShell title={title} subtitle={subtitle}>
      <div className="donut-wrap">
        <div className="donut-chart">
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie
                data={segments}
                dataKey="value"
                nameKey="name"
                innerRadius={58}
                outerRadius={78}
                paddingAngle={2}
                strokeWidth={0}
              >
                {segments.map((s) => (
                  <Cell key={s.name} fill={s.color || '#2F3EA0'} />
                ))}
              </Pie>
              <Tooltip formatter={(v, name) => [v, name]} />
            </PieChart>
          </ResponsiveContainer>
          <div className="donut-center">
            <span className="donut-pct">{centerPercent}%</span>
          </div>
        </div>
        {caption && <p className="donut-caption">{caption}</p>}
        <div className="donut-legend">
          {(legend || segments).map((s) => (
            <div key={s.name} className="donut-legend-row">
              <span className="legend-dot" style={{ background: s.color || '#2F3EA0' }} />
              <span className="donut-legend-name">{s.name}</span>
              <span className="donut-legend-val">{s.value}</span>
            </div>
          ))}
        </div>
      </div>
    </CardShell>
  );
}
