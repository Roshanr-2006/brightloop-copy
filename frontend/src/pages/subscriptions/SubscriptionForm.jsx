// Create / edit a subscription (owner: Swathy).
// /subscriptions/new[?customer=ID]  and  /subscriptions/:id/edit (draft or quotation only)
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import {
  Card, ErrorBanner, FormField, PageHeader, Spinner, StatusBadge, useToast,
} from '../../components/ui';
import { formatDate, formatMoney } from '../../utils/format';
import { lineTotals, periodText, todayIso } from './subscriptionUtils';

let keySeq = 0;
const newKey = () => `l${(keySeq += 1)}`;
const emptyLine = () => ({ key: newKey(), product_id: '', variant_id: '', description: '', quantity: 1, unit_price: '', tax_ids: [] });

/* ---------- Customer picker with server-side search ---------- */
function CustomerPicker({ value, onChange, error }) {
  const [text, setText] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const id = setTimeout(() => {
      api.get('/customers', { search: text, limit: 8 })
        .then((d) => setResults(d.items || []))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(id);
  }, [text, open]);

  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    // Not a <label> wrapper (FormField): clicks inside a label re-trigger the first button.
    <div className={`field ${error ? 'has-error' : ''}`}>
      <span className="field-label">Customer<span className="req"> *</span></span>
      <div ref={boxRef} style={{ position: 'relative' }}>
        {value && !open ? (
          <div className="row" style={{ alignItems: 'center', gap: 8 }}>
            <div className="input" style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
              <strong>{value.name}</strong>
              {value.email && <span className="muted" style={{ marginLeft: 8 }}>{value.email}</span>}
            </div>
            <button type="button" className="btn ghost sm" onClick={() => { setOpen(true); setText(''); }}>Change</button>
          </div>
        ) : (
          <input
            className="input"
            type="search"
            autoFocus={Boolean(value)}
            placeholder="Search customers by name, email or company"
            value={text}
            onFocus={() => setOpen(true)}
            onChange={(e) => { setText(e.target.value); setOpen(true); }}
          />
        )}
        {open && (
          <div
            role="listbox"
            style={{
              position: 'absolute', zIndex: 20, left: 0, right: 0, top: '100%', marginTop: 4,
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
              boxShadow: '0 8px 24px rgba(16,24,40,.12)', maxHeight: 260, overflowY: 'auto',
            }}
          >
            {results.length === 0 && <div className="muted" style={{ padding: 10 }}>No customers found</div>}
            {results.map((c) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={value?.id === c.id}
                onClick={() => { onChange(c); setOpen(false); }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
                  background: 'none', border: 0, borderBottom: '1px solid var(--border)', cursor: 'pointer',
                }}
              >
                <strong>{c.name}</strong>
                {c.company_name && <span className="muted"> &middot; {c.company_name}</span>}
                <div className="muted" style={{ fontSize: 12 }}>{c.email}</div>
              </button>
            ))}
          </div>
        )}
      </div>
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

