import { useEffect, useState } from 'react';
import { Outlet, useLocation, useOutletContext } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import Sidebar from './components/ui/Sidebar';
import DashboardHeader from './components/ui/DashboardHeader';
import { useSync } from './context/SyncContext';

export default function Layout() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [filter, setFilter] = useState('');
  const { syncing, syncProgress } = useSync();

  useEffect(() => {
    document.querySelector('.portal-outlet')?.scrollTo?.(0, 0);
  }, [location.pathname]);

  return (
    <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <div className="app-body dash-body">
        <DashboardHeader filter={filter} onFilterChange={setFilter} />
        <div className={`sync-banner-slot${syncing ? ' is-active' : ''}`} aria-hidden={!syncing}>
          {syncing ? (
            <div className="sync-banner" role="status">
              <Loader2 size={14} strokeWidth={1.5} className="spin" />
              <span>
                Background sync in progress
                {syncProgress?.total
                  ? ` — ${syncProgress.completed}/${syncProgress.total} endpoints`
                  : ''}
              </span>
            </div>
          ) : null}
        </div>
        <main className="app-main dash-main">
          <div className="app-content dash-content portal-outlet">
            <Outlet key={location.pathname} context={{ filter }} />
          </div>
        </main>
      </div>
    </div>
  );
}

export function useLayoutFilter() {
  return useOutletContext()?.filter ?? '';
}
