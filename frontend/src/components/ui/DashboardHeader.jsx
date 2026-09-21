import { RefreshCw } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import GlobalSearch from '../GlobalSearch';
import { useRefresh } from '../../context/RefreshContext';

export default function DashboardHeader({ filter, onFilterChange }) {
  const { refresh, autoRefresh, setAutoRefresh, intervalSec, setIntervalSec } = useRefresh();
  const nav = useNavigate();
  const location = useLocation();
  const isDashboard = location.pathname === '/' || location.pathname === '/dashboard';

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
        <div className="dash-view-toggle" role="group" aria-label="View">
          <button
            type="button"
            className={`dash-pill ${isDashboard ? 'active' : ''}`}
            onClick={() => nav('/')}
          >
            Dashboard
          </button>
          <button
            type="button"
            className={`dash-pill ${location.pathname.startsWith('/vms') ? 'active' : ''}`}
            onClick={() => nav('/vms')}
          >
            Endpoints
          </button>
        </div>
        <label className="dash-control dash-auto-label">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          Auto {intervalSec}s
        </label>
        <select
          className="dash-control dash-control-sm"
          value={intervalSec}
          onChange={(e) => setIntervalSec(Number(e.target.value))}
          aria-label="Refresh interval"
        >
          <option value={15}>15s</option>
          <option value={30}>30s</option>
          <option value={60}>60s</option>
          <option value={120}>120s</option>
        </select>
        <button type="button" className="dash-control dash-btn" onClick={refresh} title="Refresh metrics">
          <RefreshCw size={14} />
          <span>Refresh</span>
        </button>
        <div className="dash-avatar" title="Portal operator">PO</div>
      </div>
    </header>
  );
}
