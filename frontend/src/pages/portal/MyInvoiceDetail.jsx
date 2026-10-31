import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { Card, DataTable, ErrorBanner, PageHeader, Spinner, StatusBadge } from '../../components/ui/index.jsx';
import { capitalize, formatDate, formatMoney } from '../../utils/format.js';

const METHOD = { bank_transfer: 'Bank transfer', upi: 'UPI', cash: 'Cash', card: 'Card', cheque: 'Cheque', other: 'Other' };

export default function MyInvoiceDetail() {
  const { id } = useParams();
  const [inv, setInv] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get(`/portal/invoices/${id}`).then((d) => { setInv(d); setError(null); }).catch(setError);
  }, [id]);

  if (error) {
    return (
      <div className="stack">
        <ErrorBanner error={error.status === 404 ? 'Invoice not found.' : error} />
        <Link to="/portal/invoices">Back to my invoices</Link>
      </div>
    );
  }
  if (!inv) return <Spinner />;

  const status = inv.is_overdue ? 'overdue' : inv.status;
  const lineColumns = [
    {
      key: 'description',
      label: 'Description',
      render: (l) => <div style={{ fontWeight: 500 }}>{l.description || l.product_name}</div>,
    },
    { key: 'quantity', label: 'Qty', align: 'right' },
    { key: 'unit_price', label: 'Unit price', align: 'right', render: (l) => formatMoney(l.unit_price) },
    { key: 'discount_amount', label: 'Discount', align: 'right', render: (l) => (Number(l.discount_amount) ? `- ${formatMoney(l.discount_amount)}` : '-') },
    { key: 'taxes', label: 'Taxes', render: (l) => (l.taxes?.length ? l.taxes.map((t) => t.name || t.tax_name).join(', ') : '-') },
    { key: 'subtotal', label: 'Subtotal', align: 'right', render: (l) => formatMoney(l.subtotal) },
    { key: 'total', label: 'Total', align: 'right', render: (l) => formatMoney(l.total) },
  ];
  const paymentColumns = [
    { key: 'payment_date', label: 'Date', render: (p) => formatDate(p.payment_date) },
    { key: 'method', label: 'Method', render: (p) => METHOD[p.method] || capitalize(p.method) },
    { key: 'reference', label: 'Reference', render: (p) => p.reference || '-' },
    { key: 'amount', label: 'Amount', align: 'right', render: (p) => formatMoney(p.amount) },
  ];

  return (
    <div className="stack">
      <div><Link to="/portal/invoices">&larr; My invoices</Link></div>
      <PageHeader
        title={`Invoice ${inv.number}`}
        subtitle={inv.subscription_number ? `For subscription ${inv.subscription_number}` : undefined}
        actions={<Link className="btn ghost" to={`/portal/invoices/${inv.id}/print`} target="_blank">Print / Download</Link>}
      />
      {inv.is_overdue && (
        <div className="alert alert-error">
          This invoice is overdue{inv.days_overdue ? ` by ${inv.days_overdue} day${inv.days_overdue === 1 ? '' : 's'}` : ''}. Balance due: <strong>{formatMoney(inv.balance_due)}</strong>
        </div>
      )}

      <div className="grid-2">
        <Card title="Invoice">
          <dl className="dl">
            <dt>Status</dt><dd><StatusBadge status={status} /></dd>
            <dt>Invoice date</dt><dd>{formatDate(inv.invoice_date)}</dd>
            <dt>Due date</dt><dd>{formatDate(inv.due_date)}</dd>
            {inv.period_start && <><dt>Billing period</dt><dd>{formatDate(inv.period_start)} - {formatDate(inv.period_end)}</dd></>}
            {inv.paid_at && <><dt>Paid on</dt><dd>{formatDate(inv.paid_at)}</dd></>}
          </dl>
        </Card>
        <Card title="Amounts">
          <dl className="dl">
            <dt>Untaxed</dt><dd>{formatMoney(inv.untaxed_amount)}</dd>
            {Number(inv.discount_amount) > 0 && <><dt>Discounts</dt><dd>- {formatMoney(inv.discount_amount)}</dd></>}
            <dt>Tax</dt><dd>{formatMoney(inv.tax_amount)}</dd>
            <dt>Total</dt><dd><strong>{formatMoney(inv.total_amount)}</strong></dd>
            <dt>Paid</dt><dd>{formatMoney(inv.amount_paid)}</dd>
            <dt>Balance due</dt>
            <dd style={{ color: inv.balance_due > 0 && inv.status === 'confirmed' ? 'var(--danger)' : 'var(--success)', fontWeight: 700 }}>
              {formatMoney(inv.status === 'cancelled' ? 0 : inv.balance_due)}
            </dd>
          </dl>
        </Card>
      </div>

      <Card title="Lines">
        <DataTable columns={lineColumns} rows={inv.lines || []} empty="No lines" />
      </Card>

      {(inv.tax_breakdown?.length > 0 || inv.discounts?.length > 0) && (
        <div className="grid-2">
          {inv.tax_breakdown?.length > 0 && (
            <Card title="Taxes">
              <table className="table">
                <thead><tr><th>Tax</th><th style={{ textAlign: 'right' }}>Base</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                <tbody>
                  {inv.tax_breakdown.map((t) => (
                    <tr key={t.name}><td>{t.name}</td><td style={{ textAlign: 'right' }}>{formatMoney(t.base)}</td><td style={{ textAlign: 'right' }}>{formatMoney(t.amount)}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          {inv.discounts?.length > 0 && (
            <Card title="Discounts applied">
              <table className="table">
                <tbody>
                  {inv.discounts.map((d) => (
                    <tr key={d.id}>
                      <td>{d.name}<div className="muted" style={{ fontSize: 12 }}>{d.discount_type === 'percent' ? `${d.value}%` : formatMoney(d.value)} {d.scope === 'product' ? 'on selected products' : 'on the subscription'}</div></td>
                      <td style={{ textAlign: 'right' }}>- {formatMoney(d.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}

      <Card title="Payments">
        <DataTable columns={paymentColumns} rows={inv.payments || []} empty="No payments recorded yet" />
      </Card>
    </div>
  );
}
