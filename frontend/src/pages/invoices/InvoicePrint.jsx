// Printable invoice (owner: Swathy).
// Works for staff (/invoices/:id/print -> GET /api/invoices/:id)
// and customers (/portal/invoices/:id/print -> GET /api/portal/invoices/:id).
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { formatDate, formatMoney } from '../../utils/format';

const styles = `
.invoice-print { max-width: 860px; margin: 24px auto; background: #fff; color: #1f2430; padding: 40px 48px;
  border: 1px solid #e5e7eb; border-radius: 10px; box-shadow: 0 1px 3px rgba(16,24,40,.08); font-size: 14px; }
.invoice-print h1 { margin: 0; font-size: 26px; color: #714b67; }
.invoice-print .ip-head { display: flex; justify-content: space-between; gap: 24px; border-bottom: 3px solid #714b67; padding-bottom: 16px; }
.invoice-print .ip-title { text-align: right; }
.invoice-print .ip-title h2 { margin: 0; font-size: 22px; letter-spacing: .08em; text-transform: uppercase; }
.invoice-print .ip-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 24px 0; }
.invoice-print .ip-label { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #6b7280; margin-bottom: 4px; }
.invoice-print table { width: 100%; border-collapse: collapse; }
.invoice-print th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #6b7280;
  border-bottom: 1px solid #d1d5db; padding: 8px 6px; }
.invoice-print td { padding: 8px 6px; border-bottom: 1px solid #f0f1f3; vertical-align: top; }
.invoice-print .num { text-align: right; white-space: nowrap; }
.invoice-print .ip-bottom { display: grid; grid-template-columns: 1fr 300px; gap: 24px; margin-top: 20px; align-items: start; }
.invoice-print .ip-totals td { border: 0; padding: 4px 6px; }
.invoice-print .ip-grand td { border-top: 2px solid #1f2430; font-size: 16px; font-weight: 700; padding-top: 8px; }
.invoice-print .ip-balance td { font-weight: 700; color: #714b67; }
.invoice-print .ip-foot { margin-top: 36px; color: #6b7280; font-size: 12px; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 12px; }
.invoice-print .ip-stamp { display: inline-block; border: 2px solid currentColor; border-radius: 6px; padding: 2px 10px;
  font-weight: 700; letter-spacing: .1em; text-transform: uppercase; margin-top: 6px; }
.ip-toolbar { max-width: 860px; margin: 16px auto 0; display: flex; gap: 8px; justify-content: flex-end; padding: 0 8px; }
@media (max-width: 640px) {
  .invoice-print { padding: 20px; margin: 8px; }
  .invoice-print .ip-meta, .invoice-print .ip-bottom { grid-template-columns: 1fr; }
  .invoice-print .ip-head { flex-direction: column; }
  .invoice-print .ip-title { text-align: left; }
}
@media print {
  body { background: #fff !important; }
  .ip-toolbar { display: none !important; }
  .invoice-print { border: 0; box-shadow: none; margin: 0; padding: 0; max-width: none; }
}
`;

const STAMP = { paid: '#16794c', cancelled: '#b42318', draft: '#6b7280', overdue: '#b42318' };

