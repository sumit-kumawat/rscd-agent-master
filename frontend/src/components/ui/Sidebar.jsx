import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, Server, Briefcase, ScrollText, ChevronLeft, ChevronRight } from 'lucide-react';
import Logo from '../../Logo';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/vms', label: 'Assets', icon: Server },
  { to: '/jobs', label: 'Jobs', icon: Briefcase },
  { to: '/logs', label: 'Audit Log', icon: ScrollText },
];

export default function Sidebar({ collapsed, onToggle, onRefresh }) {
  const location = useLocation();
  const [version, setVersion] = useState('');
  useEffect(() => {
    fetch('/health').then((r) => r.json()).then((r) => setVersion(r.version || '')).catch(() => {});
  }, []);

  return (
    <aside className={`dash-sidebar ${collapsed ? 'collapsed' : ''}`}>
      <button type="button" className="sidebar-brand sidebar-brand-logo-only" onClick={onRefresh} title="Refresh data">
        <Logo height={collapsed ? 26 : 32} />
      </button>
      <nav className="sidebar-nav" aria-label="Main navigation">
        {navItems.map(({ to, label, icon: Icon, end }) => {
          const active = end
            ? location.pathname === to
            : location.pathname === to || location.pathname.startsWith(`${to}/`);
          return (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={`sidebar-link${active ? ' active' : ''}`}
              title={collapsed ? label : undefined}
            >
              <Icon size={20} strokeWidth={1.5} />
              {!collapsed && <span>{label}</span>}
            </NavLink>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        {!collapsed && version && <div className="sidebar-version">v{version}</div>}
        <button type="button" className="sidebar-collapse-btn" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <ChevronRight size={16} strokeWidth={1.5} /> : <ChevronLeft size={16} strokeWidth={1.5} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
