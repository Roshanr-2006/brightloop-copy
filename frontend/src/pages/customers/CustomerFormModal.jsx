// Create / edit customer modal shared by the list and detail pages.
import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { FormField, Modal, useToast } from '../../components/ui/index.jsx';
import { customerErrors } from '../../utils/validators.js';

const FIELDS = ['name', 'email', 'company_name', 'phone', 'billing_address', 'city', 'state', 'country', 'tax_id'];
const blank = () => ({ ...Object.fromEntries(FIELDS.map((f) => [f, ''])), country: 'India' });

export function toForm(customer) {
  if (!customer) return blank();
  return Object.fromEntries(FIELDS.map((f) => [f, customer[f] ?? '']));
}

/** Address + profile inputs (also used by the portal Profile page). */
export function CustomerFields({ form, set, fields, emailEditable = true }) {
  return (
    <>
      <FormField label="Name" required error={fields.name}>
        <input value={form.name} onChange={set('name')} autoFocus />
      </FormField>
      <FormField label="Email" required={emailEditable} error={fields.email} hint={emailEditable ? undefined : 'Contact us to change your login email.'}>
        <input type="email" value={form.email} onChange={set('email')} disabled={!emailEditable} />
      </FormField>
      <FormField label="Company" error={fields.company_name}>
        <input value={form.company_name} onChange={set('company_name')} />
      </FormField>
      <FormField label="Phone" error={fields.phone}>
        <input type="tel" value={form.phone} onChange={set('phone')} />
      </FormField>
      <FormField label="Billing address" error={fields.billing_address} className="span-2">
        <textarea rows={2} value={form.billing_address} onChange={set('billing_address')} />
      </FormField>
      <FormField label="City" error={fields.city}>
        <input value={form.city} onChange={set('city')} />
      </FormField>
      <FormField label="State" error={fields.state}>
        <input value={form.state} onChange={set('state')} />
      </FormField>
      <FormField label="Country" error={fields.country}>
        <input value={form.country} onChange={set('country')} />
      </FormField>
      <FormField label="Tax ID (GSTIN)" error={fields.tax_id}>
        <input value={form.tax_id} onChange={set('tax_id')} />
      </FormField>
    </>
  );
}

export default function CustomerFormModal({ open, customer, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(blank);
  const [fields, setFields] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setForm(toForm(customer)); setFields({}); setError(''); }
  }, [open, customer]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function save(e) {
    e?.preventDefault();
    const errs = customerErrors(form);
    setFields(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setError('');
    const body = Object.fromEntries(FIELDS.map((f) => [f, form[f].trim()]));
    try {
      const saved = customer ? await api.put(`/customers/${customer.id}`, body) : await api.post('/customers', body);
      toast.success(customer ? 'Customer updated' : `Customer ${saved.name} created`);
      onSaved(saved);
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
      wide
      title={customer ? `Edit ${customer.name}` : 'New customer'}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="customer-form" className="btn primary" disabled={busy}>{busy ? 'Saving...' : 'Save'}</button>
        </>
      )}
    >
      <form id="customer-form" className="form-grid" onSubmit={save} noValidate>
        {error && <div className="alert alert-error span-2">{error}</div>}
        <CustomerFields form={form} set={set} fields={fields} />
      </form>
    </Modal>
  );
}
