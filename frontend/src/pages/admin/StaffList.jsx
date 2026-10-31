import { useState } from 'react';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import useList from '../../hooks/useList.js';
import {
  ConfirmDialog, DataTable, ErrorBanner, FormField, Modal, PageHeader, Pagination, SearchInput, StatusBadge, Toolbar, useToast,
} from '../../components/ui/index.jsx';
import { formatDate } from '../../utils/format.js';
import { isEmail, passwordIssues } from '../../utils/validators.js';
import { PasswordChecklist } from '../auth/AuthCard.jsx';

const EMPTY = { name: '', email: '', password: '', role: 'staff' };

function CreateStaffModal({ open, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [fields, setFields] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  function close() {
    setForm(EMPTY); setFields({}); setError('');
    onClose();
  }

  async function save(e) {
    e?.preventDefault();
    const errs = {};
    if (form.name.trim().length < 2) errs.name = 'Name must be at least 2 characters';
    if (!isEmail(form.email)) errs.email = 'Enter a valid email address';
    if (passwordIssues(form.password).length) errs.password = 'Password does not meet all the rules';
    setFields(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setError('');
    try {
      const user = await api.post('/users', { ...form, name: form.name.trim(), email: form.email.trim() });
      toast.success(`${user.name} can now log in as ${user.role}`);
      setForm(EMPTY);
      onSaved(user);
    } catch (err) {
      setError(err.message);
      setFields(err.fields || {});
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Add staff user"
      onClose={close}
      footer={(
        <>
          <button type="button" className="btn ghost" onClick={close} disabled={busy}>Cancel</button>
          <button type="submit" form="staff-form" className="btn primary" disabled={busy}>{busy ? 'Saving...' : 'Create user'}</button>
        </>
      )}
    >
      <form id="staff-form" className="form-grid" onSubmit={save} noValidate>
        {error && <div className="alert alert-error span-2">{error}</div>}
        <FormField label="Full name" required error={fields.name}>
          <input value={form.name} onChange={set('name')} autoFocus />
        </FormField>
        <FormField label="Email" required error={fields.email}>
          <input type="email" value={form.email} onChange={set('email')} autoComplete="off" />
        </FormField>
        <FormField label="Temporary password" required error={fields.password} className="span-2">
          <input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" />
          <PasswordChecklist password={form.password} />
        </FormField>
        <FormField label="Role" error={fields.role} hint="Admins can also manage staff, discounts, taxes and plans." className="span-2">
          <select value={form.role} onChange={set('role')}>
            <option value="staff">Staff</option>
            <option value="admin">Admin</option>
          </select>
        </FormField>
      </form>
    </Modal>
  );
}

export default function StaffList() {
  const { user: me } = useAuth();
  const toast = useToast();
  const list = useList('/users', { search: '', role: '' });
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState(null); // { user, changes, title, message }
  const [busy, setBusy] = useState(false);

  async function apply() {
    setBusy(true);
    try {
      const updated = await api.patch(`/users/${pending.user.id}`, pending.changes);
      toast.success(`${updated.name} updated`);
      setPending(null);
      list.reload();
    } catch (err) {
      toast.error(err.fields ? Object.values(err.fields)[0] || err.message : err.message);
    } finally {
      setBusy(false);
    }
  }

  const askToggle = (u) => setPending({
    user: u,
    changes: { is_active: !u.is_active },
    title: u.is_active ? 'Deactivate user' : 'Activate user',
    message: u.is_active
      ? `${u.name} will no longer be able to log in. Their past work stays in the system.`
      : `${u.name} will be able to log in again.`,
    danger: u.is_active,
  });

  const askRole = (u, role) => setPending({
    user: u,
    changes: { role },
    title: 'Change role',
    message: role === 'admin'
      ? `Make ${u.name} an admin? Admins can manage staff, discounts, taxes and all configuration.`
      : `Change ${u.name} to staff? They will lose admin-only access.`,
  });

  const columns = [
    {
      key: 'name',
      label: 'Name',
      render: (u) => (
        <div>
          <div style={{ fontWeight: 600 }}>{u.name}{u.id === me?.id && <span className="muted"> (you)</span>}</div>
          <div className="muted" style={{ fontSize: 12.5 }}>{u.email}</div>
        </div>
      ),
    },
    {
      key: 'role',
      label: 'Role',
      render: (u) => (u.id === me?.id ? <StatusBadge status={u.role} /> : (
        <select
          className="input"
          style={{ width: 'auto', padding: '4px 8px' }}
          value={u.role}
          aria-label={`Role for ${u.name}`}
          onChange={(e) => askRole(u, e.target.value)}
        >
          <option value="staff">Staff</option>
          <option value="admin">Admin</option>
        </select>
      )),
    },
    { key: 'is_active', label: 'Status', render: (u) => <StatusBadge status={u.is_active ? 'active' : 'inactive'} /> },
    { key: 'last_login_at', label: 'Last login', render: (u) => (u.last_login_at ? formatDate(u.last_login_at) : <span className="muted">Never</span>) },
    { key: 'created_by_name', label: 'Added by', render: (u) => u.created_by_name || <span className="muted">-</span> },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (u) => (u.id === me?.id ? null : (
        <button type="button" className={`btn sm ${u.is_active ? 'ghost' : 'success'}`} onClick={() => askToggle(u)}>
          {u.is_active ? 'Deactivate' : 'Activate'}
        </button>
      )),
    },
  ];

  return (
    <div className="stack">
      <PageHeader
        title="Staff users"
        subtitle="Only admins can add staff. Customers get access from their customer page or by signing up."
        actions={<button type="button" className="btn primary" onClick={() => setCreating(true)}>+ Add staff</button>}
      />
      <Toolbar>
        <SearchInput value={list.params.search} onChange={(v) => list.setParam('search', v)} placeholder="Search name or email" />
        <select className="input" value={list.params.role} onChange={(e) => list.setParam('role', e.target.value)} aria-label="Filter by role">
          <option value="">Admins and staff</option>
          <option value="admin">Admins</option>
          <option value="staff">Staff</option>
        </select>
      </Toolbar>
      <ErrorBanner error={list.error} />
      <DataTable columns={columns} rows={list.data.items} loading={list.loading} empty="No users match your search" />
      <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} onChange={list.setPage} />

      <CreateStaffModal open={creating} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); list.reload(); }} />
      <ConfirmDialog
        open={Boolean(pending)}
        title={pending?.title}
        message={pending?.message}
        danger={pending?.danger}
        busy={busy}
        confirmLabel="Confirm"
        onConfirm={apply}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
