import { Link } from 'react-router-dom';
import { Activity, Briefcase, Radio, RefreshCw } from 'lucide-react';
import CardShell, { CardEmpty, CardLoading } from './CardShell';

const CAT_ICON = {
  job: Briefcase,
  monitor: Radio,
  sync: RefreshCw,
};

function formatTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function ActivityTrackCard({ title, subtitle, items, loading, empty }) {
  if (loading) {
    return (
      <CardShell title={title} subtitle={subtitle} className="activity-track-card">
        <CardLoading />
      </CardShell>
    );
  }
  if (empty || !items?.length) {
    return (
      <CardShell title={title} subtitle={subtitle} className="activity-track-card">
        <CardEmpty message="No activity in the last 24 hours — monitor, sync, and jobs will appear here" />
      </CardShell>
    );
  }

  return (
    <CardShell
      title={title}
      subtitle={subtitle}
      className="activity-track-card"
      action={(
        <Link to="/logs" className="dash-track-view-all">View audit log</Link>
      )}
    >
      <ul className="dash-track-list">
        {items.map((row) => {
          const Icon = CAT_ICON[row.category] || Activity;
          const levelCls = row.level === 'error' ? 'track-level-error' : row.level === 'warning' ? 'track-level-warn' : '';
          return (
            <li key={row.id} className={`dash-track-row ${levelCls}`}>
              <span className="dash-track-icon" aria-hidden>
                <Icon size={14} strokeWidth={1.5} />
              </span>
              <div className="dash-track-body">
                <span className="dash-track-msg">{row.message}</span>
                {row.detail ? <span className="dash-track-detail">{row.detail}</span> : null}
              </div>
              <span className="dash-track-meta">
                <span className="dash-track-cat">{row.category}</span>
                <time dateTime={row.time}>{formatTime(row.time)}</time>
              </span>
            </li>
          );
        })}
      </ul>
    </CardShell>
  );
}
