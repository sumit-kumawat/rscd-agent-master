import { RefreshCw, User, CloudDownload } from 'lucide-react';
import GlobalSearch from '../GlobalSearch';
import { useRefresh } from '../../context/RefreshContext';
import { useSync } from '../../context/SyncContext';
import { useSocketStatus } from '../../context/SocketContext';

export default function DashboardHeader({ filter, onFilterChange }) {
  const { refresh, autoRefresh, setAutoRefresh, intervalSec, setIntervalSec } = useRefresh();
  const { syncNow, syncing, lastSyncAt } = useSync();
  const socket = useSocketStatus();

  return (
    <header className="dash-header">
      <div className="dash-header-search">
        <GlobalSearch />
      </div>
      <div className="dash-header-controls">
        <select
          className="dash-control"
          value={filter}
          onChange={(e) => onFilterChange?.(e.target.value)}
          aria-label="Filter endpoints"
        >
          <option value="">All endpoints</option>
          <option value="online">Online only</option>
          <option value="offline">Offline only</option>
        </select>
        <button
          type="button"
          className="dash-control dash-btn"
          onClick={syncNow}
          disabled={syncing}
          title={lastSyncAt ? `Last sync: ${new Date(lastSyncAt).toLocaleString()}` : 'Sync all endpoints now'}
        >
          <CloudDownload size={16} strokeWidth={1.5} />
          <span>{syncing ? 'Syncing…' : 'Sync now'}</span>
        </button>
        <label className="dash-control dash-auto-label">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          Live {intervalSec}s
        </label>
        <select
          className="dash-control dash-control-sm"
          value={intervalSec}
          onChange={(e) => setIntervalSec(Number(e.target.value))}
          aria-label="Live refresh interval"
        >
          <option value={15}>15s</option>
          <option value={30}>30s</option>
          <option value={60}>60s</option>
          <option value={120}>120s</option>
        </select>
        <button type="button" className="dash-control dash-btn" onClick={refresh} title="Refresh live metrics">
          <RefreshCw size={16} strokeWidth={1.5} />
          <span>Refresh metrics</span>
        </button>
        {!socket.connected && (
          <span className="dash-live-badge" title={socket.lastError || 'Live updates unavailable'}>
            Live off
          </span>
        )}
        <div className="dash-avatar" title="Signed in">
          <User size={16} strokeWidth={1.5} />
        </div>
      </div>
    </header>
  );
}
