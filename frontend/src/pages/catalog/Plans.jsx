// Recurring plans (owner: Roshan). Admin edits in a modal, staff reads.
import { useState } from 'react';
import { api } from '../../api/client';
import useList from '../../hooks/useList';
import { formatMoney, formatDate } from '../../utils/format';
import {
  Card, PageHeader, DataTable, Pagination, SearchInput, ErrorBanner, Modal, FormField, ConfirmDialog, StatusBadge, useToast,
} from '../../components/ui/index.jsx';
import { useIsAdmin, useForm, ActiveFilter, ReadOnlyNote, periodLabel } from './shared.jsx';

const EMPTY = {
  name: '', price: '', billing_period: 'monthly', billing_interval: 1, min_quantity: 1, start_date: '', end_date: '',
  auto_close: false, closable: true, pausable: false, renewable: true, is_active: true,
};

const LIFECYCLE = [
  { key: 'auto_close', title: 'Close automatically', text: 'The subscription closes itself on its expiry date. No one has to remember to close it.' },
  { key: 'closable', title: 'Can be closed early', text: 'Your team can close the subscription before it expires, e.g. when a customer cancels.' },
  { key: 'pausable', title: 'Can be paused', text: 'An active subscription can be put on hold. No invoices are created while it is paused.' },
  { key: 'renewable', title: 'Can be renewed', text: 'When it ends, it can be renewed for another term with the same lines.' },
];

function Availability({ plan }) {
  if (!plan.is_active) return <StatusBadge status="inactive" label="archived" />;
  const range = plan.start_date || plan.end_date
    ? `${plan.start_date ? formatDate(plan.start_date) : 'Any time'} - ${plan.end_date ? formatDate(plan.end_date) : 'no end'}`
    : 'Always';
  return (
    <>
      {plan.available ? <StatusBadge status="active" label="available" /> : <StatusBadge status="paused" label="not available" />}
      <span className="cat-sub">{range}</span>
    </>
  );
}

function PlanModal({ plan, onClose, onSaved }) {
  const isNew = !plan?.id;
  const form = useForm(isNew ? EMPTY : {
    ...plan,
    start_date: plan.start_date || '',
    end_date: plan.end_date || '',
    auto_close: !!plan.auto_close, closable: !!plan.closable, pausable: !!plan.pausable, renewable: !!plan.renewable,
    is_active: !!plan.is_active,
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { values, errors } = form;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        ...values,
        price: values.price === '' ? null : Number(values.price),
        billing_interval: Number(values.billing_interval) || values.billing_interval,
        min_quantity: Number(values.min_quantity) || values.min_quantity,
        start_date: values.start_date || null,
        end_date: values.end_date || null,
      };
      const saved = isNew ? await api.post('/catalog/plans', body) : await api.put(`/catalog/plans/${plan.id}`, body);
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
      wide
      title={isNew ? 'New recurring plan' : `Edit ${plan.name}`}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="plan-form" className="btn primary" disabled={busy}>{busy ? 'Saving...' : 'Save plan'}</button>
        </>
      )}
    >
      <form id="plan-form" className="stack" onSubmit={submit} noValidate>
        <ErrorBanner error={error} />
        <div className="form-grid">
          <FormField label="Name" required error={errors.name}>
            <input autoFocus {...form.bind('name')} placeholder="e.g. Monthly Basic" />
          </FormField>
          <FormField label="Price (INR)" required error={errors.price} hint="Reference price of the plan">
            <input type="number" min="0" step="0.01" {...form.bind('price')} />
          </FormField>
          <FormField label="Billing period" required error={errors.billing_period}>
            <select {...form.bind('billing_period')}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </FormField>
          <FormField label="Bill every" error={errors.billing_interval} hint={`Invoices go out: ${periodLabel(values.billing_period, values.billing_interval).toLowerCase()}`}>
            <input type="number" min="1" step="1" {...form.bind('billing_interval')} />
          </FormField>
          <FormField label="Minimum quantity" error={errors.min_quantity} hint="Smallest quantity a subscription on this plan can have">
            <input type="number" min="1" step="1" {...form.bind('min_quantity')} />
          </FormField>
          <div />
          <FormField label="Available from" error={errors.start_date} hint="Leave empty for no start limit">
            <input type="date" {...form.bind('start_date')} />
          </FormField>
          <FormField label="Available until" error={errors.end_date} hint="Leave empty to keep it on sale">
            <input type="date" min={values.start_date || undefined} {...form.bind('end_date')} />
          </FormField>
        </div>
        <div>
          <h4 className="cat-section-title">What can happen to subscriptions on this plan</h4>
          <div className="toggle-grid">
            {LIFECYCLE.map((o) => (
              <label key={o.key} className={`toggle-card ${values[o.key] ? 'on' : ''}`}>
                <input type="checkbox" checked={!!values[o.key]} onChange={(e) => form.set(o.key, e.target.checked)} />
                <div>
                  <strong>{o.title}</strong>
                  <span>{o.text}</span>
                </div>
              </label>
            ))}
          </div>
        </div>
        <label className="field checkbox">
          <input type="checkbox" checked={!!values.is_active} onChange={(e) => form.set('is_active', e.target.checked)} />
          Active (can be chosen for new subscriptions and templates)
        </label>
      </form>
    </Modal>
  );
}

