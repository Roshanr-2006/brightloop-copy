// Discounts (owner: Roshan). Admin only (route + API).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import useList from '../../hooks/useList';
import { formatMoney, formatDate } from '../../utils/format';
import {
  Card, PageHeader, DataTable, Pagination, SearchInput, ErrorBanner, Modal, FormField, ConfirmDialog, Tabs, useToast,
} from '../../components/ui/index.jsx';
import { useForm, CheckGroup } from './shared.jsx';

const STATUS_TONE = { active: 'success', scheduled: 'info', expired: 'neutral', exhausted: 'warning', inactive: 'neutral' };
const STATUS_HELP = {
  active: 'Applies automatically to the next matching invoices',
  scheduled: 'Starts on its start date',
  expired: 'End date has passed',
  exhausted: 'Usage limit reached',
  inactive: 'Archived by an admin',
};

function DiscountStatus({ status }) {
  return <span className={`badge badge-${STATUS_TONE[status] || 'neutral'}`} title={STATUS_HELP[status]}>{status}</span>;
}

function Usage({ d }) {
  if (d.usage_limit === null || d.usage_limit === undefined) {
    return <span className="cat-num">{d.usage_count} <span className="muted">/ unlimited</span></span>;
  }
  const pct = Math.min(100, Math.round((d.usage_count / d.usage_limit) * 100));
  return (
    <div>
      <span className="cat-num">{d.usage_count} / {d.usage_limit}</span>
      <div className={`usage-bar ${pct >= 100 ? 'full' : ''}`}><i style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

const valueLabel = (d) => (d.discount_type === 'percent' ? `${Number(d.value)}% off` : `${formatMoney(d.value)} off`);

const EMPTY = {
  name: '', discount_type: 'percent', value: '', scope: 'subscription', product_ids: [], subscription_ids: [],
  min_purchase: '', min_quantity: '', start_date: '', end_date: '', usage_limit: '', is_active: true,
};

function DiscountModal({ discountId, onClose, onSaved }) {
  const isNew = !discountId;
  const form = useForm(EMPTY);
  const { values, errors } = form;
  const [detail, setDetail] = useState(null);
  const [products, setProducts] = useState([]);
  const [subs, setSubs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get('/catalog/products/options'),
      isNew ? Promise.resolve(null) : api.get(`/catalog/discounts/${discountId}`),
      // Subscriptions belong to another module; the picker is optional if that API is unavailable.
      api.get('/subscriptions', { limit: 100 }).catch(() => null),
    ]).then(([prods, d, s]) => {
      if (cancelled) return;
      const list = prods.items.map((p) => ({ value: p.id, label: p.name }));
      if (d) {
        for (const p of d.products) if (!list.some((x) => x.value === p.id)) list.push({ value: p.id, label: `${p.name} (archived)` });
        setDetail(d);
        form.setValues({
          name: d.name, discount_type: d.discount_type, value: d.value, scope: d.scope,
          product_ids: d.product_ids, subscription_ids: d.subscription_ids,
          min_purchase: d.min_purchase || '', min_quantity: d.min_quantity || '',
          start_date: d.start_date || '', end_date: d.end_date || '',
          usage_limit: d.usage_limit ?? '', is_active: !!d.is_active,
        });
      }
      setProducts(list);
      if (s?.items) {
        const opts = s.items.map((x) => ({ value: x.id, label: `${x.number}${x.customer_name ? ` - ${x.customer_name}` : ''}` }));
        for (const x of d?.subscriptions || []) if (!opts.some((o) => o.value === x.id)) opts.push({ value: x.id, label: x.number });
        setSubs(opts);
      }
    }).catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [discountId]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const n = (v) => (v === '' || v === null ? null : Number(v));
      const body = {
        ...values,
        value: n(values.value),
        min_purchase: n(values.min_purchase) ?? 0,
        min_quantity: n(values.min_quantity) ?? 0,
        usage_limit: n(values.usage_limit),
        start_date: values.start_date || null,
        end_date: values.end_date || null,
      };
      const saved = isNew ? await api.post('/catalog/discounts', body) : await api.put(`/catalog/discounts/${discountId}`, body);
      onSaved(saved, isNew);
    } catch (err) {
      setError(err.message);
      form.setErrors(err.fields || {});
    } finally {
      setBusy(false);
    }
  };

  const preview = values.value !== ''
    ? `${values.discount_type === 'percent' ? `${values.value}%` : formatMoney(values.value)} off ${values.scope === 'product' ? 'each matching product line' : 'the whole subscription'}`
    : null;

  return (
    <Modal
      open
      wide
      title={isNew ? 'New discount' : `Edit ${detail?.name || 'discount'}`}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="discount-form" className="btn primary" disabled={busy || loading}>{busy ? 'Saving...' : 'Save discount'}</button>
        </>
      )}
    >
      {loading ? <p className="muted">Loading...</p> : (
        <form id="discount-form" className="stack" onSubmit={submit} noValidate>
          <ErrorBanner error={error} />
          {detail && (
            <div className="row" style={{ gap: 12 }}>
              <DiscountStatus status={detail.status} />
              <span className="muted">{STATUS_HELP[detail.status]}</span>
            </div>
          )}
          <div className="form-grid">
            <FormField label="Name" required error={errors.name} className="span-2">
              <input autoFocus {...form.bind('name')} placeholder="e.g. Festive 10%" />
            </FormField>
            <FormField label="Discount type" error={errors.discount_type}>
              <select {...form.bind('discount_type')}>
                <option value="percent">Percentage</option>
                <option value="fixed">Fixed amount</option>
              </select>
            </FormField>
            <FormField label={values.discount_type === 'percent' ? 'Value (%)' : 'Value (INR)'} required error={errors.value} hint={preview}>
              <input type="number" min="0" max={values.discount_type === 'percent' ? 100 : undefined} step="0.01" {...form.bind('value')} />
            </FormField>
          </div>

          <div className="stack" style={{ gap: 8 }}>
            <span className="field-label">Applies to</span>
            <div className="scope-toggle" role="group" aria-label="Scope">
              <button type="button" className={values.scope === 'subscription' ? 'active' : ''} onClick={() => form.set('scope', 'subscription')}>Whole subscription</button>
              <button type="button" className={values.scope === 'product' ? 'active' : ''} onClick={() => form.set('scope', 'product')}>Specific products</button>
            </div>
            {values.scope === 'product' ? (
              <>
                <span className="muted">Only lines with these products get the discount.</span>
                <CheckGroup options={products} value={values.product_ids} onChange={(v) => form.set('product_ids', v)} scroll empty="No active products" />
                {errors.product_ids && <span className="field-error">{errors.product_ids}</span>}
              </>
            ) : (
              <>
                <span className="muted">
                  {subs ? 'Leave all unticked to apply to every subscription, or limit it to some.' : 'Applies to every subscription.'}
                </span>
                {subs && subs.length > 0 && (
                  <CheckGroup options={subs} value={values.subscription_ids} onChange={(v) => form.set('subscription_ids', v)} scroll />
                )}
                {errors.subscription_ids && <span className="field-error">{errors.subscription_ids}</span>}
              </>
            )}
          </div>

          <div className="form-grid">
            <FormField label="Minimum purchase (INR)" error={errors.min_purchase} hint="Untaxed amount the order must reach. Empty = no minimum">
              <input type="number" min="0" step="0.01" {...form.bind('min_purchase')} />
            </FormField>
            <FormField label="Minimum quantity" error={errors.min_quantity} hint="Total units across lines. Empty = no minimum">
              <input type="number" min="0" step="1" {...form.bind('min_quantity')} />
            </FormField>
            <FormField label="Start date" error={errors.start_date} hint="Empty = starts now">
              <input type="date" {...form.bind('start_date')} />
            </FormField>
            <FormField label="End date" error={errors.end_date} hint="Empty = never expires">
              <input type="date" min={values.start_date || undefined} {...form.bind('end_date')} />
            </FormField>
            <FormField
              label="Usage limit"
              error={errors.usage_limit}
              hint={detail ? `Used ${detail.usage_count} time(s) so far. Empty = unlimited` : 'How many invoices can use it. Empty = unlimited'}
            >
              <input type="number" min={detail?.usage_count || 1} step="1" {...form.bind('usage_limit')} />
            </FormField>
            <label className="field checkbox" style={{ alignSelf: 'center' }}>
              <input type="checkbox" checked={!!values.is_active} onChange={(e) => form.set('is_active', e.target.checked)} />
              Active
            </label>
          </div>

          {detail && (
            <div>
              <h4 className="cat-section-title">Usage history</h4>
              {detail.usages.length === 0 ? <p className="muted">Not used on any invoice yet.</p> : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th style={{ textAlign: 'right' }}>Discount</th></tr></thead>
                    <tbody>
                      {detail.usages.map((u) => (
                        <tr key={u.id}>
                          <td><Link to={`/invoices/${u.invoice_id}`}>{u.invoice_number}</Link></td>
                          <td>{u.customer_name}</td>
                          <td>{formatDate(u.invoice_date)}</td>
                          <td style={{ textAlign: 'right' }} className="cat-num">{formatMoney(u.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </form>
      )}
    </Modal>
  );
}

export default function Discounts() {
  const toast = useToast();
  const list = useList('/catalog/discounts', { search: '', status: '', scope: '', sort: 'name' });
  const [editing, setEditing] = useState(null); // null | 'new' | id
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const act = async (row, action) => {
    setBusy(true);
    try {
      if (action === 'delete') {
        await api.delete(`/catalog/discounts/${row.id}`);
        toast.success(`${row.name} deleted`);
      } else {
        await api.patch(`/catalog/discounts/${row.id}/${action}`);
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
    { key: 'name', label: 'Discount', render: (r) => <><span className="cat-name">{r.name}</span><span className="cat-sub">{valueLabel(r)}</span></> },
    {
      key: 'scope', label: 'Applies to', render: (r) => (r.scope === 'product'
        ? <>Products<span className="cat-sub">{r.product_names || '-'}</span></>
        : <>Subscription<span className="cat-sub">{r.subscription_count ? `${r.subscription_count} selected` : 'All subscriptions'}</span></>),
    },
    {
      key: 'conditions', label: 'Conditions', render: (r) => {
        const parts = [];
        if (Number(r.min_purchase) > 0) parts.push(`Min ${formatMoney(r.min_purchase)}`);
        if (Number(r.min_quantity) > 0) parts.push(`Min ${r.min_quantity} units`);
        return parts.length ? parts.join(', ') : <span className="muted">None</span>;
      },
    },
    {
      key: 'dates', label: 'Valid', render: (r) => (r.start_date || r.end_date
        ? <span className="cat-num">{r.start_date ? formatDate(r.start_date) : 'Now'} - {r.end_date ? formatDate(r.end_date) : 'no end'}</span>
        : <span className="muted">Always</span>),
    },
    { key: 'usage', label: 'Used', render: (r) => <Usage d={r} /> },
    { key: 'status', label: 'Status', render: (r) => <DiscountStatus status={r.status} /> },
    {
      key: 'actions', label: '', align: 'right', render: (r) => (
        <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
          <button type="button" className="btn ghost sm" onClick={() => setEditing(r.id)}>Edit</button>
          {r.is_active
            ? <button type="button" className="btn ghost sm" onClick={() => act(r, 'archive')} disabled={busy}>Archive</button>
            : <button type="button" className="btn ghost sm" onClick={() => act(r, 'restore')} disabled={busy}>Restore</button>}
          <button type="button" className="btn ghost sm" onClick={() => setConfirm(r)}>Delete</button>
        </div>
      ),
    },
  ];

  const statusTabs = [
    { value: '', label: 'All' },
    { value: 'active', label: 'Active' },
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'exhausted', label: 'Used up' },
    { value: 'expired', label: 'Expired' },
    { value: 'inactive', label: 'Archived' },
  ];

  return (
    <div className="stack">
      <PageHeader
        title="Discounts"
        subtitle="Admin-only rules. Active discounts are added to the next matching invoice automatically and stop when expired or used up."
        actions={<button type="button" className="btn primary" onClick={() => setEditing('new')}>New discount</button>}
      />
      <Card>
        <Tabs tabs={statusTabs} value={list.params.status} onChange={(v) => list.setParam('status', v)} />
        <div className="cat-filters" style={{ margin: '12px 0' }}>
          <SearchInput value={list.params.search} onChange={(v) => list.setParam('search', v)} placeholder="Search discounts" />
          <select className="input" value={list.params.scope} onChange={(e) => list.setParam('scope', e.target.value)} aria-label="Scope">
            <option value="">Any scope</option>
            <option value="subscription">Whole subscription</option>
            <option value="product">Specific products</option>
          </select>
          <select className="input" value={list.params.sort} onChange={(e) => list.setParam('sort', e.target.value)} aria-label="Sort">
            <option value="name">Name A-Z</option>
            <option value="end">Ending soonest</option>
            <option value="usage:desc">Most used</option>
            <option value="created:desc">Newest first</option>
          </select>
        </div>
        <ErrorBanner error={list.error} />
        <DataTable
          columns={columns}
          rows={list.data.items}
          loading={list.loading}
          empty="No discounts match these filters"
          onRowClick={(r) => setEditing(r.id)}
        />
        <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} onChange={list.setPage} />
      </Card>

      {editing && (
        <DiscountModal
          discountId={editing === 'new' ? null : editing}
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
        title="Delete discount?"
        message={confirm ? `Delete "${confirm.name}" permanently? Discounts already used on invoices can only be archived.` : ''}
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={() => act(confirm, 'delete')}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
