import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { FormField } from '../../components/ui/index.jsx';
import { homeFor } from '../../routes.jsx';
import { isEmail, passwordIssues } from '../../utils/validators.js';
import AuthCard, { PasswordChecklist } from './AuthCard.jsx';

export default function Signup() {
  const { user, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [fields, setFields] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { document.title = 'Sign up | Brightloop'; }, []);

  if (!loading && user) return <Navigate to={homeFor(user.role)} replace />;

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  function check() {
    const errs = {};
    if (form.name.trim().length < 2) errs.name = 'Please enter your full name';
    if (!isEmail(form.email)) errs.email = 'Enter a valid email address';
    const issues = passwordIssues(form.password);
    if (issues.length) errs.password = 'Password does not meet all the rules below';
    if (!form.confirm) errs.confirm = 'Please confirm your password';
    else if (form.confirm !== form.password) errs.confirm = 'Passwords do not match';
    return errs;
  }

  async function onSubmit(e) {
    e.preventDefault();
    const errs = check();
    setFields(errs);
    setError('');
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const { user: created } = await api.post('/auth/signup', {
        name: form.name.trim(), email: form.email.trim(), password: form.password,
      });
      await refresh();
      navigate(homeFor(created.role), { replace: true });
    } catch (err) {
      setError(err.message);
      setFields(err.fields || {});
      setBusy(false);
    }
  }

  const mismatch = form.confirm && form.confirm !== form.password;

  return (
    <AuthCard
      title="Create your account"
      subtitle="Sign up to view your subscriptions and invoices online."
      footer={<>Already have an account? <Link to="/login">Log in</Link></>}
    >
      <form className="stack" onSubmit={onSubmit} noValidate>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <FormField label="Full name" required error={fields.name}>
          <input autoComplete="name" autoFocus value={form.name} onChange={set('name')} />
        </FormField>
        <FormField label="Email" required error={fields.email}>
          <input type="email" autoComplete="email" value={form.email} onChange={set('email')} />
        </FormField>
        <FormField label="Password" required error={fields.password}>
          <input type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />
          <PasswordChecklist password={form.password} />
        </FormField>
        <FormField label="Confirm password" required error={fields.confirm || (mismatch ? 'Passwords do not match' : '')}>
          <input type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />
        </FormField>
        <button type="submit" className="btn primary" disabled={busy} style={{ justifyContent: 'center' }}>
          {busy ? 'Creating account...' : 'Sign up'}
        </button>
      </form>
    </AuthCard>
  );
}
