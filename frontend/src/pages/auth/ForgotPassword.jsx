import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { FormField } from '../../components/ui/index.jsx';
import { isEmail } from '../../utils/validators.js';
import AuthCard from './AuthCard.jsx';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { document.title = 'Forgot password | Brightloop'; }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (!isEmail(email)) { setFieldError('Enter a valid email address'); return; }
    setFieldError('');
    setBusy(true);
    try {
      setResult(await api.post('/auth/forgot-password', { email: email.trim() }));
    } catch (err) {
      setError(err.message);
      setFieldError(err.fields?.email || '');
    } finally {
      setBusy(false);
    }
  }

  // The dev link points at APP_URL; keep the user on this origin by using only path + query.
  let devLink = null;
  if (result?.devResetUrl) {
    try {
      const u = new URL(result.devResetUrl);
      devLink = `${u.pathname}${u.search}`;
    } catch { devLink = result.devResetUrl; }
  }

  return (
    <AuthCard
      title="Forgot your password?"
      subtitle="Enter your account email and we will send you a link to reset it."
      footer={<Link to="/login">Back to log in</Link>}
    >
      {result ? (
        <div className="stack">
          <div className="alert alert-success">{result.message}</div>
          <p className="muted" style={{ margin: 0 }}>The link is valid for 1 hour and can be used once.</p>
          {devLink && (
            <div className="alert alert-info">
              <strong>Demo mode:</strong> no mail server is configured, so here is the reset link:{' '}
              <Link to={devLink}>Reset my password</Link>
            </div>
          )}
          <button type="button" className="btn ghost" onClick={() => setResult(null)}>Send another link</button>
        </div>
      ) : (
        <form className="stack" onSubmit={onSubmit} noValidate>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <FormField label="Email" error={fieldError}>
            <input type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </FormField>
          <button type="submit" className="btn primary" disabled={busy} style={{ justifyContent: 'center' }}>
            {busy ? 'Sending...' : 'Send reset link'}
          </button>
        </form>
      )}
    </AuthCard>
  );
}
