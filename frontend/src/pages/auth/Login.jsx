import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { FormField } from '../../components/ui/index.jsx';
import { homeFor } from '../../routes.jsx';
import { isEmail } from '../../utils/validators.js';
import AuthCard from './AuthCard.jsx';

export default function Login() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: location.state?.email || '', password: '' });
  const [fields, setFields] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const notice = location.state?.notice;

  useEffect(() => { document.title = 'Log in | Brightloop'; }, []);

  if (!loading && user) return <Navigate to={location.state?.from || homeFor(user.role)} replace />;

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    const errs = {};
    if (!isEmail(form.email)) errs.email = 'Enter a valid email address';
    if (!form.password) errs.password = 'Password is required';
    setFields(errs);
    setError('');
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const u = await login(form.email.trim(), form.password);
      const from = location.state?.from;
      navigate(from && from !== '/login' ? from : homeFor(u.role), { replace: true });
    } catch (err) {
      setError(err.message);
      setFields(err.fields || {});
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Log in to manage subscriptions, invoices and payments."
      footer={<>New customer? <Link to="/signup">Create an account</Link></>}
    >
      <form className="stack" onSubmit={onSubmit} noValidate>
        {notice && <div className="alert alert-success">{notice}</div>}
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <FormField label="Email" error={fields.email}>
          <input type="email" autoComplete="email" autoFocus value={form.email} onChange={set('email')} />
        </FormField>
        <FormField label="Password" error={fields.password}>
          <input type="password" autoComplete="current-password" value={form.password} onChange={set('password')} />
        </FormField>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Link to="/forgot-password" style={{ fontSize: 13 }}>Forgot password?</Link>
        </div>
        <button type="submit" className="btn primary" disabled={busy} style={{ justifyContent: 'center' }}>
          {busy ? 'Logging in...' : 'Log in'}
        </button>
      </form>
    </AuthCard>
  );
}