export default function Plans() {
  const isAdmin = useIsAdmin();
  const toast = useToast();
  const list = useList('/catalog/plans', { search: '', period: '', active: '1', sort: 'name' });
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const act = async (row, action) => {
    setBusy(true);
    try {
      if (action === 'delete') {
        await api.delete(`/catalog/plans/${row.id}`);
        toast.success(`${row.name} deleted`);
      } else {
        await api.patch(`/catalog/plans/${row.id}/${action}`);
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
    { key: 'name', label: 'Plan', render: (r) => <span className="cat-name">{r.name}</span> },
    {
      key: 'price', label: 'Price', align: 'right',
      render: (r) => <span className="cat-num">{formatMoney(r.price)}<span className="cat-sub">{periodLabel(r.billing_period, r.billing_interval)}</span></span>,
    },
    { key: 'min_quantity', label: 'Min qty', align: 'right' },
    { key: 'available', label: 'Availability', render: (r) => <Availability plan={r} /> },
    {
      key: 'options', label: 'Options', render: (r) => (
        <div className="chips">
          {r.auto_close ? <span className="chip">Auto-close</span> : null}
          {r.closable ? <span className="chip">Closable</span> : <span className="chip muted-chip">Not closable</span>}
          {r.pausable ? <span className="chip">Pausable</span> : null}
          {r.renewable ? <span className="chip">Renewable</span> : null}
        </div>
      ),
    },
    {
      key: 'subscription_count', label: 'Subscriptions', align: 'right',
      render: (r) => <span className="cat-num">{r.subscription_count}{r.active_subscription_count ? <span className="cat-sub">{r.active_subscription_count} running</span> : null}</span>,
    },
  ];
  if (isAdmin) {
    columns.push({
      key: 'actions', label: '', align: 'right', render: (r) => (
        <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
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
        title="Recurring plans"
        subtitle="How often subscriptions are billed, when a plan can be sold and what customers may do with it."
        actions={isAdmin && <button type="button" className="btn primary" onClick={() => setEditing({})}>New plan</button>}
      />
      {!isAdmin && <ReadOnlyNote what="plan setup" />}
      <Card>
        <div className="cat-filters" style={{ marginBottom: 12 }}>
          <SearchInput value={list.params.search} onChange={(v) => list.setParam('search', v)} placeholder="Search plans" />
          <select className="input" value={list.params.period} onChange={(e) => list.setParam('period', e.target.value)} aria-label="Billing period">
            <option value="">All periods</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
          <ActiveFilter value={list.params.active} onChange={(v) => list.setParam('active', v)} />
          <select className="input" value={list.params.sort} onChange={(e) => list.setParam('sort', e.target.value)} aria-label="Sort">
            <option value="name">Name A-Z</option>
            <option value="price">Price low-high</option>
            <option value="price:desc">Price high-low</option>
            <option value="subscriptions:desc">Most subscriptions</option>
          </select>
        </div>
        <ErrorBanner error={list.error} />
        <DataTable
          columns={columns}
          rows={list.data.items}
          loading={list.loading}
          empty="No plans match these filters"
          onRowClick={isAdmin ? (r) => setEditing(r) : undefined}
        />
        <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} onChange={list.setPage} />
      </Card>

      {editing && (
        <PlanModal
          plan={editing}
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
        title="Delete plan?"
        message={confirm ? `Delete "${confirm.name}" permanently? Plans used by subscriptions or templates can only be archived.` : ''}
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={() => act(confirm, 'delete')}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
