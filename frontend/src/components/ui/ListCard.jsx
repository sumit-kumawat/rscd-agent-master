import { Server } from 'lucide-react';
import CardShell, { CardEmpty, CardLoading } from './CardShell';

export default function ListCard({ title, subtitle, items, loading, empty, onItemClick }) {
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
        <CardEmpty message="All endpoints healthy — nothing needs attention" />
      </CardShell>
    );
  }

  return (
    <CardShell title={title} subtitle={subtitle}>
      <ul className="dash-list">
        {items.map((item) => (
          <li key={item.id || item.label}>
            <button
              type="button"
              className="dash-list-row"
              onClick={() => onItemClick?.(item)}
            >
              <span className="dash-list-icon"><Server size={16} /></span>
              <span className="dash-list-text">
                <span className="dash-list-label">{item.label}</span>
                <span className="dash-list-sub">{item.sub}</span>
              </span>
              <span className="dash-list-value">{item.value}</span>
            </button>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}