export default function InvoicePrint() {
  const { id } = useParams();
  const location = useLocation();
  const isPortal = location.pathname.startsWith('/portal/');
  const [inv, setInv] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get(isPortal ? `/portal/invoices/${id}` : `/invoices/${id}`).then(setInv).catch(setError);
  }, [id, isPortal]);

  useEffect(() => {
    if (!inv) return undefined;
    document.title = `Invoice ${inv.number}`;
    // ?autoprint=1 opens the print dialog as soon as the invoice is rendered
    if (new URLSearchParams(location.search).get('autoprint') === '1') {
      const t = setTimeout(() => window.print(), 300);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [inv]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="alert alert-error" style={{ margin: 24 }}>{error.message}</div>;
  if (!inv) return <div className="page-loading">Loading invoice...</div>;

  const customer = inv.customer || { name: inv.customer_name };
  const lines = inv.lines || [];
  const breakdown = inv.tax_breakdown || [];
  const discounts = inv.discounts || [];
  const balance = inv.status === 'cancelled' ? 0 : Number(inv.balance_due ?? (inv.total_amount - inv.amount_paid));
  const stampKey = inv.is_overdue ? 'overdue' : inv.status;
  const back = isPortal ? `/portal/invoices/${inv.id}` : `/invoices/${inv.id}`;

  return (
    <>
      <style>{styles}</style>
      <div className="ip-toolbar no-print">
        <Link className="btn ghost" to={back}>Back</Link>
        <button type="button" className="btn primary" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>
      <article className="invoice-print">
        <header className="ip-head">
          <div>
            <h1>Brightloop Software</h1>
            <div className="muted">Subscription &amp; billing services</div>
            <div>Kochi, Kerala, India</div>
            <div>billing@brightloop.test</div>
          </div>
          <div className="ip-title">
            <h2>{inv.status === 'draft' ? 'Draft invoice' : 'Tax invoice'}</h2>
            <div><strong>{inv.number}</strong></div>
            {STAMP[stampKey] && <div className="ip-stamp" style={{ color: STAMP[stampKey] }}>{stampKey}</div>}
          </div>
        </header>

        <section className="ip-meta">
          <div>
            <div className="ip-label">Bill to</div>
            <div><strong>{customer.name}</strong></div>
            {customer.company_name && <div>{customer.company_name}</div>}
            {customer.billing_address && <div>{customer.billing_address}</div>}
            {(customer.city || customer.state) && <div>{[customer.city, customer.state].filter(Boolean).join(', ')}</div>}
            {customer.country && <div>{customer.country}</div>}
            {customer.email && <div>{customer.email}</div>}
            {customer.phone && <div>{customer.phone}</div>}
            {customer.tax_id && <div>GSTIN: {customer.tax_id}</div>}
          </div>
          <div>
            <table>
              <tbody>
                <tr><td className="muted">Invoice date</td><td className="num">{formatDate(inv.invoice_date)}</td></tr>
                <tr><td className="muted">Due date</td><td className="num">{formatDate(inv.due_date)}</td></tr>
                {inv.period_start && <tr><td className="muted">Billing period</td><td className="num">{formatDate(inv.period_start)} - {formatDate(inv.period_end)}</td></tr>}
                {inv.subscription_number && <tr><td className="muted">Subscription</td><td className="num">{inv.subscription_number}</td></tr>}
                {inv.plan_name && <tr><td className="muted">Plan</td><td className="num">{inv.plan_name}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th className="num">Qty</th>
              <th className="num">Unit price</th>
              <th className="num">Discount</th>
              <th className="num">Taxable</th>
              <th>Taxes</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td>{l.description}</td>
                <td className="num">{l.quantity}</td>
                <td className="num">{formatMoney(l.unit_price)}</td>
                <td className="num">{Number(l.discount_amount) ? `- ${formatMoney(l.discount_amount)}` : '-'}</td>
                <td className="num">{formatMoney(l.subtotal)}</td>
                <td>{(l.taxes || []).map((t) => t.name).join(', ') || '-'}</td>
                <td className="num">{formatMoney(l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="ip-bottom">
          <div>
            {breakdown.length > 0 && (
              <>
                <div className="ip-label" style={{ marginTop: 4 }}>Tax summary</div>
                <table>
                  <thead><tr><th>Tax</th><th className="num">Taxable value</th><th className="num">Tax</th></tr></thead>
                  <tbody>
                    {breakdown.map((t) => (
                      <tr key={t.name}><td>{t.name}</td><td className="num">{formatMoney(t.base)}</td><td className="num">{formatMoney(t.amount)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {discounts.length > 0 && (
              <>
                <div className="ip-label" style={{ marginTop: 16 }}>Discounts</div>
                <table>
                  <tbody>
                    {discounts.map((d) => <tr key={d.id ?? d.name}><td>{d.name}</td><td className="num">- {formatMoney(d.amount)}</td></tr>)}
                  </tbody>
                </table>
              </>
            )}
          </div>
          <table className="ip-totals">
            <tbody>
              {Number(inv.discount_amount) > 0 && <tr><td>Discount</td><td className="num">- {formatMoney(inv.discount_amount)}</td></tr>}
              <tr><td>Untaxed amount</td><td className="num">{formatMoney(inv.untaxed_amount)}</td></tr>
              <tr><td>Taxes</td><td className="num">{formatMoney(inv.tax_amount)}</td></tr>
              <tr className="ip-grand"><td>Total</td><td className="num">{formatMoney(inv.total_amount)}</td></tr>
              <tr><td>Amount paid</td><td className="num">{formatMoney(inv.amount_paid)}</td></tr>
              <tr className="ip-balance"><td>Balance due</td><td className="num">{formatMoney(balance)}</td></tr>
            </tbody>
          </table>
        </section>

        <footer className="ip-foot">
          Thank you for your business. Please quote {inv.number} with your payment.
          <br />
          Brightloop Software &middot; This is a computer-generated invoice.
        </footer>
      </article>
    </>
  );
}
