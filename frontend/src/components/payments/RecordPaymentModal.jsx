// Record a payment against a confirmed invoice (owner: Merryl).
//   import RecordPaymentModal from '../../components/payments/RecordPaymentModal.jsx';
//   <RecordPaymentModal open={open} invoice={{ id, number, balance_due }} onClose={...} onSaved={(payment) => reload()} />
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api/client';
import { ErrorBanner, FormField, Modal, useToast } from '../ui';
import { formatMoney } from '../../utils/format';

export const PAYMENT_METHODS = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'upi', label: 'UPI' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
];

const todayIso = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const balanceOf = (invoice) => {
  if (!invoice) return 0;
  if (invoice.balance_due !== undefined && invoice.balance_due !== null) return Number(invoice.balance_due) || 0;
  return Math.round(((Number(invoice.total_amount) || 0) - (Number(invoice.amount_paid) || 0)) * 100) / 100;
};

function initialForm(invoice) {
  const balance = balanceOf(invoice);
  return {
    method: 'bank_transfer',
    amount: balance > 0 ? balance.toFixed(2) : '',
    payment_date: todayIso(),
    reference: '',
    note: '',
  };
}

export default function RecordPaymentModal({ open, invoice, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(() => initialForm(invoice));
  const [fields, setFields] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(initialForm(invoice));
      setFields({});
      setError(null);
    }
  }, [open, invoice?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const balance = balanceOf(invoice);

  const submit = async (e) => {
    e?.preventDefault();
    if (!invoice) return;
    const errs = {};
    const amount = Number(form.amount);
    if (!(amount > 0)) errs.amount = 'Enter an amount greater than 0';
    else if (Math.round(amount * 100) > Math.round(balance * 100)) errs.amount = `Cannot exceed the balance of ${formatMoney(balance)}`;
    if (!form.payment_date) errs.payment_date = 'Payment date is required';
    else if (form.payment_date > todayIso()) errs.payment_date = 'Payment date cannot be in the future';
    setFields(errs);
    if (Object.keys(errs).length) return;

    setBusy(true);
    setError(null);
    try {
      const payment = await api.post('/payments', {
        invoice_id: invoice.id,
        method: form.method,
        amount,
        payment_date: form.payment_date,
        reference: form.reference.trim() || undefined,
        note: form.note.trim() || undefined,
      });
      toast.success(`Payment of ${formatMoney(amount)} recorded for ${invoice.number || 'invoice'}`);
      onSaved?.(payment);
      onClose?.();
    } catch (err) {
      if (err instanceof ApiError && err.fields && Object.keys(err.fields).length) setFields(err.fields);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={`Record payment${invoice?.number ? ` - ${invoice.number}` : ''}`}
      onClose={busy ? undefined : onClose}
      footer={(
        <>
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="record-payment-form" className="btn primary" disabled={busy || !invoice}>
            {busy ? 'Saving...' : 'Record payment'}
          </button>
        </>
      )}
    >
      <ErrorBanner error={error} />
      {invoice && (
        <div className="payment-summary">
          {invoice.customer_name && <div><span className="muted">Customer</span><strong>{invoice.customer_name}</strong></div>}
          {invoice.total_amount !== undefined && <div><span className="muted">Invoice total</span><strong>{formatMoney(invoice.total_amount)}</strong></div>}
          <div><span className="muted">Balance due</span><strong>{formatMoney(balance)}</strong></div>
        </div>
      )}
      <form id="record-payment-form" className="form-grid" onSubmit={submit} noValidate>
        <FormField label="Method" error={fields.method} required>
          <select className="input" value={form.method} onChange={set('method')}>
            {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </FormField>
        <FormField label="Amount" error={fields.amount} required>
          <input className="input" type="number" min="0.01" step="0.01" value={form.amount} onChange={set('amount')} />
        </FormField>
        <FormField label="Payment date" error={fields.payment_date} required>
          <input className="input" type="date" max={todayIso()} value={form.payment_date} onChange={set('payment_date')} />
        </FormField>
        <FormField label="Reference" error={fields.reference} hint="UTR, cheque number...">
          <input className="input" value={form.reference} maxLength={100} onChange={set('reference')} />
        </FormField>
        <FormField label="Note" error={fields.note} className="span-2">
          <textarea className="input" rows={2} value={form.note} maxLength={500} onChange={set('note')} />
        </FormField>
        {fields.invoice_id && <div className="span-2 alert alert-error">{fields.invoice_id}</div>}
      </form>
      <style>{`
        .payment-summary { display: flex; flex-wrap: wrap; gap: 8px 24px; padding: 10px 12px; margin-bottom: 14px;
          background: #fafafa; border: 1px solid var(--border); border-radius: 8px; }
        .payment-summary > div { display: flex; flex-direction: column; font-size: 13px; }
        .payment-summary strong { font-size: 15px; }
      `}</style>
    </Modal>
  );
}
