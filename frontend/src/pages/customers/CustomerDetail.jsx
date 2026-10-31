import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  Card, ConfirmDialog, DataTable, EmptyState, ErrorBanner, FormField, Modal, PageHeader, Spinner, StatCard, StatusBadge, useToast,
} from '../../components/ui/index.jsx';
import { formatDate, formatMoney } from '../../utils/format.js';
import { passwordIssues } from '../../utils/validators.js';
import { PasswordChecklist } from '../auth/AuthCard.jsx';
import CustomerFormModal from './CustomerFormModal.jsx';

function PortalAccessModal({ open, customer, onClose, onDone }) {
  const toast = useToast();
  const [mode, setMode] = useState('invite');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => { if (open) { setMode('invite'); setPassword(''); setError(''); setResult(null); } }, [open]);

  async function submit() {
    if (mode === 'password' && passwordIssues(password).length) { setError('Password does not meet all the rules'); return; }
    setBusy(true);
    setError('');
    try {
      const res = await api.post(`/customers/${customer.id}/portal-access`, mode === 'password' ? { password } : {});
      toast.success(res.message);
      setResult(res);
      onDone();
    } catch (err) {
      setError(err.fields?.password || err.fields?.email || err.message);
    } finally {
      setBusy(false);
    }
  }

  let devLink = null;
  if (result?.devInviteUrl) {
    try { const u = new URL(result.devInviteUrl); devLink = `${u.pathname}${u.search}`; } catch { devLink = result.devInviteUrl; }
  }

  return (
    <Modal
      open={open}
      title="Give portal access"
      onClose={onClose}
      footer={result ? <button type="button" className="btn primary" onClick={onClose}>Done</button> : (
        <>
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn primary" onClick={submit} disabled={busy}>{busy ? 'Working...' : 'Create login'}</button>
        </>
      )}
    >
      {result ? (
        <div className="stack">
          <div className="alert alert-success">{result.message}</div>
          {devLink && (
            <div className="alert alert-info">
              Demo mode (no mail server): the invitation link is <a href={devLink} target="_blank" rel="noreferrer">{devLink.slice(0, 40)}...</a>
              {' '}Open it in a private window to set the customer password.
            </div>
          )}
        </div>
      ) : (
        <div className="stack">
          <p style={{ margin: 0 }}>
            {customer?.name} will log in with <strong>{customer?.email}</strong> and see only their own subscriptions, invoices and payments.
          </p>
          {error && <div className="alert alert-error">{error}</div>}
          <label className="field checkbox">
            <input type="radio" name="mode" checked={mode === 'invite'} onChange={() => setMode('invite')} />
            <span>Email an invitation link so they choose their own password (recommended)</span>
          </label>
          <label className="field checkbox">
            <input type="radio" name="mode" checked={mode === 'password'} onChange={() => setMode('password')} />
            <span>Set a password now</span>
          </label>
          {mode === 'password' && (
            <FormField label="Password">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              <PasswordChecklist password={password} />
            </FormField>
          )}
        </div>
      )}
    </Modal>
  );
}