export default function SubscriptionForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const [query] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [status, setStatus] = useState('draft');
  const [number, setNumber] = useState('');
  const [plans, setPlans] = useState([]);
  const [terms, setTerms] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [products, setProducts] = useState([]);
  const [taxes, setTaxes] = useState([]);

  const [customer, setCustomer] = useState(null);
  const [form, setForm] = useState({
    template_id: '', plan_id: '', payment_term_id: '', start_date: todayIso(), expiry_date: '', notes: '',
  });
  const [validUntil, setValidUntil] = useState(null);
  const [lines, setLines] = useState([emptyLine()]);
  const [fields, setFields] = useState({});
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  // Reference data + existing subscription
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [p, t, tpl, prod, tx] = await Promise.all([
          api.get('/catalog/plans/options'),
          api.get('/catalog/payment-terms', { active: 1, limit: 100 }),
          api.get('/catalog/templates', { active: 1, limit: 100 }).catch(() => ({ items: [] })),
          api.get('/catalog/products/options'),
          api.get('/catalog/taxes', { limit: 100 }).catch(() => ({ items: [] })),
        ]);
        if (cancelled) return;
        setPlans(p.items || []);
        setTerms(t.items || []);
        setTemplates(tpl.items || []);
        setProducts(prod.items || []);
        setTaxes(tx.items || []);

        if (isEdit) {
          const s = await api.get(`/subscriptions/${id}`);
          if (cancelled) return;
          setStatus(s.status);
          setNumber(s.number);
          setCustomer({ id: s.customer_id, name: s.customer_name, email: s.customer_email });
          setForm({
            template_id: s.template_id || '',
            plan_id: s.plan_id || '',
            payment_term_id: s.payment_term_id || '',
            start_date: s.start_date || '',
            expiry_date: s.expiry_date || '',
            notes: s.notes || '',
          });
          setValidUntil(s.quotation_valid_until);
          setLines(s.lines.map((l) => ({
            key: newKey(),
            product_id: l.product_id,
            variant_id: l.variant_id || '',
            description: l.description || '',
            quantity: l.quantity,
            unit_price: l.unit_price,
            tax_ids: l.tax_ids || [],
          })));
        } else if (query.get('customer')) {
          const c = await api.get(`/customers/${query.get('customer')}`).catch(() => null);
          if (!cancelled && c) setCustomer({ id: c.id, name: c.name, email: c.email });
        }
      } catch (e) {
        if (!cancelled) setLoadError(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const productById = useMemo(() => new Map(products.map((p) => [Number(p.id), p])), [products]);
  const taxById = useMemo(() => {
    const m = new Map(taxes.map((t) => [Number(t.id), t]));
    for (const p of products) for (const t of p.taxes || []) if (!m.has(Number(t.id))) m.set(Number(t.id), t);
    return m;
  }, [taxes, products]);
  const plan = plans.find((p) => String(p.id) === String(form.plan_id));

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const updateLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const onProduct = (key, productId) => {
    const p = productById.get(Number(productId));
    updateLine(key, {
      product_id: productId,
      variant_id: '',
      unit_price: p ? Number(p.sales_price) : '',
      tax_ids: p ? (p.taxes || []).map((t) => t.id) : [],
    });
  };

  const onVariant = (key, line, variantId) => {
    const p = productById.get(Number(line.product_id));
    const v = p?.variants?.find((x) => String(x.id) === String(variantId));
    updateLine(key, {
      variant_id: variantId,
      unit_price: v ? Number(v.final_price ?? Number(p.sales_price) + Number(v.extra_price)) : Number(p?.sales_price ?? 0),
    });
  };

  const applyTemplate = async (templateId) => {
    setForm((f) => ({ ...f, template_id: templateId }));
    if (!templateId) { setValidUntil(null); return; }
    try {
      const d = await api.get(`/subscriptions/from-template/${templateId}`);
      setForm((f) => ({
        ...f,
        template_id: templateId,
        plan_id: d.plan_id || f.plan_id,
        payment_term_id: d.payment_term_id || f.payment_term_id,
        notes: d.notes || f.notes,
      }));
      setValidUntil(d.quotation_valid_until);
      setLines(d.lines.map((l) => ({
        key: newKey(),
        product_id: l.product_id,
        variant_id: l.variant_id || '',
        description: l.description || '',
        quantity: l.quantity,
        unit_price: l.unit_price,
        tax_ids: l.tax_ids || [],
      })));
      toast.info('Template applied: plan, payment term and lines prefilled');
    } catch (e) {
      toast.error(e.message);
    }
  };

  const computed = lines.map((l) => {
    const lineTaxes = (l.tax_ids || []).map((tid) => taxById.get(Number(tid))).filter(Boolean);
    return { ...l, taxes: lineTaxes, ...lineTotals(l.quantity, l.unit_price, lineTaxes) };
  });
  const totals = computed.reduce((acc, l) => ({
    untaxed: acc.untaxed + l.amount, tax: acc.tax + l.tax, total: acc.total + l.total,
  }), { untaxed: 0, tax: 0, total: 0 });

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setFields({});
    const local = {};
    if (!customer) local.customer_id = 'Choose a customer';
    if (!form.plan_id) local.plan_id = 'Choose a plan';
    if (!form.start_date) local.start_date = 'Start date is required';
    if (form.expiry_date && form.start_date && form.expiry_date < form.start_date) local.expiry_date = 'Expiry must be on or after the start date';
    const filled = lines.filter((l) => l.product_id);
    if (filled.length === 0) local.lines = 'Add at least one product line';
    if (Object.keys(local).length) { setFields(local); return; }

    const body = {
      customer_id: customer.id,
      plan_id: Number(form.plan_id),
      template_id: form.template_id ? Number(form.template_id) : null,
      payment_term_id: form.payment_term_id ? Number(form.payment_term_id) : null,
      start_date: form.start_date,
      expiry_date: form.expiry_date || null,
      notes: form.notes,
      lines: filled.map((l) => ({
        product_id: Number(l.product_id),
        variant_id: l.variant_id ? Number(l.variant_id) : null,
        description: l.description || null,
        quantity: Number(l.quantity),
        unit_price: l.unit_price === '' ? null : Number(l.unit_price),
        tax_ids: (l.tax_ids || []).map(Number),
      })),
    };
    setSaving(true);
    try {
      const saved = isEdit ? await api.put(`/subscriptions/${id}`, body) : await api.post('/subscriptions', body);
      toast.success(isEdit ? 'Subscription updated' : `Subscription ${saved.number} created`);
      navigate(`/subscriptions/${saved.id}`);
    } catch (err) {
      if (err instanceof ApiError) { setFields(err.fields || {}); setError(err.message); } else setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner />;
  if (loadError) return <ErrorBanner error={loadError} />;
  if (isEdit && !['draft', 'quotation'].includes(status)) {
    return (
      <Card>
        <div className="alert alert-info">
          {number} is {status} and can no longer be edited. <Link to={`/subscriptions/${id}`}>Back to the subscription</Link>
        </div>
      </Card>
    );
  }

  const lineErr = (i, k) => fields[`lines.${i}.${k}`];

  return (
    <form onSubmit={submit} noValidate>
      <PageHeader
        title={isEdit ? `Edit ${number}` : 'New subscription'}
        subtitle={isEdit ? <StatusBadge status={status} /> : 'Starts as a draft; send it as a quotation or confirm it directly'}
        actions={(
          <>
            <Link className="btn ghost" to={isEdit ? `/subscriptions/${id}` : '/subscriptions'}>Cancel</Link>
            <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          </>
        )}
      />
      <ErrorBanner error={error} />

      <Card title="Details">
        <div className="form-grid">
          <CustomerPicker value={customer} onChange={setCustomer} error={fields.customer_id} />
          <FormField label="Start from template" hint={validUntil ? `Quotation valid until ${formatDate(validUntil)}` : 'Optional: prefills plan, payment term and lines'} error={fields.template_id}>
            <select value={form.template_id} onChange={(e) => applyTemplate(e.target.value)}>
              <option value="">No template</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </FormField>
          <FormField
            label="Recurring plan"
            required
            error={fields.plan_id}
            hint={plan ? `${periodText(plan.billing_period, plan.billing_interval)} · min qty ${plan.min_quantity}${plan.start_date || plan.end_date ? ` · available ${plan.start_date ? formatDate(plan.start_date) : '...'} to ${plan.end_date ? formatDate(plan.end_date) : '...'}` : ''}` : undefined}
          >
            <select value={form.plan_id} onChange={set('plan_id')}>
              <option value="">Choose a plan</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.billing_period})</option>)}
            </select>
          </FormField>
          <FormField label="Payment term" error={fields.payment_term_id}>
            <select value={form.payment_term_id} onChange={set('payment_term_id')}>
              <option value="">None (due on invoice date)</option>
              {terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </FormField>
          <FormField label="Start date" required error={fields.start_date}>
            <input type="date" value={form.start_date} onChange={set('start_date')} />
          </FormField>
          <FormField label="Expiry date" hint="Leave empty for an open-ended subscription" error={fields.expiry_date}>
            <input type="date" value={form.expiry_date} min={form.start_date || undefined} onChange={set('expiry_date')} />
          </FormField>
          <FormField label="Notes" className="span-2" error={fields.notes}>
            <textarea rows={2} value={form.notes} onChange={set('notes')} placeholder="Internal or customer-facing notes" />
          </FormField>
        </div>
        {plan && (
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            {plan.auto_close ? <StatusBadge status="info" label="Auto-closes at expiry" /> : null}
            {plan.pausable ? <StatusBadge status="info" label="Pausable" /> : null}
            {plan.closable ? <StatusBadge status="info" label="Closable" /> : <StatusBadge status="warning" label="Cannot be closed early" />}
            {plan.renewable ? <StatusBadge status="info" label="Renewable" /> : null}
          </div>
        )}
      </Card>

      <Card
        title="Order lines"
        actions={<button type="button" className="btn ghost sm" onClick={() => setLines((ls) => [...ls, emptyLine()])}>Add line</button>}
      >
        {fields.lines && <div className="alert alert-error">{fields.lines}</div>}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ minWidth: 200 }}>Product</th>
                <th style={{ minWidth: 150 }}>Variant</th>
                <th style={{ width: 90 }}>Qty</th>
                <th style={{ width: 130 }}>Unit price</th>
                <th>Taxes</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {computed.map((l, i) => {
                const p = productById.get(Number(l.product_id));
                const variants = p?.variants || [];
                return (
                  <tr key={l.key}>
                    <td>
                      <select className="input" value={l.product_id} onChange={(e) => onProduct(l.key, e.target.value)} aria-label="Product">
                        <option value="">Choose product</option>
                        {products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
                      {lineErr(i, 'product_id') && <div className="field-error">{lineErr(i, 'product_id')}</div>}
                      <input
                        className="input"
                        style={{ marginTop: 6 }}
                        placeholder="Description (optional)"
                        value={l.description}
                        onChange={(e) => updateLine(l.key, { description: e.target.value })}
                      />
                    </td>
                    <td>
                      {variants.length > 0 ? (
                        <select className="input" value={l.variant_id} onChange={(e) => onVariant(l.key, l, e.target.value)} aria-label="Variant">
                          <option value="">Standard</option>
                          {variants.map((v) => (
                            <option key={v.id} value={v.id}>{v.name}{Number(v.extra_price) ? ` (+${formatMoney(v.extra_price)})` : ''}</option>
                          ))}
                        </select>
                      ) : <span className="muted">-</span>}
                      {lineErr(i, 'variant_id') && <div className="field-error">{lineErr(i, 'variant_id')}</div>}
                    </td>
                    <td>
                      <input
                        className="input"
                        type="number"
                        min={1}
                        step={1}
                        value={l.quantity}
                        onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                        aria-label="Quantity"
                      />
                      {lineErr(i, 'quantity') && <div className="field-error">{lineErr(i, 'quantity')}</div>}
                    </td>
                    <td>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        step="0.01"
                        value={l.unit_price}
                        onChange={(e) => updateLine(l.key, { unit_price: e.target.value })}
                        aria-label="Unit price"
                      />
                      {lineErr(i, 'unit_price') && <div className="field-error">{lineErr(i, 'unit_price')}</div>}
                    </td>
                    <td>
                      {l.taxes.length ? l.taxes.map((t) => <span key={t.id} className="badge badge-neutral" style={{ marginRight: 4 }}>{t.name}</span>) : <span className="muted">No tax</span>}
                      {lineErr(i, 'tax_ids') && <div className="field-error">{lineErr(i, 'tax_ids')}</div>}
                    </td>
                    <td style={{ textAlign: 'right' }}>{formatMoney(l.amount)}</td>
                    <td style={{ textAlign: 'right' }}><strong>{formatMoney(l.total)}</strong></td>
                    <td>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="Remove line"
                        disabled={lines.length === 1}
                        onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                      >
                        &times;
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr><td colSpan={6} style={{ textAlign: 'right' }}>Untaxed amount</td><td style={{ textAlign: 'right' }}>{formatMoney(totals.untaxed)}</td><td /></tr>
              <tr><td colSpan={6} style={{ textAlign: 'right' }}>Taxes</td><td style={{ textAlign: 'right' }}>{formatMoney(totals.tax)}</td><td /></tr>
              <tr>
                <td colSpan={6} style={{ textAlign: 'right' }}><strong>Total {plan ? periodText(plan.billing_period, plan.billing_interval) : ''}</strong></td>
                <td style={{ textAlign: 'right' }}><strong>{formatMoney(totals.total)}</strong></td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <div className="form-actions">
        <Link className="btn ghost" to={isEdit ? `/subscriptions/${id}` : '/subscriptions'}>Cancel</Link>
        <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving...' : isEdit ? 'Save changes' : 'Create draft'}</button>
      </div>
    </form>
  );
}
