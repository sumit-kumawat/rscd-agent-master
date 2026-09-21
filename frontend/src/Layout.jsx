import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './components/ui/Sidebar';
import DashboardHeader from './components/ui/DashboardHeader';
import DashboardPage from './DashboardPage';
import { useRefresh } from './context/RefreshContext';
import { useLocation } from 'react-router-dom';

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);
  const [filter, setFilter] = useState('');
  const { refresh } = useRefresh();
  const location = useLocation();
  const isDashboard = location.pathname === '/' || location.pathname === '/dashboard';

  const handleRefresh = () => refresh();

  return (
    <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} onRefresh={handleRefresh} />
      <div className="app-body dash-body">
        <DashboardHeader filter={filter} onFilterChange={setFilter} />
        <main className="app-main dash-main">
          <div className="app-content dash-content">
            {isDashboard ? <DashboardPage filter={filter} /> : <Outlet />}
          </div>
        </main>
      </div>
    </div>
  );
}
