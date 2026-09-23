import { RefreshCw, CloudDownload } from 'lucide-react';
import GlobalSearch from '../GlobalSearch';
import { useRefresh } from '../../context/RefreshContext';
import { useSync } from '../../context/SyncContext';

export default function DashboardHeader({ filter, onFilterChange }) {
  const { refresh, intervalSec, setIntervalSec } = useRefresh();
  const { syncNow, syncing, lastSyncAt, syncProgress } = useSync();

  let syncLabel = 'Sync now';
  if (syncing) {
    syncLabel = syncProgress?.total
      ? `Syncing ${syncProgress.completed}/${syncProgress.total}…`
      : 'Syncing…';
  }

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
          <span>{syncLabel}</span>
        </button>
        <select
          className="dash-control"
          value={intervalSec}
          onChange={(e) => setIntervalSec(Number(e.target.value))}
          aria-label="Auto refresh interval"
        >
          <option value={15}>Auto 15s</option>
          <option value={30}>Auto 30s</option>
          <option value={60}>Auto 60s</option>
          <option value={120}>Auto 120s</option>
        </select>
        <button type="button" className="dash-control dash-btn" onClick={refresh} title="Refresh now">
          <RefreshCw size={16} strokeWidth={1.5} />
          <span>Refresh</span>
        </button>
      </div>
    </header>
  );
}
