// Invoice detail (owner: Swathy). Payments are recorded through Merryl's RecordPaymentModal.
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import {
  Card, ConfirmDialog, DataTable, ErrorBanner, PageHeader, Spinner, StatusBadge, StatCard, useToast,
} from '../../components/ui';
import { capitalize, formatDate, formatMoney } from '../../utils/format';
import RecordPaymentModal from '../../components/payments/RecordPaymentModal.jsx';

const FLOW = ['draft', 'confirmed', 'paid'];

const ACTIONS = {
  confirm: { title: 'Confirm invoice?', message: 'Confirmed invoices are final and can be sent and paid.', label: 'Confirm' },
  send: { title: 'Send invoice?', message: 'The customer receives the invoice by email with a link to view and print it.', label: 'Send' },
  cancel: { title: 'Cancel invoice?', message: 'The invoice is voided and its billing period is freed. Discounts it used are released.', label: 'Cancel invoice', danger: true },
};

export default function InvoiceDetail() {
  const { id } = useParams();
  const toast = useToast();
  const [inv, setInv] = useState(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null);
  const [rebill, setRebill] = useState(false);
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);

  const load = useCallback(() => {
    api.get(`/invoices/${id}`).then((d) => { setInv(d); setError(null); }).catch(setError);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const run = async () => {
    setBusy(true);
    try {
      const body = pending === 'cancel' ? { rebill } : {};
      const updated = await api.post(`/invoices/${id}/${pending}`, body);
      setInv(updated);
      toast.success(pending === 'send' ? `Invoice emailed to ${updated.customer.email}` : `Invoice ${updated.status}`);
      setPending(null);
      setRebill(false);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorBanner error={error} />;
  if (!inv) return <Spinner />;

  const canPay = inv.status === 'confirmed' && inv.balance_due > 0;
  const canCancel = ['draft', 'confirmed'].includes(inv.status) && Number(inv.amount_paid) === 0;
  const flowIdx = FLOW.indexOf(inv.status);

  const lineColumns = [
    { key: 'description', label: 'Description', render: (l) => <><strong>{l.description}</strong>{l.product_name && l.product_name !== l.description && <div className="muted" style={{ fontSize: 12 }}>{l.product_name}</div>}</> },
    { key: 'quantity', label: 'Qty', align: 'right' },
    { key: 'unit_price', label: 'Unit price', align: 'right', render: (l) => formatMoney(l.unit_price) },
    { key: 'discount_amount', label: 'Discount', align: 'right', render: (l) => (Number(l.discount_amount) ? `- ${formatMoney(l.discount_amount)}` : '-') },
    { key: 'subtotal', label: 'Subtotal', align: 'right', render: (l) => formatMoney(l.subtotal) },
    { key: 'taxes', label: 'Taxes', render: (l) => (l.taxes.length ? l.taxes.map((t) => `${t.name}: ${formatMoney(t.amount)}`).join(', ') : '-') },
    { key: 'total', label: 'Total', align: 'right', render: (l) => <strong>{formatMoney(l.total)}</strong> },
  ];

  const paymentColumns = [
    { key: 'payment_date', label: 'Date', render: (p) => formatDate(p.payment_date) },
    { key: 'method', label: 'Method', render: (p) => capitalize(String(p.method).replace('_', ' ')) },
    { key: 'reference', label: 'Reference', render: (p) => p.reference || '-' },
    { key: 'note', label: 'Note', render: (p) => p.note || '-' },
    { key: 'recorded_by_name', label: 'Recorded by', render: (p) => p.recorded_by_name || '-' },
    { key: 'amount', label: 'Amount', align: 'right', render: (p) => <strong>{formatMoney(p.amount)}</strong> },
  ];

  return (
    <>
      <PageHeader
        title={<>{inv.number} <StatusBadge status={inv.is_overdue ? 'overdue' : inv.status} /></>}
        subtitle={`${inv.customer.name}${inv.period_start ? ` · period ${formatDate(inv.period_start)} - ${formatDate(inv.period_end)}` : ''}`}
        actions={(
          <>
            <Link className="btn ghost" to="/invoices">Back</Link>
            <a className="btn ghost" href={`/invoices/${inv.id}/print`} target="_blank" rel="noreferrer">Print</a>
            {canCancel && <button type="button" className="btn danger" onClick={() => setPending('cancel')}>Cancel</button>}
            {['confirmed', 'paid'].includes(inv.status) && (
              <button type="button" className="btn ghost" onClick={() => setPending('send')}>{inv.sent_at ? 'Resend' : 'Send'}</button>
            )}
            {inv.status === 'draft' && <button type="button" className="btn primary" onClick={() => setPending('confirm')}>Confirm</button>}
            {canPay && <button type="button" className="btn success" onClick={() => setPaying(true)}>Record payment</button>}
          </>
        )}
      />

      <Card>
        {inv.status === 'cancelled' ? (
          <div className="alert alert-info">Cancelled on {formatDate(inv.cancelled_at)}. This invoice no longer counts towards revenue.</div>
        ) : (
          <div className="status-flow">
            {FLOW.map((s, i) => (
              <span key={s} className={`status-step ${i < flowIdx ? 'done' : ''} ${i === flowIdx ? 'current' : ''}`}>{capitalize(s)}</span>
            ))}
          </div>
        )}
        {inv.is_overdue ? (
          <div className="alert alert-error" style={{ marginTop: 12 }}>Overdue by {inv.days_overdue} day{inv.days_overdue === 1 ? '' : 's'} (due {formatDate(inv.due_date)}).</div>
        ) : null}
      </Card>

      <div className="grid-4">
        <StatCard label="Total" value={formatMoney(inv.total_amount)} />
        <StatCard label="Paid" value={formatMoney(inv.amount_paid)} tone="success" />
        <StatCard label="Balance due" value={formatMoney(inv.status === 'cancelled' ? 0 : inv.balance_due)} tone={inv.is_overdue ? 'danger' : inv.balance_due > 0 ? 'warning' : 'success'} />
        <StatCard label="Due date" value={formatDate(inv.due_date)} hint={inv.sent_at ? `Sent ${formatDate(inv.sent_at)}` : 'Not sent yet'} />
      </div>

      <div className="grid-2">
        <Card title="Bill to">
          <dl className="dl">
            <dt>Customer</dt><dd><Link to={`/customers/${inv.customer.id}`}>{inv.customer.name}</Link>{inv.customer.company_name && <div className="muted">{inv.customer.company_name}</div>}</dd>
            <dt>Email</dt><dd>{inv.customer.email}</dd>
            {inv.customer.phone && <><dt>Phone</dt><dd>{inv.customer.phone}</dd></>}
            {(inv.customer.billing_address || inv.customer.city) && (
              <><dt>Address</dt><dd>{[inv.customer.billing_address, inv.customer.city, inv.customer.state, inv.customer.country].filter(Boolean).join(', ')}</dd></>
            )}
            {inv.customer.tax_id && <><dt>GSTIN</dt><dd>{inv.customer.tax_id}</dd></>}
          </dl>
        </Card>
        <Card title="Invoice">
          <dl className="dl">
            <dt>Invoice date</dt><dd>{formatDate(inv.invoice_date)}</dd>
            <dt>Due date</dt><dd>{formatDate(inv.due_date)}</dd>
            {inv.subscription_id && <><dt>Subscription</dt><dd><Link to={`/subscriptions/${inv.subscription_id}`}>{inv.subscription_number}</Link>{inv.plan_name && <span className="muted"> &middot; {inv.plan_name}</span>}</dd></>}
            {inv.period_start && <><dt>Billing period</dt><dd>{formatDate(inv.period_start)} - {formatDate(inv.period_end)}</dd></>}
            <dt>Created by</dt><dd>{inv.created_by_name || 'Billing run'}</dd>
            {inv.confirmed_at && <><dt>Confirmed</dt><dd>{formatDate(inv.confirmed_at)}</dd></>}
            {inv.paid_at && <><dt>Paid</dt><dd>{formatDate(inv.paid_at)}</dd></>}
          </dl>
        </Card>
      </div>

      <Card title="Lines">
        <DataTable columns={lineColumns} rows={inv.lines} />
        <div className="grid-2" style={{ marginTop: 12, alignItems: 'start' }}>
          <div>
            {inv.tax_breakdown.length > 0 && (
              <>
                <h4 style={{ margin: '0 0 6px' }}>Tax breakdown</h4>
                <table className="table">
                  <thead><tr><th>Tax</th><th style={{ textAlign: 'right' }}>Base</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                  <tbody>
                    {inv.tax_breakdown.map((t) => (
                      <tr key={t.name}><td>{t.name}</td><td style={{ textAlign: 'right' }}>{formatMoney(t.base)}</td><td style={{ textAlign: 'right' }}>{formatMoney(t.amount)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {inv.discounts.length > 0 && (
              <>
                <h4 style={{ margin: '12px 0 6px' }}>Discounts applied</h4>
                <table className="table">
                  <tbody>
                    {inv.discounts.map((d) => (
                      <tr key={d.id}>
                        <td>{d.name} <span className="muted">({d.discount_type === 'percent' ? `${d.value}%` : formatMoney(d.value)}, {d.scope})</span></td>
                        <td style={{ textAlign: 'right' }}>- {formatMoney(d.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
          <table className="table">
            <tbody>
              {Number(inv.discount_amount) > 0 && <tr><td>Discount</td><td style={{ textAlign: 'right' }}>- {formatMoney(inv.discount_amount)}</td></tr>}
              <tr><td>Untaxed amount</td><td style={{ textAlign: 'right' }}>{formatMoney(inv.untaxed_amount)}</td></tr>
              <tr><td>Taxes</td><td style={{ textAlign: 'right' }}>{formatMoney(inv.tax_amount)}</td></tr>
              <tr><td><strong>Total</strong></td><td style={{ textAlign: 'right' }}><strong>{formatMoney(inv.total_amount)}</strong></td></tr>
              <tr><td>Paid</td><td style={{ textAlign: 'right' }}>{formatMoney(inv.amount_paid)}</td></tr>
              <tr><td><strong>Balance due</strong></td><td style={{ textAlign: 'right' }}><strong>{formatMoney(inv.status === 'cancelled' ? 0 : inv.balance_due)}</strong></td></tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title={`Payments (${inv.payments.length})`}
        actions={canPay ? <button type="button" className="btn success sm" onClick={() => setPaying(true)}>Record payment</button> : null}
      >
        <DataTable columns={paymentColumns} rows={inv.payments} empty={inv.status === 'draft' ? 'Confirm the invoice to record payments' : 'No payments yet'} />
      </Card>

      {pending && (
        <ConfirmDialog
          open
          title={ACTIONS[pending].title}
          message={(
            <>
              {ACTIONS[pending].message}
              {pending === 'cancel' && inv.subscription_id && (
                <label className="field checkbox" style={{ marginTop: 12 }}>
                  <input type="checkbox" checked={rebill} onChange={(e) => setRebill(e.target.checked)} />
                  <span>Re-bill this period on the next billing run</span>
                </label>
              )}
            </>
          )}
          confirmLabel={ACTIONS[pending].label}
          danger={ACTIONS[pending].danger}
          busy={busy}
          onConfirm={run}
          onCancel={() => { setPending(null); setRebill(false); }}
        />
      )}

      <RecordPaymentModal
        open={paying}
        invoice={inv}
        onClose={() => setPaying(false)}
        onSaved={() => { setPaying(false); load(); }}
      />
    </>
  );
}