export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { hasRole } = useAuth();
  const [customer, setCustomer] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [granting, setGranting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get(`/customers/${id}`).then((c) => { setCustomer(c); setError(null); }).catch(setError);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function remove() {
    setBusy(true);
    try {
      await api.delete(`/customers/${id}`);
      toast.success('Customer deleted');
      navigate('/customers', { replace: true });
    } catch (err) {
      toast.error(err.message);
      setDeleting(false);
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="stack">
        <ErrorBanner error={error.status === 404 ? 'This customer does not exist or was deleted.' : error} />
        <Link to="/customers">Back to customers</Link>
      </div>
    );
  }
  if (!customer) return <Spinner />;

  const t = customer.totals;
  const address = [customer.billing_address, customer.city, customer.state, customer.country].filter(Boolean).join(', ');
  const canDelete = t.subscriptions === 0 && t.invoices === 0;

  const subColumns = [
    { key: 'number', label: 'Number', render: (s) => <Link to={`/subscriptions/${s.id}`} onClick={(e) => e.stopPropagation()}>{s.number}</Link> },
    { key: 'plan_name', label: 'Plan' },
    { key: 'status', label: 'Status', render: (s) => <StatusBadge status={s.status} /> },
    { key: 'start_date', label: 'Start', render: (s) => formatDate(s.start_date) },
    { key: 'next_invoice_date', label: 'Next invoice', render: (s) => (['active'].includes(s.status) ? formatDate(s.next_invoice_date) : '-') },
    { key: 'recurring_amount', label: 'Recurring', align: 'right', render: (s) => formatMoney(s.recurring_amount) },
  ];
  const invColumns = [
    { key: 'number', label: 'Number', render: (i) => <Link to={`/invoices/${i.id}`} onClick={(e) => e.stopPropagation()}>{i.number}</Link> },
    { key: 'invoice_date', label: 'Date', render: (i) => formatDate(i.invoice_date) },
    { key: 'due_date', label: 'Due', render: (i) => formatDate(i.due_date) },
    { key: 'status', label: 'Status', render: (i) => <StatusBadge status={i.is_overdue ? 'overdue' : i.status} /> },
    { key: 'total_amount', label: 'Total', align: 'right', render: (i) => formatMoney(i.total_amount) },
    { key: 'balance_due', label: 'Balance', align: 'right', render: (i) => (i.status === 'confirmed' ? formatMoney(i.balance_due) : '-') },
  ];

  return (
    <div className="stack">
      <div className="no-print"><Link to="/customers">&larr; Customers</Link></div>
      <PageHeader
        title={customer.name}
        subtitle={[customer.company_name, customer.email].filter(Boolean).join(' \u00b7 ')}
        actions={(
          <>
            <Link className="btn primary" to={`/subscriptions/new?customer=${customer.id}`}>+ New subscription</Link>
            {!customer.has_portal_access && (
              <button type="button" className="btn ghost" onClick={() => setGranting(true)}>Give portal access</button>
            )}
            <button type="button" className="btn ghost" onClick={() => setEditing(true)}>Edit</button>
            {canDelete && hasRole('admin', 'staff') && (
              <button type="button" className="btn danger" onClick={() => setDeleting(true)}>Delete</button>
            )}
          </>
        )}
      />

      <div className="grid-4">
        <StatCard label="Active subscriptions" value={t.active_subscriptions} hint={`${t.subscriptions} in total`} />
        <StatCard label="Recurring amount" value={formatMoney(t.recurring_amount)} hint="Active subscriptions, before tax" />
        <StatCard label="Outstanding" value={formatMoney(t.outstanding)} tone={t.outstanding > 0 ? 'warning' : undefined} hint={`${formatMoney(t.paid)} paid so far`} />
        <StatCard label="Overdue" value={formatMoney(t.overdue)} tone={t.overdue > 0 ? 'danger' : 'success'} />
      </div>

      <div className="grid-2">
        <Card title="Contact details">
          <dl className="dl">
            <dt>Email</dt><dd>{customer.email}</dd>
            <dt>Phone</dt><dd>{customer.phone || '-'}</dd>
            <dt>Company</dt><dd>{customer.company_name || '-'}</dd>
            <dt>Address</dt><dd>{address || '-'}</dd>
            <dt>Tax ID</dt><dd>{customer.tax_id || '-'}</dd>
            <dt>Customer since</dt><dd>{formatDate(customer.created_at)}</dd>
          </dl>
        </Card>
        <Card title="Portal access">
          {customer.has_portal_access ? (
            <dl className="dl">
              <dt>Status</dt><dd><StatusBadge status={customer.portal_user?.is_active ? 'active' : 'inactive'} label={customer.portal_user?.is_active ? 'Enabled' : 'Disabled'} /></dd>
              <dt>Login</dt><dd>{customer.email}</dd>
              <dt>Last login</dt><dd>{customer.portal_user?.last_login_at ? formatDate(customer.portal_user.last_login_at) : 'Never'}</dd>
            </dl>
          ) : (
            <EmptyState
              title="No portal login yet"
              message="Give access so the customer can see their subscriptions and invoices online."
              action={<button type="button" className="btn primary sm" onClick={() => setGranting(true)}>Give portal access</button>}
            />
          )}
        </Card>
      </div>

      <Card title={`Subscriptions (${t.subscriptions})`} actions={<Link className="btn ghost sm" to={`/subscriptions/new?customer=${customer.id}`}>New subscription</Link>}>
        <DataTable columns={subColumns} rows={customer.subscriptions} empty="No subscriptions yet" onRowClick={(s) => navigate(`/subscriptions/${s.id}`)} />
      </Card>

      <Card title={`Invoices (${t.invoices})`}>
        <DataTable columns={invColumns} rows={customer.invoices} empty="No invoices yet" onRowClick={(i) => navigate(`/invoices/${i.id}`)} />
      </Card>

      <CustomerFormModal open={editing} customer={customer} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />
      <PortalAccessModal open={granting} customer={customer} onClose={() => setGranting(false)} onDone={load} />
      <ConfirmDialog
        open={deleting}
        title="Delete customer"
        message={`Delete ${customer.name}? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(false)}
      />
    </div>
  );
}
