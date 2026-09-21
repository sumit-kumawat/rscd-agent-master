import CardShell, { CardEmpty, CardLoading } from './CardShell';

export default function StatCard({ title, subtitle, value, unit, loading, empty }) {
  if (loading) {
    return (
      <CardShell title={title} subtitle={subtitle} className="stat-card-wrap">
        <CardLoading />
      </CardShell>
    );
  }
  if (empty || value == null) {
    return (
      <CardShell title={title} subtitle={subtitle} className="stat-card-wrap">
        <CardEmpty />
      </CardShell>
    );
  }
  return (
    <CardShell title={title} subtitle={subtitle} className="stat-card-wrap">
      <div className="stat-card-value">{value}</div>
      {unit && <div className="stat-card-unit">{unit}</div>}
    </CardShell>
  );
}
