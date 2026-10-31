// Create / edit a quotation template (owner: Roshan). Staff see it read-only.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { formatMoney } from '../../utils/format';
import {
  Card, PageHeader, ErrorBanner, FormField, Spinner, ConfirmDialog, useToast,
} from '../../components/ui/index.jsx';
import { useIsAdmin, useForm, ActiveBadge, ReadOnlyNote, periodLabel, lineTax } from './shared.jsx';

const EMPTY = { name: '', validity_days: 30, plan_id: '', payment_term_id: '', notes: '', is_active: true };
let seq = 0;
const newKey = () => `l${++seq}`;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export default function TemplateForm() {
  const { id } = useParams();
  const isNew = !id;
  const isAdmin = useIsAdmin();
  const readOnly = !isAdmin;
  const navigate = useNavigate();
  const toast = useToast();

  const form = useForm(EMPTY);
  const { values, errors } = form;
  const [template, setTemplate] = useState(null);
  const [lines, setLines] = useState([]);
  const [plans, setPlans] = useState([]);
  const [terms, setTerms] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const apply = (tpl) => {
    setTemplate(tpl);
    form.setValues({
      name: tpl.name, validity_days: tpl.validity_days, plan_id: tpl.plan_id, payment_term_id: tpl.payment_term_id || '',
      notes: tpl.notes || '', is_active: !!tpl.is_active,
    });
    setLines(tpl.lines.map((l) => ({
      key: newKey(), product_id: l.product_id, variant_id: l.variant_id || '', description: l.description || '', quantity: l.quantity,
    })));
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.get('/catalog/plans/options'),
      api.get('/catalog/payment-terms', { active: '1', limit: 100, sort: 'due_days' }),
      api.get('/catalog/products/options'),
      isNew ? Promise.resolve(null) : api.get(`/catalog/templates/${id}`),
    ]).then(([p, t, prods, tpl]) => {
      if (cancelled) return;
      setPlans(p.items);
      setTerms(t.items);
      // Keep archived products that are already on this template selectable/priced.
      const extra = (tpl?.lines || [])
        .filter((l) => !prods.items.some((x) => x.id === l.product_id))
        .map((l) => ({
          id: l.product_id, name: `${l.product_name} (archived)`, sales_price: l.unit_price, taxes: l.taxes,
          variants: [],
        }));
      setProducts([...prods.items, ...extra.filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i)]);
      if (tpl) apply(tpl);
      else {
        form.setValues(EMPTY);
        setLines([{ key: newKey(), product_id: '', variant_id: '', description: '', quantity: 1 }]);
      }
      setLoadError(null);
    }).catch((err) => { if (!cancelled) setLoadError(err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const productById = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);
  const plan = plans.find((p) => p.id === Number(values.plan_id))
    || (template && template.plan && template.plan.id === Number(values.plan_id) ? { ...template.plan, archived: true } : null);

  // Live pricing (mirrors the API: unit = sales price + variant extra, tax on qty * unit)
  const priced = lines.map((l) => {
    const p = productById[Number(l.product_id)];
    const v = p?.variants.find((x) => x.id === Number(l.variant_id));
    const qty = Number(l.quantity) || 0;
    const unit = p ? (v ? v.final_price : Number(p.sales_price)) : 0;
    const subtotal = round2(unit * qty);
    const tax = round2(lineTax(p?.taxes, subtotal, qty));
    return { ...l, product: p, unit, subtotal, tax, total: round2(subtotal + tax) };
  });
  const totals = {
    untaxed: round2(priced.reduce((s, l) => s + l.subtotal, 0)),
    tax: round2(priced.reduce((s, l) => s + l.tax, 0)),
  };
  totals.total = round2(totals.untaxed + totals.tax);

  const updateLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, { key: newKey(), product_id: '', variant_id: '', description: '', quantity: Math.max(1, plan?.min_quantity || 1) }]);
  const removeLine = (key) => setLines((ls) => ls.filter((l) => l.key !== key));

  const submit = async (e) => {
    e.preventDefault();
    if (readOnly) return;
    setBusy(true);
    setSaveError(null);
    try {
      const body = {
        ...values,
        validity_days: Number(values.validity_days) || values.validity_days,
        plan_id: values.plan_id ? Number(values.plan_id) : null,
        payment_term_id: values.payment_term_id ? Number(values.payment_term_id) : null,
        lines: lines.map((l) => ({
          product_id: l.product_id ? Number(l.product_id) : null,
          variant_id: l.variant_id ? Number(l.variant_id) : null,
          description: l.description || null,
          quantity: l.quantity === '' ? null : Number(l.quantity),
        })),
      };
      const saved = isNew ? await api.post('/catalog/templates', body) : await api.put(`/catalog/templates/${id}`, body);
      toast.success(`${saved.name} ${isNew ? 'created' : 'saved'}`);
      if (isNew) navigate(`/catalog/templates/${saved.id}`, { replace: true });
      else apply(saved);
    } catch (err) {
      setSaveError(err.message);
      form.setErrors(err.fields || {});
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (active) => {
    setBusy(true);
    try {
      apply(await api.patch(`/catalog/templates/${id}/${active ? 'restore' : 'archive'}`));
      toast.success(active ? 'Template restored' : 'Template archived');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.delete(`/catalog/templates/${id}`);
      toast.success('Template deleted');
      navigate('/catalog/templates');
    } catch (err) {
      toast.error(err.message);
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner />;
  if (loadError) {
    return (
      <div className="stack">
        <ErrorBanner error={loadError} />
        <Link to="/catalog/templates">Back to templates</Link>
      </div>
    );
  }

  const lineErr = (i, f) => errors[`lines.${i}.${f}`];

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <PageHeader
        title={isNew ? 'New quotation template' : template?.name}
        subtitle={(
          <>
            <Link to="/catalog/templates">Quotation templates</Link>
            {' / '}
            {isNew ? 'New' : <>Template #{id} {template && <ActiveBadge active={template.is_active} />}</>}
          </>
        )}
        actions={!readOnly && (
          <>
            {!isNew && template?.is_active ? <button type="button" className="btn ghost" disabled={busy} onClick={() => setActive(false)}>Archive</button> : null}
            {!isNew && template && !template.is_active ? <button type="button" className="btn ghost" disabled={busy} onClick={() => setActive(true)}>Restore</button> : null}
            {!isNew && <button type="button" className="btn ghost" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete</button>}
            <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving...' : 'Save template'}</button>
          </>
        )}
      />
      {readOnly && <ReadOnlyNote what="template" />}
      <ErrorBanner error={saveError} />

      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} className="stack">
        <Card title="Template">
          <div className="form-grid">
            <FormField label="Name" required error={errors.name}>
              <input autoFocus={isNew} {...form.bind('name')} placeholder="e.g. Enterprise Yearly Bundle" />
            </FormField>
            <FormField label="Quotation valid for (days)" required error={errors.validity_days} hint="Quotations made from this template expire after this many days">
              <input type="number" min="1" step="1" {...form.bind('validity_days')} />
            </FormField>
            <FormField
              label="Recurring plan"
              required
              error={errors.plan_id}
              hint={plan ? `${periodLabel(plan.billing_period, plan.billing_interval)} billing, minimum quantity ${plan.min_quantity}${plan.available === false ? ' (not available today)' : ''}` : undefined}
            >
              <select {...form.bind('plan_id')}>
                <option value="">Choose a plan...</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({periodLabel(p.billing_period, p.billing_interval)}){p.available ? '' : ' - not available now'}</option>
                ))}
                {plan?.archived && <option value={plan.id}>{plan.name} (archived)</option>}
              </select>
            </FormField>
            <FormField label="Payment term" error={errors.payment_term_id} hint="Optional default for subscriptions made from this template">
              <select {...form.bind('payment_term_id')}>
                <option value="">No default</option>
                {terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                {template?.payment_term && !terms.some((t) => t.id === template.payment_term_id) && (
                  <option value={template.payment_term_id}>{template.payment_term_name} (archived)</option>
                )}
              </select>
            </FormField>
            <FormField label="Notes" error={errors.notes} className="span-2">
              <textarea rows={2} {...form.bind('notes')} placeholder="What this bundle is for" />
            </FormField>
          </div>
        </Card>

        <Card
          title="Product lines"
          actions={!readOnly && <button type="button" className="btn ghost sm" onClick={addLine}>Add line</button>}
        >
          {errors.lines && <div className="alert alert-error">{errors.lines}</div>}
          <div className="table-wrap">
            <table className="line-editor">
              <thead>
                <tr>
                  <th style={{ minWidth: 180 }}>Product</th>
                  <th style={{ minWidth: 150 }}>Variant</th>
                  <th>Description</th>
                  <th className="num" style={{ width: 90 }}>Qty</th>
                  <th className="num">Unit price</th>
                  <th className="num">Taxes</th>
                  <th className="num">Subtotal</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {priced.map((l, i) => {
                  const variants = l.product?.variants || [];
                  const belowMin = plan && Number(l.quantity) > 0 && Number(l.quantity) < plan.min_quantity;
                  return (
                    <tr key={l.key}>
                      <td data-label="Product">
                        <select
                          className={`input ${lineErr(i, 'product_id') ? 'err' : ''}`}
                          value={l.product_id}
                          onChange={(e) => updateLine(l.key, { product_id: e.target.value ? Number(e.target.value) : '', variant_id: '' })}
                        >
                          <option value="">Choose...</option>
                          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        {lineErr(i, 'product_id') && <span className="cell-error">{lineErr(i, 'product_id')}</span>}
                      </td>
                      <td data-label="Variant">
                        <select
                          className={`input ${lineErr(i, 'variant_id') ? 'err' : ''}`}
                          value={l.variant_id}
                          disabled={!variants.length}
                          onChange={(e) => updateLine(l.key, { variant_id: e.target.value ? Number(e.target.value) : '' })}
                        >
                          <option value="">{variants.length ? 'Base product' : 'No variants'}</option>
                          {variants.map((v) => (
                            <option key={v.id} value={v.id}>{v.name}{v.extra_price ? ` (+${formatMoney(v.extra_price)})` : ''}</option>
                          ))}
                        </select>
                        {lineErr(i, 'variant_id') && <span className="cell-error">{lineErr(i, 'variant_id')}</span>}
                      </td>
                      <td data-label="Description">
                        <input className="input" value={l.description} onChange={(e) => updateLine(l.key, { description: e.target.value })} placeholder="Optional" />
                      </td>
                      <td data-label="Qty" className="num">
                        <input
                          className={`input ${lineErr(i, 'quantity') ? 'err' : ''}`}
                          type="number"
                          min="1"
                          step="1"
                          value={l.quantity}
                          onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                          style={{ textAlign: 'right' }}
                        />
                        {lineErr(i, 'quantity') && <span className="cell-error">{lineErr(i, 'quantity')}</span>}
                        {!lineErr(i, 'quantity') && belowMin && <span className="cell-error" style={{ color: 'var(--warning)' }}>Plan minimum is {plan.min_quantity}</span>}
                      </td>
                      <td data-label="Unit price" className="num cat-num">{l.product ? formatMoney(l.unit) : '-'}</td>
                      <td data-label="Taxes" className="num">
                        {l.product ? (
                          <span className="cat-num">
                            {formatMoney(l.tax)}
                            <span className="cat-sub">{(l.product.taxes || []).map((t) => t.name).join(', ') || 'No tax'}</span>
                          </span>
                        ) : '-'}
                      </td>
                      <td data-label="Subtotal" className="num cat-num"><strong>{formatMoney(l.subtotal)}</strong></td>
                      <td className="num">
                        {!readOnly && (
                          <button type="button" className="btn ghost sm" onClick={() => removeLine(l.key)} disabled={lines.length <= 1} title="Remove line">
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ marginTop: 12, alignItems: 'flex-start' }}>
            <p className="muted" style={{ margin: 0, flex: 1 }}>
              Prices are a preview based on today&apos;s catalog. Subscriptions copy them when the template is used.
            </p>
            <div className="totals-box">
              <div className="t-row"><span className="muted">Untaxed amount</span><span className="cat-num">{formatMoney(totals.untaxed)}</span></div>
              <div className="t-row"><span className="muted">Taxes</span><span className="cat-num">{formatMoney(totals.tax)}</span></div>
              <div className="t-row grand"><span>Total per period</span><span className="cat-num">{formatMoney(totals.total)}</span></div>
            </div>
          </div>
        </Card>
      </fieldset>

      {!readOnly && (
        <div className="form-actions">
          <Link to="/catalog/templates" className="btn ghost">Cancel</Link>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving...' : 'Save template'}</button>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete template?"
        message="This permanently deletes the template. Templates already used by subscriptions can only be archived."
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </form>
  );
}
