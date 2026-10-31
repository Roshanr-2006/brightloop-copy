// Shared frame for the public auth pages: centered card with the Brightloop brand.
import { PASSWORD_RULES } from '../../utils/validators.js';

export default function AuthCard({ title, subtitle, children, footer }) {
  return (
    <div className="auth-shell" style={{ background: 'linear-gradient(160deg, var(--brand-light) 0%, var(--bg) 55%)' }}>
      <div className="card" style={{ padding: '28px 28px 24px' }}>
        <div className="row" style={{ gap: 10, marginBottom: 18 }}>
          <span className="brand-mark" aria-hidden="true" style={{ color: '#fff', fontWeight: 700 }}>B</span>
          <span style={{ fontWeight: 700, fontSize: 18, color: 'var(--brand)' }}>Brightloop</span>
        </div>
        <h2 style={{ marginBottom: 2 }}>{title}</h2>
        {subtitle && <p className="muted" style={{ marginTop: 0, marginBottom: 18 }}>{subtitle}</p>}
        {children}
        {footer && <div className="muted center" style={{ marginTop: 18 }}>{footer}</div>}
      </div>
    </div>
  );
}

/** Live checklist of the password rules. */
export function PasswordChecklist({ password }) {
  return (
    <ul aria-label="Password rules" style={{ listStyle: 'none', padding: 0, margin: '2px 0 0', fontSize: 12.5 }}>
      {PASSWORD_RULES.map((r) => {
        const ok = r.test(password || '');
        return (
          <li key={r.key} style={{ color: ok ? 'var(--success)' : 'var(--muted)', display: 'flex', gap: 6 }}>
            <span aria-hidden="true" style={{ width: 14 }}>{ok ? '\u2713' : '\u2022'}</span>
            <span>{r.label}</span>
            <span className="sr-only" style={{ position: 'absolute', left: -9999 }}>{ok ? '(met)' : '(not met)'}</span>
          </li>
        );
      })}
    </ul>
  );
}
