// Premium Brightloop shell with compact workspace nav and responsive content area.
import { useEffect, useRef, useState } from 'react';
import { Outlet, matchPath, useLocation, useNavigate } from 'react-router-dom';
import { ChevronRight, Command, Menu, Search } from 'lucide-react';
import Sidebar from './Sidebar.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { appRoutes } from '../../routes.jsx';

export default function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef(null);
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const current = appRoutes.find((r) => r.path === location.pathname)
    || appRoutes.find((r) => matchPath(r.path, location.pathname));
  const title = current?.label || 'Brightloop';

  const submitSearch = (event) => {
    event.preventDefault();
    const term = search.trim();
    if (!term) return;
    navigate(`/subscriptions?search=${encodeURIComponent(term)}`);
    setSearch('');
  };

  useEffect(() => {
    const onShortcut = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, []);

  return (
    <div className="app">
      <Sidebar open={menuOpen} onNavigate={() => setMenuOpen(false)} />
      {menuOpen && <button type="button" className="backdrop" onClick={() => setMenuOpen(false)} aria-label="Close navigation" />}
      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn menu-btn"
            aria-label="Open menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Menu size={19} />
          </button>
          <div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14} /><strong>{title}</strong></div>

          <form className="global-search" role="search" onSubmit={submitSearch}>
            <Search size={16} aria-hidden="true" />
            <input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search subscriptions..." aria-label="Search subscriptions" />
            <kbd><Command size={11} /> K</kbd>
          </form>

          <div className="topbar-right">
            <span className="topbar-date">{new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: '2-digit', month: 'short' }).format(new Date())}</span>
            <div className="topbar-profile" title={`${user?.name || ''} · ${user?.role || ''}`}>
              <span className="user-avatar small">{(user?.name || 'B').split(/\\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>
              <span className="topbar-profile-copy"><strong>{user?.name?.split(' ')[0] || 'Account'}</strong><small>{user?.role || ''}</small></span>
            </div>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
