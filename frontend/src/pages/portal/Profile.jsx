import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Card, DataTable, ErrorBanner, FormField, PageHeader, Spinner, useToast } from '../../components/ui/index.jsx';
import { capitalize, formatDate, formatMoney } from '../../utils/format.js';
import { customerErrors, passwordIssues } from '../../utils/validators.js';
import { PasswordChecklist } from '../auth/AuthCard.jsx';
import { CustomerFields, toForm } from '../customers/CustomerFormModal.jsx';

const EDITABLE = ['name', 'company_name', 'phone', 'billing_address', 'city', 'state', 'country', 'tax_id'];

function ChangePassword() {
  const toast = useToast();
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm: '' });
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const errs = {};
    if (!form.current_password) errs.current_password = 'Enter your current password';
    if (passwordIssues(form.new_password).length) errs.new_password = 'Password does not meet all the rules';
    if (form.confirm !== form.new_password) errs.confirm = 'Passwords do not match';
    setFields(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await api.post('/auth/change-password', { current_password: form.current_password, new_password: form.new_password });
      toast.success('Password changed');
      setForm({ current_password: '', new_password: '', confirm: '' });
    } catch (err) {
      setFields(err.fields || {});
      if (!err.fields) toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Change password">
      <form className="stack" onSubmit={submit} noValidate>
        <FormField label="Current password" error={fields.current_password}>
          <input type="password" autoComplete="current-password" value={form.current_password} onChange={set('current_password')} />
        </FormField>
        <FormField label="New password" error={fields.new_password}>
          <input type="password" autoComplete="new-password" value={form.new_password} onChange={set('new_password')} />
          <PasswordChecklist password={form.new_password} />
        </FormField>
        <FormField label="Confirm new password" error={fields.confirm}>
          <input type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />
        </FormField>
        <div className="form-actions">
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving...' : 'Change password'}</button>
        </div>
      </form>
    </Card>
  );
}

function RecentPayments() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get('/portal/payments', { limit: 5 }).then(setData).catch(() => setData({ items: [] })); }, []);
  const columns = [
    { key: 'payment_date', label: 'Date', render: (p) => formatDate(p.payment_date) },
    { key: 'invoice_number', label: 'Invoice' },
    { key: 'method', label: 'Method', render: (p) => capitalize(String(p.method).replace('_', ' ')) },
    { key: 'amount', label: 'Amount', align: 'right', render: (p) => formatMoney(p.amount) },
  ];
  return (
    <Card title="Recent payments" actions={data?.summary ? <span className="muted">Total paid: {formatMoney(data.summary.total_paid)}</span> : null}>
      <DataTable columns={columns} rows={data?.items} loading={!data} empty="No payments yet" />
    </Card>
  );
}

export default function Profile() {
  const toast = useToast();
  const { refresh } = useAuth();
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState(null);
  const [fields, setFields] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/portal/profile').then((p) => { setProfile(p); setForm(toForm(p)); }).catch(setError);
  }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    const errs = customerErrors(form, { requireEmail: false });
    setFields(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const body = Object.fromEntries(EDITABLE.map((k) => [k, (form[k] || '').trim()]));
      const saved = await api.put('/portal/profile', body);
      setProfile(saved);
      setForm(toForm(saved));
      toast.success('Profile saved');
      refresh();
    } catch (err) {
      setFields(err.fields || {});
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorBanner error={error} />;
  if (!form) return <Spinner />;

  return (
    <div className="stack">
      <PageHeader title="My profile" subtitle={`Customer since ${formatDate(profile.created_at)}`} />
      <Card title="Billing details">
        <form className="form-grid" onSubmit={save} noValidate>
          <CustomerFields form={form} set={set} fields={fields} emailEditable={false} />
          <div className="form-actions span-2">
            <button type="button" className="btn ghost" onClick={() => { setForm(toForm(profile)); setFields({}); }} disabled={busy}>Reset</button>
            <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving...' : 'Save changes'}</button>
          </div>
        </form>
      </Card>
      <div className="grid-2">
        <ChangePassword />
        <RecentPayments />
      </div>
    </div>
  );
}
