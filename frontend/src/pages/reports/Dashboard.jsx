// Home page for admin/staff: KPIs, revenue trend, overdue invoices, subscription mix, quick links.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Card, ErrorBanner, PageHeader, Spinner, StatCard, StatusBadge } from '../../components/ui';
import { formatDate, formatMoney } from '../../utils/format';
import RecordPaymentModal from '../../components/payments/RecordPaymentModal.jsx';
import InvoicePickerModal from '../../components/payments/InvoicePickerModal.jsx';
import { ReportStyles, RevenueBars, ShareBar, Timing, presetRange } from './reportKit.jsx';

const SUB_STATUSES = [
  ['active', 'success'], ['paused', 'warning'], ['confirmed', 'brand'], ['quotation', 'brand'], ['draft', 'brand'], ['closed', 'danger'],
];

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [months, setMonths] = useState(12);
  const [picker, setPicker] = useState(false);
  const [payInvoice, setPayInvoice] = useState(null);

  const load = useCallback(() => {
    const month = presetRange('this_month');
    const started = performance.now();
    Promise.all([
      api.get('/reports/summary'),
      api.get('/reports/summary', month),
      api.get('/reports/revenue', { months }),
      api.get('/reports/overdue', { limit: 5 }),
    ])
      .then(([overall, thisMonth, revenue, overdue]) => {
        setData({ overall, thisMonth, revenue, overdue, roundTrip: Math.round(performance.now() - started) });
        setError(null);
      })
      .catch(setError);
  }, [months]);

  useEffect(() => { load(); }, [load]);

  if (error && !data) return <><PageHeader title="Dashboard" /><ErrorBanner error={error} /></>;
  if (!data) return <Spinner label="Loading dashboard..." />;

  const { overall, thisMonth, revenue, overdue } = data;
  const subs = overall.subscriptions;
  const maxStatus = Math.max(1, ...SUB_STATUSES.map(([s]) => subs[s] || 0));
  const serverMs = Math.round((overall.generated_ms + thisMonth.generated_ms + revenue.generated_ms + overdue.generated_ms) * 10) / 10;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <ReportStyles />
      <PageHeader
        title={`Welcome back${user?.name ? `, ${user.name.split(' ')[0]}` : ''}`}
        subtitle={`Finance overview as of ${formatDate(overall.as_of)}`}
        actions={(
          <>
            <Timing ms={serverMs} />
            <button type="button" className="btn ghost" onClick={load}>Refresh</button>
            <Link className="btn ghost" to="/reports">Full reports</Link>
          </>
        )}
      />
      <ErrorBanner error={error} />

      <div className="rk-kpis">
        <StatCard label="Active subscriptions" value={subs.active.toLocaleString('en-IN')} hint={`${subs.total.toLocaleString('en-IN')} in total`} />
        <StatCard label="MRR" value={formatMoney(overall.mrr)} hint="Monthly recurring revenue" tone="success" />
        <StatCard label="Invoiced this month" value={formatMoney(thisMonth.revenue.invoiced)} hint={`${thisMonth.revenue.invoiced_count} invoices`} />
        <StatCard label="Collected this month" value={formatMoney(thisMonth.revenue.collected)} hint={`${thisMonth.revenue.payments_count} payments`} tone="success" />
        <StatCard label="Outstanding" value={formatMoney(overall.revenue.outstanding)} hint={`${overall.revenue.outstanding_count} open invoices`} tone="warning" />
        <StatCard label="Overdue" value={formatMoney(overall.revenue.overdue_amount)} hint={`${overall.revenue.overdue_count} invoices past due`} tone="danger" />
      </div>

      <div className="rk-grid">
        <Card
          title="Revenue"
          actions={(
            <select className="input" value={months} onChange={(e) => setMonths(Number(e.target.value))} aria-label="Months">
              <option value={6}>Last 6 months</option>
              <option value={12}>Last 12 months</option>
            </select>
          )}
        >
          <RevenueBars items={revenue.items} height={300} />
          <div className="row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
            <span className="muted">Invoiced <strong style={{ color: 'var(--text)' }}>{formatMoney(revenue.totals.invoiced)}</strong></span>
            <span className="muted">Collected <strong style={{ color: 'var(--text)' }}>{formatMoney(revenue.totals.collected)}</strong></span>
          </div>
        </Card>

        <div className="stack">
          <Card title="Quick actions">
            <div className="rk-quick">
              <button type="button" className="btn primary" onClick={() => navigate('/subscriptions/new')}>+ New subscription</button>
              <button type="button" className="btn ghost" onClick={() => navigate('/billing')}>Run billing</button>
              <button type="button" className="btn ghost" onClick={() => setPicker(true)}>Record payment</button>
              <button type="button" className="btn ghost" onClick={() => navigate('/invoices')}>View invoices</button>
            </div>
          </Card>
          <Card title="Subscriptions by status">
            <ul className="rk-status-list">
              {SUB_STATUSES.map(([status, tone]) => (
                <li key={status}>
                  <span><StatusBadge status={status} /></span>
                  <ShareBar value={subs[status] || 0} max={maxStatus} tone={tone} />
                  <span>{(subs[status] || 0).toLocaleString('en-IN')}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <Card
        title="Most overdue invoices"
        actions={<Link to="/reports?tab=overdue" className="btn link">See all {overdue.total.toLocaleString('en-IN')}</Link>}
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Due date</th>
                <th className="num">Days overdue</th>
                <th className="num">Balance</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {overdue.items.length === 0 && <tr><td colSpan={6} className="muted center">No overdue invoices. Nice.</td></tr>}
              {overdue.items.map((inv) => (
                <tr key={inv.id}>
                  <td><Link to={`/invoices/${inv.id}`}><strong>{inv.number}</strong></Link></td>
                  <td>{inv.customer_name}</td>
                  <td>{formatDate(inv.due_date)}</td>
                  <td className="num"><StatusBadge status="overdue" label={`${inv.days_overdue} days`} /></td>
                  <td className="num">{formatMoney(inv.balance)}</td>
                  <td className="num">
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => setPayInvoice({ ...inv, balance_due: inv.balance })}
                    >
                      Record payment
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <InvoicePickerModal open={picker} onClose={() => setPicker(false)} onPick={(inv) => { setPicker(false); setPayInvoice(inv); }} />
      <RecordPaymentModal open={Boolean(payInvoice)} invoice={payInvoice} onClose={() => setPayInvoice(null)} onSaved={load} />
    </div>
  );
}
