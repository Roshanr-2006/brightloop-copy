// Taxes (owner: Roshan). Admin edits, staff reads.
import { useState } from 'react';
import { api } from '../../api/client';
import useList from '../../hooks/useList';
import { formatMoney } from '../../utils/format';
import {
  Card, PageHeader, DataTable, Pagination, SearchInput, ErrorBanner, Modal, FormField, ConfirmDialog, useToast,
} from '../../components/ui/index.jsx';
import { useIsAdmin, useForm, ActiveFilter, ActiveBadge, ReadOnlyNote, taxRateLabel } from './shared.jsx';

const EMPTY = { name: '', computation: 'percent', amount: '', is_active: true };

function TaxModal({ tax, onClose, onSaved }) {
  const isNew = !tax?.id;
  const form = useForm(tax?.id ? { ...tax, is_active: !!tax.is_active } : EMPTY);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { values, errors } = form;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { ...values, amount: values.amount === '' ? null : Number(values.amount) };
      const saved = isNew ? await api.post('/catalog/taxes', body) : await api.put(`/catalog/taxes/${tax.id}`, body);
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
      title={isNew ? 'New tax' : `Edit ${tax.name}`}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="tax-form" className="btn primary" disabled={busy}>{busy ? 'Saving...' : 'Save tax'}</button>
        </>
      )}
    >
      <form id="tax-form" className="form-grid" onSubmit={submit} noValidate>
        <ErrorBanner error={error} />
        <FormField label="Name" required error={errors.name} className="span-2">
          <input autoFocus {...form.bind('name')} placeholder="e.g. GST 18%" />
        </FormField>
        <FormField label="Computation" error={errors.computation}>
          <select {...form.bind('computation')}>
            <option value="percent">Percentage of price</option>
            <option value="fixed">Fixed amount per unit</option>
          </select>
        </FormField>
        <FormField
          label={values.computation === 'percent' ? 'Rate (%)' : 'Amount per unit (INR)'}
          required
          error={errors.amount}
          hint={values.computation === 'percent' ? 'Between 0 and 100' : 'Charged once for every unit sold'}
        >
          <input type="number" min="0" max={values.computation === 'percent' ? 100 : undefined} step="0.01" {...form.bind('amount')} />
        </FormField>
        <label className="field checkbox span-2">
          <input type="checkbox" checked={!!values.is_active} onChange={(e) => form.set('is_active', e.target.checked)} />
          Active (available for new products and lines)
        </label>
      </form>
    </Modal>
  );
}

export default function Taxes() {
  const isAdmin = useIsAdmin();
  const toast = useToast();
  const list = useList('/catalog/taxes', { search: '', active: '1', sort: 'name' });
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const act = async (row, action) => {
    setBusy(true);
    try {
      if (action === 'delete') {
        await api.delete(`/catalog/taxes/${row.id}`);
        toast.success(`${row.name} deleted`);
      } else {
        await api.patch(`/catalog/taxes/${row.id}/${action}`);
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
    { key: 'computation', label: 'Type', render: (r) => (r.computation === 'percent' ? 'Percentage' : 'Fixed per unit') },
    { key: 'amount', label: 'Rate', align: 'right', render: (r) => <span className="cat-num">{taxRateLabel(r, formatMoney)}</span> },
    { key: 'product_count', label: 'Used by', align: 'right', render: (r) => `${r.product_count} product${r.product_count === 1 ? '' : 's'}` },
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
        title="Taxes"
        subtitle="Tax rules applied automatically to subscription and invoice lines."
        actions={isAdmin && <button type="button" className="btn primary" onClick={() => setEditing({})}>New tax</button>}
      />
      {!isAdmin && <ReadOnlyNote what="tax setup" />}
      <Card>
        <div className="cat-filters" style={{ marginBottom: 12 }}>
          <SearchInput value={list.params.search} onChange={(v) => list.setParam('search', v)} placeholder="Search taxes" />
          <ActiveFilter value={list.params.active} onChange={(v) => list.setParam('active', v)} />
          <select className="input" value={list.params.sort} onChange={(e) => list.setParam('sort', e.target.value)} aria-label="Sort">
            <option value="name">Name A-Z</option>
            <option value="amount:desc">Highest rate</option>
            <option value="amount">Lowest rate</option>
          </select>
        </div>
        <ErrorBanner error={list.error} />
        <DataTable
          columns={columns}
          rows={list.data.items}
          loading={list.loading}
          empty="No taxes match these filters"
          onRowClick={isAdmin ? (r) => setEditing(r) : undefined}
        />
        <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} onChange={list.setPage} />
      </Card>

      {editing && (
        <TaxModal
          tax={editing}
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
        title="Delete tax?"
        message={confirm ? `Delete "${confirm.name}" permanently? If it is used by products or subscriptions you will be asked to archive it instead.` : ''}
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={() => act(confirm, 'delete')}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
