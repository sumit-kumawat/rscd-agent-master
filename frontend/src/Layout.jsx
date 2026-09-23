import { useEffect, useState } from 'react';
import { Outlet, useLocation, useOutletContext } from 'react-router-dom';
import Sidebar from './components/ui/Sidebar';
import DashboardHeader from './components/ui/DashboardHeader';

export default function Layout() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    document.querySelector('.portal-outlet')?.scrollTo?.(0, 0);
  }, [location.pathname]);

  return (
    <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <div className="app-body dash-body">
        <DashboardHeader filter={filter} onFilterChange={setFilter} />
        <main className="app-main dash-main">
          <div className="app-content dash-content portal-outlet">
            <Outlet context={{ filter }} />
          </div>
        </main>
      </div>
    </div>
  );
}

export function useLayoutFilter() {
  return useOutletContext()?.filter ?? '';
}
