// Payment terms (owner: Roshan). Admin edits, staff reads.
import { useState } from 'react';
import { api } from '../../api/client';
import useList from '../../hooks/useList';
import {
  Card, PageHeader, DataTable, Pagination, SearchInput, ErrorBanner, Modal, FormField, ConfirmDialog, useToast,
} from '../../components/ui/index.jsx';
import { useIsAdmin, useForm, ActiveFilter, ActiveBadge, ReadOnlyNote } from './shared.jsx';

const EMPTY = { name: '', due_days: 0, is_active: true };

const dueLabel = (d) => (Number(d) === 0 ? 'Due immediately' : `Due ${d} day${Number(d) === 1 ? '' : 's'} after invoice date`);

function TermModal({ term, onClose, onSaved }) {
  const isNew = !term?.id;
  const form = useForm(term?.id ? { ...term, is_active: !!term.is_active } : EMPTY);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { values, errors } = form;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { ...values, due_days: values.due_days === '' ? null : Number(values.due_days) };
      const saved = isNew ? await api.post('/catalog/payment-terms', body) : await api.put(`/catalog/payment-terms/${term.id}`, body);
      onSaved(saved, isNew);
    } catch (err) {
      setError(err.message);
      form.setErrors(err.fields || {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={isNew ? 'New payment term' : `Edit ${term.name}`}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="term-form" className="btn primary" disabled={busy}>{busy ? 'Saving...' : 'Save term'}</button>
        </>
      )}
    >
      <form id="term-form" className="form-grid" onSubmit={submit} noValidate>
        <ErrorBanner error={error} />
        <FormField label="Name" required error={errors.name}>
          <input autoFocus {...form.bind('name')} placeholder="e.g. 30 Days" />
        </FormField>
        <FormField label="Due after (days)" required error={errors.due_days} hint={values.due_days !== '' ? dueLabel(values.due_days) : undefined}>
          <input type="number" min="0" step="1" {...form.bind('due_days')} />
        </FormField>
        <label className="field checkbox span-2">
          <input type="checkbox" checked={!!values.is_active} onChange={(e) => form.set('is_active', e.target.checked)} />
          Active (can be picked on new subscriptions)
        </label>
      </form>
    </Modal>
  );
}

export default function PaymentTerms() {
  const isAdmin = useIsAdmin();
  const toast = useToast();
  const list = useList('/catalog/payment-terms', { search: '', active: '1', sort: 'due_days' });
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const act = async (row, action) => {
    setBusy(true);
    try {
      if (action === 'delete') {
        await api.delete(`/catalog/payment-terms/${row.id}`);
        toast.success(`${row.name} deleted`);
      } else {
        await api.patch(`/catalog/payment-terms/${row.id}/${action}`);
        toast.success(`${row.name} ${action === 'archive' ? 'archived' : 'restored'}`);
      }
      list.reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const columns = [
    { key: 'name', label: 'Name', render: (r) => <span className="cat-name">{r.name}</span> },
    { key: 'due_days', label: 'Due', render: (r) => dueLabel(r.due_days) },
    { key: 'subscription_count', label: 'Subscriptions', align: 'right' },
    { key: 'is_active', label: 'Status', render: (r) => <ActiveBadge active={r.is_active} /> },
  ];
  if (isAdmin) {
    columns.push({
      key: 'actions', label: '', align: 'right', render: (r) => (
        <div className="row" style={{ justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
          <button type="button" className="btn ghost sm" onClick={() => setEditing(r)}>Edit</button>
          {r.is_active
            ? <button type="button" className="btn ghost sm" onClick={() => act(r, 'archive')} disabled={busy}>Archive</button>
            : <button type="button" className="btn ghost sm" onClick={() => act(r, 'restore')} disabled={busy}>Restore</button>}
          <button type="button" className="btn ghost sm" onClick={() => setConfirm(r)}>Delete</button>
        </div>
      ),
    });
  }

  return (
    <div className="stack">
      <PageHeader
        title="Payment terms"
        subtitle="How long customers have to pay an invoice. The due date is invoice date + due days."
        actions={isAdmin && <button type="button" className="btn primary" onClick={() => setEditing({})}>New payment term</button>}
      />
      {!isAdmin && <ReadOnlyNote what="payment term setup" />}
      <Card>
        <div className="cat-filters" style={{ marginBottom: 12 }}>
          <SearchInput value={list.params.search} onChange={(v) => list.setParam('search', v)} placeholder="Search payment terms" />
          <ActiveFilter value={list.params.active} onChange={(v) => list.setParam('active', v)} />
        </div>
        <ErrorBanner error={list.error} />
        <DataTable
          columns={columns}
          rows={list.data.items}
          loading={list.loading}
          empty="No payment terms match these filters"
          onRowClick={isAdmin ? (r) => setEditing(r) : undefined}
        />
        <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} onChange={list.setPage} />
      </Card>

      {editing && (
        <TermModal
          term={editing}
          onClose={() => setEditing(null)}
          onSaved={(saved, isNew) => {
            toast.success(`${saved.name} ${isNew ? 'created' : 'saved'}`);
            setEditing(null);
            list.reload();
          }}
        />
      )}
      <ConfirmDialog
        open={!!confirm}
        title="Delete payment term?"
        message={confirm ? `Delete "${confirm.name}" permanently? If templates or subscriptions use it you will be asked to archive it instead.` : ''}
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={() => act(confirm, 'delete')}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
