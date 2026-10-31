// Create / edit a product with taxes and variants (owner: Roshan).
// Staff see the same page read-only.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { formatMoney } from '../../utils/format';
import {
  Card, PageHeader, ErrorBanner, FormField, Spinner, ConfirmDialog, useToast,
} from '../../components/ui/index.jsx';
import { useIsAdmin, useForm, ActiveBadge, ReadOnlyNote, CheckGroup, taxRateLabel } from './shared.jsx';

const EMPTY = { name: '', type: 'service', sales_price: '', cost_price: '', notes: '', tax_ids: [], is_active: true };
let keySeq = 0;
const newKey = () => `v${++keySeq}`;

/** Inline helper to create an attribute or a value without leaving the form. */
function AttributeHelper({ attributes, onCreated, onClose }) {
  const toast = useToast();
  const [attrId, setAttrId] = useState(attributes[0]?.id ? String(attributes[0].id) : 'new');
  const [attrName, setAttrName] = useState('');
  const [valueName, setValueName] = useState('');
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setFields({});
    try {
      let value;
      if (attrId === 'new') {
        const attr = await api.post('/catalog/attributes', { name: attrName, values: valueName ? [valueName] : [] });
        value = attr.values[0];
        toast.success(`Attribute ${attr.name} added`);
      } else {
        value = await api.post(`/catalog/attributes/${attrId}/values`, { name: valueName });
        toast.success(`Value ${value.name} added`);
      }
      setValueName('');
      setAttrName('');
      await onCreated(value);
    } catch (err) {
      setFields({ ...err.fields, _error: Object.keys(err.fields || {}).length ? null : err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inline-helper">
      <strong>Add attribute or value</strong>
      <div className="grid-3">
        <FormField label="Attribute">
          <select value={attrId} onChange={(e) => setAttrId(e.target.value)}>
            {attributes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            <option value="new">+ New attribute...</option>
          </select>
        </FormField>
        {attrId === 'new' && (
          <FormField label="Attribute name" error={fields.name && attrId === 'new' ? fields.name : undefined}>
            <input value={attrName} onChange={(e) => setAttrName(e.target.value)} placeholder="e.g. Edition" />
          </FormField>
        )}
        <FormField label="Value" error={attrId !== 'new' ? fields.name : fields.values} hint={attrId === 'new' ? 'Optional first value' : undefined}>
          <input value={valueName} onChange={(e) => setValueName(e.target.value)} placeholder="e.g. Odoo" />
        </FormField>
      </div>
      {fields._error && <div className="alert alert-error">{fields._error}</div>}
      <div className="row">
        <button type="button" className="btn primary sm" disabled={busy} onClick={save}>{busy ? 'Adding...' : 'Add'}</button>
        <button type="button" className="btn ghost sm" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

export default function ProductForm() {
  const { id } = useParams();
  const isNew = !id;
  const isAdmin = useIsAdmin();
  const readOnly = !isAdmin;
  const navigate = useNavigate();
  const toast = useToast();

  const form = useForm(EMPTY);
  const { values, errors } = form;
  const [product, setProduct] = useState(null);
  const [variants, setVariants] = useState([]);
  const [taxes, setTaxes] = useState([]);
  const [attributes, setAttributes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [helperOpen, setHelperOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadAttributes = useCallback(async () => {
    const res = await api.get('/catalog/attributes');
    setAttributes(res.items);
    return res.items;
  }, []);

  const applyProduct = useCallback((p) => {
    setProduct(p);
    form.setValues({
      name: p.name, type: p.type, sales_price: p.sales_price, cost_price: p.cost_price, notes: p.notes || '',
      tax_ids: p.tax_ids, is_active: !!p.is_active,
    });
    setVariants(p.variants.map((v) => ({
      key: newKey(), id: v.id, attribute_id: v.attribute_id, attribute_value_id: v.attribute_value_id,
      extra_price: v.extra_price, is_active: !!v.is_active, in_use: v.in_use,
    })));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.get('/catalog/taxes', { active: 'all', limit: 100, sort: 'name' }),
      loadAttributes(),
      isNew ? Promise.resolve(null) : api.get(`/catalog/products/${id}`),
    ]).then(([t, , p]) => {
      if (cancelled) return;
      setTaxes(t.items);
      if (p) applyProduct(p);
      else {
        form.setValues(EMPTY);
        setVariants([]);
        setProduct(null);
        // sensible default: preselect the 18% GST if present
        const gst = t.items.find((x) => x.is_active && /18/.test(x.name));
        if (gst) form.set('tax_ids', [gst.id]);
      }
      setLoadError(null);
    }).catch((err) => { if (!cancelled) setLoadError(err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const valuesByAttr = useMemo(() => Object.fromEntries(attributes.map((a) => [a.id, a.values])), [attributes]);
  const salesPrice = Number(values.sales_price) || 0;
  const margin = salesPrice - (Number(values.cost_price) || 0);

  const taxOptions = taxes
    .filter((t) => t.is_active || values.tax_ids.includes(t.id))
    .map((t) => ({ value: t.id, label: `${t.name}${t.is_active ? '' : ' (archived)'}`, hint: taxRateLabel(t, formatMoney) }));

  const updateVariant = (key, patch) => setVariants((vs) => vs.map((v) => (v.key === key ? { ...v, ...patch } : v)));
  const addVariant = () => {
    const used = new Set(variants.map((v) => v.attribute_value_id));
    const attr = attributes[0];
    const free = attr?.values.find((v) => !used.has(v.id));
    setVariants((vs) => [...vs, {
      key: newKey(), attribute_id: attr?.id || '', attribute_value_id: free?.id || '', extra_price: 0, is_active: true,
    }]);
  };
  const removeVariant = (key) => setVariants((vs) => vs.filter((v) => v.key !== key));

  const submit = async (e) => {
    e.preventDefault();
    if (readOnly) return;
    setBusy(true);
    setSaveError(null);
    try {
      const body = {
        ...values,
        sales_price: values.sales_price === '' ? null : Number(values.sales_price),
        cost_price: values.cost_price === '' ? 0 : Number(values.cost_price),
        variants: variants.map((v) => ({
          id: v.id, attribute_value_id: v.attribute_value_id ? Number(v.attribute_value_id) : null,
          extra_price: v.extra_price === '' ? 0 : Number(v.extra_price), is_active: v.is_active,
        })),
      };
      const saved = isNew ? await api.post('/catalog/products', body) : await api.put(`/catalog/products/${id}`, body);
      toast.success(`${saved.name} ${isNew ? 'created' : 'saved'}`);
      if (isNew) navigate(`/catalog/products/${saved.id}`, { replace: true });
      else applyProduct(saved);
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
      const saved = await api.patch(`/catalog/products/${id}/${active ? 'restore' : 'archive'}`);
      applyProduct(saved);
      toast.success(active ? 'Product restored' : 'Product archived');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.delete(`/catalog/products/${id}`);
      toast.success('Product deleted');
      navigate('/catalog/products');
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
        <Link to="/catalog/products">Back to products</Link>
      </div>
    );
  }

  const variantErr = (i, f) => errors[`variants.${i}.${f}`];
  const usageText = product?.usage
    ? [
      product.usage.subscription_lines && `${product.usage.subscription_lines} subscription line(s)`,
      product.usage.quotation_template_lines && `${product.usage.quotation_template_lines} template line(s)`,
      product.usage.invoice_lines && `${product.usage.invoice_lines} invoice line(s)`,
    ].filter(Boolean).join(', ')
    : '';

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <PageHeader
        title={isNew ? 'New product' : product?.name}
        subtitle={(
          <>
            <Link to="/catalog/products">Products</Link>
            {' / '}
            {isNew ? 'New' : <>Product #{id} {product && <ActiveBadge active={product.is_active} />}</>}
          </>
        )}
        actions={!readOnly && (
          <>
            {!isNew && product?.is_active ? <button type="button" className="btn ghost" disabled={busy} onClick={() => setActive(false)}>Archive</button> : null}
            {!isNew && product && !product.is_active ? <button type="button" className="btn ghost" disabled={busy} onClick={() => setActive(true)}>Restore</button> : null}
            {!isNew && <button type="button" className="btn ghost" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete</button>}
            <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving...' : 'Save product'}</button>
          </>
        )}
      />
      {readOnly && <ReadOnlyNote what="product" />}
      <ErrorBanner error={saveError} />

      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} className="stack">
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <Card title="General">
            <div className="form-grid">
              <FormField label="Name" required error={errors.name} className="span-2">
                <input autoFocus={isNew} {...form.bind('name')} placeholder="e.g. Brightloop CRM" />
              </FormField>
              <FormField label="Type" error={errors.type}>
                <select {...form.bind('type')}>
                  <option value="service">Service</option>
                  <option value="goods">Goods</option>
                  <option value="addon">Add-on</option>
                </select>
              </FormField>
              <div />
              <FormField label="Sales price (INR)" required error={errors.sales_price}>
                <input type="number" min="0" step="0.01" {...form.bind('sales_price')} />
              </FormField>
              <FormField label="Cost price (INR)" error={errors.cost_price} hint={values.sales_price !== '' ? `Margin ${formatMoney(margin)}` : undefined}>
                <input type="number" min="0" step="0.01" {...form.bind('cost_price')} />
              </FormField>
              <FormField label="Notes" error={errors.notes} className="span-2">
                <textarea rows={3} {...form.bind('notes')} placeholder="Shown to your team, e.g. what is included" />
              </FormField>
            </div>
          </Card>

          <Card title="Taxes">
            <p className="muted" style={{ marginTop: 0 }}>Default taxes copied onto subscription and invoice lines for this product.</p>
            <CheckGroup
              options={taxOptions}
              value={values.tax_ids}
              onChange={(v) => form.set('tax_ids', v)}
              disabled={readOnly}
              empty="No taxes configured yet"
            />
            {errors.tax_ids && <div className="field-error">{errors.tax_ids}</div>}
            {!isNew && usageText && <p className="muted" style={{ marginBottom: 0 }}>Used by {usageText}.</p>}
          </Card>
        </div>

        <Card
          title="Variants"
          actions={!readOnly && (
            <>
              <button type="button" className="btn ghost sm" onClick={() => setHelperOpen((o) => !o)}>
                {helperOpen ? 'Hide helper' : 'Add attribute / value'}
              </button>
              <button type="button" className="btn ghost sm" onClick={addVariant} disabled={!attributes.length}>Add variant</button>
            </>
          )}
        >
          <p className="muted" style={{ marginTop: 0 }}>
            Each variant picks one attribute value and adds an extra price on top of the sales price ({formatMoney(salesPrice)}).
          </p>
          {helperOpen && !readOnly && (
            <div style={{ marginBottom: 12 }}>
              <AttributeHelper
                attributes={attributes}
                onClose={() => setHelperOpen(false)}
                onCreated={async (value) => {
                  await loadAttributes();
                  if (value) {
                    setVariants((vs) => [...vs, {
                      key: newKey(), attribute_id: value.attribute_id, attribute_value_id: value.id, extra_price: 0, is_active: true,
                    }]);
                  }
                }}
              />
            </div>
          )}
          {variants.length === 0 ? (
            <p className="muted">No variants. The product is sold at its sales price.</p>
          ) : (
            <div className="table-wrap">
              <table className="line-editor">
                <thead>
                  <tr>
                    <th style={{ width: '24%' }}>Attribute</th>
                    <th style={{ width: '26%' }}>Value</th>
                    <th className="num" style={{ width: 160 }}>Extra price</th>
                    <th className="num">Final price</th>
                    <th style={{ width: 90 }}>Active</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {variants.map((v, i) => {
                    const vals = valuesByAttr[v.attribute_id] || [];
                    const takenElsewhere = new Set(variants.filter((x) => x.key !== v.key).map((x) => Number(x.attribute_value_id)));
                    const finalPrice = salesPrice + (Number(v.extra_price) || 0);
                    return (
                      <tr key={v.key} className={v.is_active ? '' : 'archived'}>
                        <td data-label="Attribute">
                          <select
                            className="input"
                            value={v.attribute_id}
                            onChange={(e) => {
                              const attrId = Number(e.target.value);
                              const first = (valuesByAttr[attrId] || []).find((x) => !takenElsewhere.has(x.id));
                              updateVariant(v.key, { attribute_id: attrId, attribute_value_id: first?.id || '' });
                            }}
                          >
                            <option value="">Choose...</option>
                            {attributes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        </td>
                        <td data-label="Value">
                          <select
                            className={`input ${variantErr(i, 'attribute_value_id') ? 'err' : ''}`}
                            value={v.attribute_value_id}
                            onChange={(e) => updateVariant(v.key, { attribute_value_id: Number(e.target.value) })}
                          >
                            <option value="">Choose...</option>
                            {vals.map((x) => (
                              <option key={x.id} value={x.id} disabled={takenElsewhere.has(x.id)}>{x.name}</option>
                            ))}
                          </select>
                          {variantErr(i, 'attribute_value_id') && <span className="cell-error">{variantErr(i, 'attribute_value_id')}</span>}
                        </td>
                        <td data-label="Extra price" className="num">
                          <input
                            className={`input ${variantErr(i, 'extra_price') ? 'err' : ''}`}
                            type="number"
                            min="0"
                            step="0.01"
                            value={v.extra_price}
                            onChange={(e) => updateVariant(v.key, { extra_price: e.target.value })}
                            style={{ textAlign: 'right' }}
                          />
                          {variantErr(i, 'extra_price') && <span className="cell-error">{variantErr(i, 'extra_price')}</span>}
                        </td>
                        <td data-label="Final price" className="num cat-num"><strong>{formatMoney(finalPrice)}</strong></td>
                        <td data-label="Active">
                          <label className="switch-row">
                            <input type="checkbox" checked={v.is_active} onChange={(e) => updateVariant(v.key, { is_active: e.target.checked })} />
                            {v.is_active ? 'Yes' : 'No'}
                          </label>
                        </td>
                        <td className="num">
                          {!readOnly && (
                            <button
                              type="button"
                              className="btn ghost sm"
                              onClick={() => removeVariant(v.key)}
                              title={v.in_use ? 'In use: it will be archived instead of deleted' : 'Remove variant'}
                            >
                              {v.in_use ? 'Archive' : 'Remove'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {errors.variants && <div className="field-error">{errors.variants}</div>}
        </Card>
      </fieldset>

      {!readOnly && (
        <div className="form-actions">
          <Link to="/catalog/products" className="btn ghost">Cancel</Link>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving...' : 'Save product'}</button>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete product?"
        message="This permanently deletes the product. If it is used on templates, subscriptions or invoices you will be asked to archive it instead."
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </form>
  );
}
