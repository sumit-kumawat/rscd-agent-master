import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Server, Briefcase, ScrollText, ChevronLeft, ChevronRight } from 'lucide-react';
import Logo from '../../Logo';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/vms', label: 'Endpoints', icon: Server },
  { to: '/jobs', label: 'Jobs', icon: Briefcase },
  { to: '/logs', label: 'Audit Log', icon: ScrollText },
];

export default function Sidebar({ collapsed, onToggle, onRefresh }) {
  return (
    <aside className={`dash-sidebar ${collapsed ? 'collapsed' : ''}`}>
      <button type="button" className="sidebar-brand" onClick={onRefresh} title="Refresh metrics">
        <Logo height={collapsed ? 24 : 30} />
        {!collapsed && <span className="sidebar-brand-text">RSCD Manager</span>}
      </button>
      <nav className="sidebar-nav">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
            title={collapsed ? label : undefined}
          >
            <Icon size={20} strokeWidth={1.5} />
            {!collapsed && <span>{label}</span>}
          </NavLink>
        ))}
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
