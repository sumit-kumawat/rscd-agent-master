import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Server, Briefcase, ScrollText, ChevronLeft, ChevronRight } from 'lucide-react';
import Logo from '../../Logo';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/vms', label: 'Assets', icon: Server },
  { to: '/jobs', label: 'Jobs', icon: Briefcase },
  { to: '/logs', label: 'Audit Log', icon: ScrollText },
];

function isNavActive(pathname, to, end) {
  if (end) return pathname === to;
  return pathname === to || pathname.startsWith(`${to}/`);
}

export default function Sidebar({ collapsed, onToggle }) {
  const location = useLocation();
  const [version, setVersion] = useState('');

  useEffect(() => {
    fetch('/health').then((r) => r.json()).then((r) => setVersion(r.version || '')).catch(() => {});
  }, []);

  return (
    <aside className={`dash-sidebar ${collapsed ? 'collapsed' : ''}`}>
      <Link to="/dashboard" className="sidebar-brand" title="Dashboard">
        <Logo height={collapsed ? 26 : 28} />
        {!collapsed && version && (
          <span className="sidebar-version-badge">
            v{version}
          </span>
        )}
      </Link>
      <nav className="sidebar-nav" aria-label="Main navigation">
        {navItems.map(({ to, label, icon: Icon, end }) => {
          const active = isNavActive(location.pathname, to, end);
          return (
            <Link
              key={to}
              to={to}
              className={`sidebar-link${active ? ' active' : ''}`}
              aria-current={active ? 'page' : undefined}
              title={collapsed ? label : undefined}
            >
              <Icon size={20} strokeWidth={1.5} />
              {!collapsed && <span>{label}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        <button type="button" className="sidebar-collapse-btn" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <ChevronRight size={16} strokeWidth={1.5} /> : <ChevronLeft size={16} strokeWidth={1.5} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
