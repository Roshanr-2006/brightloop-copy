// Sidebar menu built from routes.jsx, filtered by the user's role (owner: Merryl, starter version).
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { appRoutes, REQUIRE_LOGIN } from '../../routes.jsx';

export default function Sidebar({ open, onNavigate }) {
  const { user } = useAuth();
  const visible = appRoutes.filter((r) => !REQUIRE_LOGIN || (user && r.roles.includes(user.role)));

  const sections = [];
  for (const r of visible) {
    let section = sections.find((s) => s.name === r.section);
    if (!section) {
      section = { name: r.section, items: [] };
      sections.push(section);
    }
    section.items.push(r);
  }

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Main navigation">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">B</span>
        <span>Brightloop</span>
      </div>
      <nav>
        {sections.map((s) => (
          <div key={s.name} className="nav-section">
            <div className="nav-heading">{s.name}</div>
            {s.items.map((r) => (
              <NavLink key={r.path} to={r.path} end={r.path === '/'} onClick={onNavigate} className="nav-link">
                {r.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
