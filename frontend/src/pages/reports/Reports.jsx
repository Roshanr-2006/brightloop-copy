// Finance reports: filters, summary cards and drill-down tabs with CSV export.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import {
  Card, ErrorBanner, FormField, PageHeader, Pagination, Spinner, StatCard, StatusBadge, Tabs,
} from '../../components/ui';
import { formatDate, formatMoney } from '../../utils/format';
import {
  METHOD_LABELS, PRESETS, ReportStyles, RevenueBars, ShareBar, Timing, downloadCsv, monthLabel, presetRange,
} from './reportKit.jsx';

const TABS = [
  { value: 'revenue', label: 'Revenue' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'payments', label: 'Payments' },
  { value: 'subscriptions', label: 'Subscriptions' },
  { value: 'customers', label: 'Top customers' },
];
const SUB_STATUSES = ['active', 'paused', 'confirmed', 'quotation', 'draft', 'closed'];
const int = (n) => (Number(n) || 0).toLocaleString('en-IN');

/** Load a report whenever its params change. */
function useReport(path, params, enabled = true) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const key = JSON.stringify(params);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    api.get(path, params)
      .then((data) => { if (!cancelled) setState({ data, loading: false, error: null }); })
      .catch((error) => { if (!cancelled) setState((s) => ({ ...s, loading: false, error })); });
    return () => { cancelled = true; };
  }, [path, key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

function CustomerFilter({ value, onChange }) {
  const [text, setText] = useState('');
  const [options, setOptions] = useState([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!text.trim()) { setOptions([]); return undefined; }
    const id = setTimeout(() => {
      api.get('/customers', { search: text.trim(), limit: 8 })
        .then((d) => { setOptions(d.items || []); setOpen(true); })
        .catch(() => setOptions([]));
    }, 250);
    return () => clearTimeout(id);
  }, [text]);

  if (value) {
    return (
      <FormField label="Customer">
        <span className="rk-chip">{value.name}<button type="button" aria-label="Clear customer" onClick={() => onChange(null)}>&times;</button></span>
      </FormField>
    );
  }
  const choose = (c) => { onChange({ id: c.id, name: c.name }); setText(''); setOpen(false); };
  return (
    <div className="field rk-customer">
      <span className="field-label">Customer</span>
      <input
        type="search"
        className="input"
        placeholder="Search customer"
        aria-label="Search customer"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => options.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && options.length > 0 && (
        <div className="rk-suggest">
          {options.map((c) => (
            <button
              type="button"
              key={c.id}
              onMouseDown={(e) => { e.preventDefault(); choose(c); }}
              onKeyDown={(e) => { if (e.key === 'Enter') choose(c); }}
            >
              <strong>{c.name}</strong>{c.company_name ? <span className="muted"> &middot; {c.company_name}</span> : null}
              <div className="muted" style={{ fontSize: 12 }}>{c.email}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionHead({ title, ms, onExport, children }) {
  return (
    <div className="rk-section-head">
      <div className="row" style={{ gap: 10 }}>
        <h3>{title}</h3>
        <Timing ms={ms} />
      </div>
      <div className="row" style={{ gap: 8 }}>
        {children}
        {onExport && <button type="button" className="btn ghost sm" onClick={onExport}>Export CSV</button>}
      </div>
    </div>
  );
}

function Table({ head, children }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr>{head.map(([label, num], i) => <th key={i} className={num ? 'num' : ''}>{label}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const Loading = ({ cols }) => <tr><td colSpan={cols} className="muted center">Loading...</td></tr>;

/* ---------------------------------------------------------------- tabs */

function RevenueTab({ params }) {
  const { data, loading, error } = useReport('/reports/revenue', params);
  const items = data?.items || [];
  const csv = () => downloadCsv(`revenue_${data.from}_${data.to}.csv`, [
    { key: 'month', label: 'Month' },
    { key: 'invoiced', label: 'Invoiced' },
    { key: 'invoice_count', label: 'Invoices' },
    { key: 'collected', label: 'Collected' },
    { key: 'payment_count', label: 'Payments' },
  ], items);
  return (
    <>
      <ErrorBanner error={error} />
      <SectionHead title="Revenue by month" ms={data?.generated_ms} onExport={data ? csv : null} />
      {data && items.length > 1 && <Card><RevenueBars items={items} /></Card>}
      <div style={{ marginTop: 12 }}>
        <Table head={[['Month'], ['Invoiced', 1], ['Invoices', 1], ['Collected', 1], ['Payments', 1], ['Collection rate', 1]]}>
          {loading && !data ? <Loading cols={6} /> : items.map((r) => (
            <tr key={r.month}>
              <td>{monthLabel(r.month, true)}</td>
              <td className="num">{formatMoney(r.invoiced)}</td>
              <td className="num">{int(r.invoice_count)}</td>
              <td className="num">{formatMoney(r.collected)}</td>
              <td className="num">{int(r.payment_count)}</td>
              <td className="num">{r.invoiced > 0 ? `${Math.round((r.collected / r.invoiced) * 100)}%` : '-'}</td>
            </tr>
          ))}
          {data && (
            <tr className="rk-total-row">
              <td>Total</td>
              <td className="num">{formatMoney(data.totals.invoiced)}</td>
              <td className="num">{int(items.reduce((s, r) => s + r.invoice_count, 0))}</td>
              <td className="num">{formatMoney(data.totals.collected)}</td>
              <td className="num">{int(items.reduce((s, r) => s + r.payment_count, 0))}</td>
              <td className="num">{data.totals.invoiced > 0 ? `${Math.round((data.totals.collected / data.totals.invoiced) * 100)}%` : '-'}</td>
            </tr>
          )}
        </Table>
      </div>
    </>
  );
}

function OverdueTab({ params }) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('days');
  useEffect(() => { setPage(1); }, [JSON.stringify(params)]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data, loading, error } = useReport('/reports/overdue', { plan_id: params.plan_id, customer_id: params.customer_id, page, limit: 20, sort });
  const items = data?.items || [];
  const maxBucket = Math.max(1, ...(data?.buckets || []).map((b) => b.amount));
  const csv = () => downloadCsv(`overdue_page${data.page}.csv`, [
    { key: 'number', label: 'Invoice' },
    { key: 'customer_name', label: 'Customer' },
    { key: 'subscription_number', label: 'Subscription' },
    { key: 'due_date', label: 'Due date' },
    { key: 'days_overdue', label: 'Days overdue' },
    { key: 'total_amount', label: 'Total' },
    { key: 'balance', label: 'Balance' },
  ], items);
  return (
    <>
      <ErrorBanner error={error} />
      <SectionHead title={`Overdue invoices as of ${formatDate(data?.as_of)}`} ms={data?.generated_ms} onExport={data ? csv : null}>
        <select className="input" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} aria-label="Sort">
          <option value="days">Most days overdue</option>
          <option value="balance">Largest balance</option>
          <option value="customer">Customer name</option>
        </select>
      </SectionHead>
      {data && (
        <div className="rk-buckets" style={{ marginBottom: 12 }}>
          {data.buckets.map((b, i) => (
            <div key={b.key} className={`rk-bucket b${i}`}>
              <span className="muted">{b.label}</span>
              <strong>{formatMoney(b.amount)}</strong>
              <span className="muted" style={{ fontSize: 12 }}>{int(b.count)} invoice{b.count === 1 ? '' : 's'}</span>
              <div style={{ marginTop: 8 }}><ShareBar value={b.amount} max={maxBucket} tone={i >= 2 ? 'danger' : 'warning'} /></div>
            </div>
          ))}
        </div>
      )}
      <Table head={[['Invoice'], ['Customer'], ['Due date'], ['Days overdue', 1], ['Total', 1], ['Balance', 1]]}>
        {loading && !data ? <Loading cols={6} /> : null}
        {data && items.length === 0 && <tr><td colSpan={6} className="muted center">No overdue invoices</td></tr>}
        {items.map((r) => (
          <tr key={r.id}>
            <td><Link to={`/invoices/${r.id}`}><strong>{r.number}</strong></Link></td>
            <td><Link to={`/customers/${r.customer_id}`}>{r.customer_name}</Link></td>
            <td>{formatDate(r.due_date)}</td>
            <td className="num"><StatusBadge status={r.days_overdue > 60 ? 'overdue' : 'outstanding'} label={`${r.days_overdue} days`} /></td>
            <td className="num">{formatMoney(r.total_amount)}</td>
            <td className="num"><strong>{formatMoney(r.balance)}</strong></td>
          </tr>
        ))}
      </Table>
      {data && (
        <>
          <Pagination page={data.page} pages={data.pages} total={data.total} onChange={setPage} />
          <p className="muted" style={{ margin: 0 }}>Total overdue balance: <strong>{formatMoney(data.total_balance)}</strong></p>
        </>
      )}
    </>
  );
}

function PaymentsTab({ params }) {
  const { data, loading, error } = useReport('/reports/payments-by-method', params);
  const items = data?.items || [];
  const max = Math.max(1, ...items.map((r) => r.amount));
  const csv = () => downloadCsv(`payments_by_method_${params.from || 'all'}_${params.to || 'all'}.csv`, [
    { key: 'method', label: 'Method', value: (r) => METHOD_LABELS[r.method] || r.method },
    { key: 'count', label: 'Payments' },
    { key: 'amount', label: 'Amount' },
    { key: 'share', label: 'Share %' },
  ], items);
  return (
    <>
      <ErrorBanner error={error} />
      <SectionHead title="Payments by method" ms={data?.generated_ms} onExport={data ? csv : null}>
        <Link className="btn ghost sm" to="/payments">Open payments register</Link>
      </SectionHead>
      <Table head={[['Method'], ['Payments', 1], ['Amount', 1], ['Share'], ['%', 1]]}>
        {loading && !data ? <Loading cols={5} /> : items.map((r) => (
          <tr key={r.method}>
            <td>{METHOD_LABELS[r.method] || r.method}</td>
            <td className="num">{int(r.count)}</td>
            <td className="num">{formatMoney(r.amount)}</td>
            <td style={{ width: '30%' }}><ShareBar value={r.amount} max={max} tone="success" /></td>
            <td className="num">{r.share}%</td>
          </tr>
        ))}
        {data && (
          <tr className="rk-total-row">
            <td>Total</td><td className="num">{int(data.count)}</td><td className="num">{formatMoney(data.total)}</td><td /><td className="num">100%</td>
          </tr>
        )}
      </Table>
    </>
  );
}

function SubscriptionsTab({ params }) {
  const { data, loading, error } = useReport('/reports/subscriptions-by-plan', { plan_id: params.plan_id, customer_id: params.customer_id });
  const items = data?.items || [];
  const csv = () => downloadCsv('subscriptions_by_plan.csv', [
    { key: 'plan_name', label: 'Plan' },
    { key: 'billing_period', label: 'Billing period' },
    ...SUB_STATUSES.map((s) => ({ key: s, label: s })),
    { key: 'total', label: 'Total' },
    { key: 'mrr', label: 'MRR' },
  ], items);
  const s = data?.by_status;
  const maxStatus = s ? Math.max(1, ...SUB_STATUSES.map((k) => s[k])) : 1;
  return (
    <>
      <ErrorBanner error={error} />
      <SectionHead title="Subscriptions by plan" ms={data?.generated_ms} onExport={data ? csv : null} />
      <div className="rk-grid">
        <Table head={[['Plan'], ['Active', 1], ['Paused', 1], ['Pipeline', 1], ['Closed', 1], ['Total', 1], ['MRR', 1]]}>
          {loading && !data ? <Loading cols={7} /> : items.map((r) => (
            <tr key={r.plan_id}>
              <td><strong>{r.plan_name}</strong><div className="muted" style={{ fontSize: 12 }}>{r.billing_interval > 1 ? `every ${r.billing_interval} ` : ''}{r.billing_period}</div></td>
              <td className="num">{int(r.active)}</td>
              <td className="num">{int(r.paused)}</td>
              <td className="num" title="Draft + quotation + confirmed">{int(r.draft + r.quotation + r.confirmed)}</td>
              <td className="num">{int(r.closed)}</td>
              <td className="num">{int(r.total)}</td>
              <td className="num">{formatMoney(r.mrr)}</td>
            </tr>
          ))}
          {data && (
            <tr className="rk-total-row">
              <td>Total</td>
              <td className="num">{int(s.active)}</td>
              <td className="num">{int(s.paused)}</td>
              <td className="num">{int(s.draft + s.quotation + s.confirmed)}</td>
              <td className="num">{int(s.closed)}</td>
              <td className="num">{int(s.total)}</td>
              <td className="num">{formatMoney(data.mrr)}</td>
            </tr>
          )}
        </Table>
        {s && (
          <Card title="By status">
            <ul className="rk-status-list">
              {SUB_STATUSES.map((k) => (
                <li key={k}>
                  <span><StatusBadge status={k} /></span>
                  <ShareBar value={s[k]} max={maxStatus} tone={k === 'active' ? 'success' : k === 'closed' ? 'danger' : k === 'paused' ? 'warning' : 'brand'} />
                  <span>{int(s[k])}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}

function CustomersTab({ params }) {
  const [limit, setLimit] = useState(10);
  const { data, loading, error } = useReport('/reports/top-customers', { from: params.from, to: params.to, plan_id: params.plan_id, limit });
  const items = data?.items || [];
  const max = Math.max(1, ...items.map((r) => r.revenue));
  const csv = () => downloadCsv(`top_customers_${params.from || 'all'}_${params.to || 'all'}.csv`, [
    { key: 'customer_name', label: 'Customer' },
    { key: 'company_name', label: 'Company' },
    { key: 'email', label: 'Email' },
    { key: 'invoice_count', label: 'Invoices' },
    { key: 'revenue', label: 'Revenue' },
    { key: 'collected', label: 'Collected' },
    { key: 'outstanding', label: 'Outstanding' },
  ], items);
  return (
    <>
      <ErrorBanner error={error} />
      <SectionHead title="Top customers by revenue" ms={data?.generated_ms} onExport={data ? csv : null}>
        <select className="input" value={limit} onChange={(e) => setLimit(Number(e.target.value))} aria-label="How many">
          {[5, 10, 25, 50].map((n) => <option key={n} value={n}>Top {n}</option>)}
        </select>
      </SectionHead>
      <Table head={[['#'], ['Customer'], ['Invoices', 1], ['Revenue', 1], [''], ['Collected', 1], ['Outstanding', 1]]}>
        {loading && !data ? <Loading cols={7} /> : null}
        {data && items.length === 0 && <tr><td colSpan={7} className="muted center">No invoiced revenue in this period</td></tr>}
        {items.map((r, i) => (
          <tr key={r.customer_id}>
            <td className="muted">{i + 1}</td>
            <td>
              <Link to={`/customers/${r.customer_id}`}><strong>{r.customer_name}</strong></Link>
              {r.company_name && <div className="muted" style={{ fontSize: 12 }}>{r.company_name}</div>}
            </td>
            <td className="num">{int(r.invoice_count)}</td>
            <td className="num"><strong>{formatMoney(r.revenue)}</strong></td>
            <td style={{ width: '18%' }}><ShareBar value={r.revenue} max={max} /></td>
            <td className="num">{formatMoney(r.collected)}</td>
            <td className="num">{r.outstanding > 0 ? <span style={{ color: 'var(--warning)' }}>{formatMoney(r.outstanding)}</span> : formatMoney(0)}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}

/* ---------------------------------------------------------------- page */

export default function Reports() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = TABS.some((t) => t.value === searchParams.get('tab')) ? searchParams.get('tab') : 'revenue';
  const [preset, setPreset] = useState('this_year');
  const [custom, setCustom] = useState(() => presetRange('this_month'));
  const [planId, setPlanId] = useState('');
  const [customer, setCustomer] = useState(null);
  const [plans, setPlans] = useState([]);

  useEffect(() => {
    api.get('/reports/subscriptions-by-plan')
      .then((d) => setPlans(d.items.map((p) => ({ id: p.plan_id, name: p.plan_name }))))
      .catch(() => setPlans([]));
  }, []);

  const range = preset === 'custom' ? custom : presetRange(preset);
  const rangeError = preset === 'custom' && custom.from && custom.to && custom.from > custom.to ? 'Start date must be before the end date' : null;
  const params = useMemo(() => ({
    from: range.from || undefined,
    to: range.to || undefined,
    plan_id: planId || undefined,
    customer_id: customer?.id || undefined,
  }), [range.from, range.to, planId, customer?.id]);

  const summary = useReport('/reports/summary', params, !rangeError);
  const s = summary.data;
  const setTab = (value) => setSearchParams((sp) => { const n = new URLSearchParams(sp); n.set('tab', value); return n; }, { replace: true });

  return (
    <div className="stack" style={{ gap: 16 }}>
      <ReportStyles />
      <PageHeader
        title="Finance reports"
        subtitle={range.from ? `${formatDate(range.from)} to ${formatDate(range.to)}` : 'All time'}
        actions={<Timing ms={s?.generated_ms} />}
      />

      <Card>
        <div className="rk-filters">
          <FormField label="Period">
            <select className="input" value={preset} onChange={(e) => setPreset(e.target.value)}>
              {PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </FormField>
          {preset === 'custom' && (
            <>
              <FormField label="From" error={rangeError}>
                <input type="date" className="input" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
              </FormField>
              <FormField label="To">
                <input type="date" className="input" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
              </FormField>
            </>
          )}
          <FormField label="Plan">
            <select className="input" value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">All plans</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </FormField>
          <CustomerFilter value={customer} onChange={setCustomer} />
          {(planId || customer || preset !== 'this_year') && (
            <button type="button" className="btn link" style={{ marginBottom: 10 }} onClick={() => { setPreset('this_year'); setPlanId(''); setCustomer(null); }}>
              Reset filters
            </button>
          )}
        </div>
      </Card>

      <ErrorBanner error={summary.error} />
      {!s && summary.loading && <Spinner label="Crunching numbers..." />}
      {s && (
        <div className="rk-kpis" style={{ opacity: summary.loading ? 0.6 : 1 }}>
          <StatCard label="Invoiced" value={formatMoney(s.revenue.invoiced)} hint={`${int(s.revenue.invoiced_count)} confirmed/paid invoices`} />
          <StatCard label="Collected" value={formatMoney(s.revenue.collected)} hint={`${int(s.revenue.payments_count)} payments`} tone="success" />
          <StatCard label="Outstanding (today)" value={formatMoney(s.revenue.outstanding)} hint={`${int(s.revenue.outstanding_count)} open invoices`} tone="warning" />
          <StatCard label="Overdue (today)" value={formatMoney(s.revenue.overdue_amount)} hint={`${int(s.revenue.overdue_count)} invoices`} tone="danger" />
          <StatCard label="Active subscriptions" value={int(s.subscriptions.active)} hint={`${int(s.subscriptions.paused)} paused, ${int(s.subscriptions.closed)} closed`} />
          <StatCard label="MRR" value={formatMoney(s.mrr)} hint="From active subscriptions" tone="success" />
        </div>
      )}
      {s && (
        <div className="row muted" style={{ fontSize: 13 }}>
          Invoices in period:
          {['draft', 'confirmed', 'paid', 'cancelled'].map((k) => (
            <span key={k} className="row" style={{ gap: 4 }}><StatusBadge status={k} /> {int(s.invoices[k])}</span>
          ))}
        </div>
      )}

      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {!rangeError && (
        <div>
          {tab === 'revenue' && <RevenueTab params={params} />}
          {tab === 'overdue' && <OverdueTab params={params} />}
          {tab === 'payments' && <PaymentsTab params={params} />}
          {tab === 'subscriptions' && <SubscriptionsTab params={params} />}
          {tab === 'customers' && <CustomersTab params={params} />}
        </div>
      )}
    </div>
  );
}
