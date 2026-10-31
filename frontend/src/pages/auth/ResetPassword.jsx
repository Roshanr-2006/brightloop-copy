import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { FormField } from '../../components/ui/index.jsx';
import { passwordIssues } from '../../utils/validators.js';
import AuthCard, { PasswordChecklist } from './AuthCard.jsx';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [fields, setFields] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { document.title = 'Reset password | Brightloop'; }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    const errs = {};
    if (passwordIssues(form.password).length) errs.password = 'Password does not meet all the rules below';
    if (form.confirm !== form.password) errs.confirm = 'Passwords do not match';
    setFields(errs);
    setError('');
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const res = await api.post('/auth/reset-password', { token, password: form.password });
      navigate('/login', { replace: true, state: { notice: res.message } });
    } catch (err) {
      setError(err.message);
      setFields(err.fields || {});
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <AuthCard title="Reset password" footer={<Link to="/login">Back to log in</Link>}>
        <div className="alert alert-error">This reset link is incomplete. Please open the link from your email again.</div>
        <p><Link to="/forgot-password">Request a new reset link</Link></p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Choose a new password"
      subtitle="Pick a strong password you have not used here before."
      footer={<Link to="/login">Back to log in</Link>}
    >
      <form className="stack" onSubmit={onSubmit} noValidate>
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
            {fields.token && <> <Link to="/forgot-password">Request a new link</Link></>}
          </div>
        )}
        <FormField label="New password" required error={fields.password}>
          <input type="password" autoComplete="new-password" autoFocus value={form.password} onChange={set('password')} />
          <PasswordChecklist password={form.password} />
        </FormField>
        <FormField label="Confirm new password" required error={fields.confirm || (form.confirm && form.confirm !== form.password ? 'Passwords do not match' : '')}>
          <input type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />
        </FormField>
        <button type="submit" className="btn primary" disabled={busy} style={{ justifyContent: 'center' }}>
          {busy ? 'Saving...' : 'Reset password'}
        </button>
      </form>
    </AuthCard>
  );
}
