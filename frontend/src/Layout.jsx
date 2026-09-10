import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Server, Briefcase, ScrollText } from 'lucide-react';
import Logo from './Logo';
import GlobalSearch from './components/GlobalSearch';
import api from './api';
import { onSocket } from './socket';
import { useRefresh } from './context/RefreshContext';

const navItems = [
  { to: '/vms', label: 'VMs', icon: Server },
  { to: '/jobs', label: 'Jobs', icon: Briefcase },
  { to: '/logs', label: 'Logs', icon: ScrollText },
];

function HeaderStats({ stats }) {
  const items = [
    { label: 'Total', value: stats.total || 0 },
    { label: 'Online', value: stats.online || 0, tone: 'success' },
    { label: 'Offline', value: stats.offline || 0, tone: 'danger' },
    { label: 'Active', value: stats.active || 0, tone: 'danger' },
    { label: 'Removed', value: stats.removed || 0, tone: 'success' },
  ];
  return (
    <div className="header-stats" aria-label="Fleet statistics">
      {items.map(({ label, value, tone }) => (
        <div key={label} className={`header-stat ${tone || ''}`}>
          <span className="header-stat-label">{label}</span>
          <span className="header-stat-value">{value}</span>
        </div>
      ))}
    </div>
  );
}

export default function Layout() {
  const { refresh } = useRefresh();
  const location = useLocation();
  const [stats, setStats] = useState({});

  const loadStats = useCallback(() => {
    api.get('/vms/stats').then((r) => setStats(r.stats || {})).catch(() => {});
  }, []);

  useEffect(() => { loadStats(); }, [loadStats, location.pathname]);
  useEffect(() => onSocket('vm:status', loadStats), [loadStats]);
  useEffect(() => onSocket('monitor:cycle', loadStats), [loadStats]);
  useEffect(() => onSocket('vms:deleted', loadStats), [loadStats]);

  const handleRefresh = () => {
    refresh();
    loadStats();
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button type="button" className="sidebar-brand" onClick={handleRefresh} title="Refresh">
          <Logo height={30} />
        </button>
        <nav className="sidebar-nav">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
            >
              <Icon size={18} strokeWidth={2} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <a
            href="https://www.sumitkumawat.com"
            target="_blank"
            rel="noopener noreferrer"
            className="sidebar-credit"
          >
            Developed by Sumit Kumawat
          </a>
        </div>
      </aside>

      <div className="app-body">
        <header className="app-header">
          <button type="button" className="header-brand" onClick={handleRefresh} title="Refresh">
            <div>
              <div className="brand-title">RSCD Manager</div>
              <div className="brand-sub">Agent Control Portal</div>
            </div>
          </button>

          <div className="header-search-slot">
            <GlobalSearch />
          </div>

          <HeaderStats stats={stats} />
        </header>

        <main className="app-main">
          <div className="app-content">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
