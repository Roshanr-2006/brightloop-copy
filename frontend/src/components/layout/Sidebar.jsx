// Role-filtered application navigation styled around the shadcn sidebar pattern.
import { NavLink } from 'react-router-dom';
import {
  Activity, ArrowDownLeft, BarChart3, Boxes, BriefcaseBusiness, Building2, CreditCard,
  FileClock, FileText, Gauge, LayoutDashboard, LayoutGrid, LifeBuoy, LogOut, Package, ReceiptText,
  Settings2, ShieldCheck, Sparkles, Tag, Users, WalletCards,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { appRoutes, REQUIRE_LOGIN } from '../../routes.jsx';

const ICONS = {
  '/': LayoutDashboard,
  '/reports': BarChart3,
  '/subscriptions': Activity,
  '/invoices': ReceiptText,
  '/billing': FileClock,
  '/payments': WalletCards,
  '/customers': Building2,
  '/catalog/products': Package,
  '/catalog/plans': Boxes,
  '/catalog/templates': FileText,
  '/catalog/discounts': Tag,
  '/catalog/taxes': ArrowDownLeft,
  '/catalog/payment-terms': CreditCard,
  '/admin': LayoutGrid,
  '/admin/staff': ShieldCheck,
  '/portal/subscriptions': Activity,
  '/portal/invoices': ReceiptText,
  '/portal/profile': Settings2,
};

const SECTION_ICONS = {
  Overview: Gauge,
  Sales: BriefcaseBusiness,
  Configuration: Settings2,
  Administration: ShieldCheck,
  'My account': Users,
};

export default function Sidebar({ open, onNavigate }) {
  const { user, logout } = useAuth();
  const visible = appRoutes
    .filter((r) => !r.hidden)
    .filter((r) => !REQUIRE_LOGIN || (user && r.roles.includes(user.role)));

  const sections = [];
  for (const route of visible) {
    let section = sections.find((item) => item.name === route.section);
    if (!section) {
      section = { name: route.section, items: [] };
      sections.push(section);
    }
    section.items.push(route);
  }

  const initials = (user?.name || 'Brightloop').split(/\\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Main navigation">
      <NavLink to="/" className="brand" onClick={onNavigate} aria-label="Brightloop home">
        <span className="brand-mark" aria-hidden="true"><Sparkles size={17} strokeWidth={2.2} /></span>
        <span className="brand-copy"><strong>brightloop</strong><small>SUBSCRIPTION CLOUD</small></span>
      </NavLink>

      <div className="sidebar-workspace">
        <div className="workspace-mark"><Building2 size={16} /></div>
        <div className="workspace-copy"><strong>Brightloop Software</strong><span>Workspace</span></div>
        <span className="workspace-chevron">⌄</span>
      </div>

      <nav className="sidebar-nav">
        {sections.map((section) => {
          const SectionIcon = SECTION_ICONS[section.name] || Settings2;
          return (
            <div key={section.name} className="nav-section">
              <div className="nav-heading"><SectionIcon size={13} /><span>{section.name}</span></div>
              {section.items.map((route) => {
                const Icon = ICONS[route.path] || FileText;
                return (
                  <NavLink key={route.path} to={route.path} end={route.path === '/'} onClick={onNavigate} className="nav-link">
                    <Icon size={17} strokeWidth={1.8} />
                    <span>{route.label}</span>
                  </NavLink>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-bottom">
        <a className="sidebar-help" href="mailto:support@brightloop.example"><LifeBuoy size={16} /><span>Help & support</span></a>
        <div className="sidebar-user">
          <div className="user-avatar">{initials}</div>
          <div className="sidebar-user-copy"><strong>{user?.name || 'Brightloop user'}</strong><span>{user?.role || 'Account'}</span></div>
          <button type="button" className="sidebar-logout" aria-label="Log out" title="Log out" onClick={logout}><LogOut size={16} /></button>
        </div>
      </div>
    </aside>
  );
}
