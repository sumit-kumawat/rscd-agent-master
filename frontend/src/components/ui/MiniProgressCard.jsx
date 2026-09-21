import CardShell, { CardEmpty, CardLoading } from './CardShell';

export default function MiniProgressCard({ title, subtitle, items, loading, empty }) {
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
        <CardEmpty />
      </CardShell>
    );
  }

  return (
    <CardShell title={title} subtitle={subtitle}>
      <div className="mini-progress-list">
        {items.map((item) => (
          <div key={item.label} className="mini-progress-row">
            <div className="mini-progress-head">
              <span className="mini-progress-label">{item.label}</span>
              <span className="mini-progress-pct">{item.value}%</span>
            </div>
            <div className="mini-progress-track">
              <div className="mini-progress-fill" style={{ width: `${Math.min(100, item.value)}%` }} />
            </div>
            {item.detail && <div className="mini-progress-detail">{item.detail}</div>}
          </div>
        ))}
      </div>
    </CardShell>
  );
}
