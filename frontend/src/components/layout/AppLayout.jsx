// App shell: sidebar + top bar + page content (owner: Merryl, starter version).
import { useState } from 'react';
import { Outlet, matchPath, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { appRoutes } from '../../routes.jsx';

export default function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { user, logout } = useAuth();
  const location = useLocation();
  const current = appRoutes.find((r) => r.path === location.pathname)
    || appRoutes.find((r) => matchPath(r.path, location.pathname));

  return (
    <div className="app">
      <Sidebar open={menuOpen} onNavigate={() => setMenuOpen(false)} />
      {menuOpen && <div className="backdrop" onClick={() => setMenuOpen(false)} aria-hidden="true" />}
      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn menu-btn"
            aria-label="Open menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            &#9776;
          </button>
          <h1 className="page-title">{current?.label || 'Brightloop'}</h1>
          <div className="topbar-right">
            {user ? (
              <>
                <span className="muted">{user.name} &middot; {user.role}</span>
                <button type="button" className="btn ghost" onClick={logout}>Log out</button>
              </>
            ) : (
              <span className="muted">Not logged in</span>
            )}
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
