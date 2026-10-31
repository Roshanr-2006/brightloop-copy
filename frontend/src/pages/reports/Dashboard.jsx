// Subscription-first executive dashboard, inspired by the restaurant dashboard reference.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight, ArrowUpRight, BadgeCheck, CalendarDays, Clock3, CreditCard, Plus,
  RefreshCw, Sparkles, WalletCards,
} from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Card, ErrorBanner, PageHeader, Spinner, StatCard, StatusBadge } from '../../components/ui';
import { formatDate, formatMoney } from '../../utils/format';
import RecordPaymentModal from '../../components/payments/RecordPaymentModal.jsx';
import { ReportStyles, RevenueBars, Timing, presetRange } from './reportKit.jsx';

const METHOD_LABEL = {
  bank_transfer: 'Bank transfer', upi: 'UPI', cash: 'Cash', card: 'Card', cheque: 'Cheque', other: 'Other',
};
const METHOD_COLORS = ['#7c3aed', '#a78bfa', '#c4b5fd', '#ddd6fe', '#6d28d9', '#ede9fe'];
const PLAN_COLORS = ['#7c3aed', '#8b5cf6', '#a78bfa', '#c4b5fd', '#6d28d9'];
const STATUS_ORDER = ['active', 'confirmed', 'quotation', 'paused', 'draft', 'closed'];

function MiniTrend({ icon: Icon, label, value, hint, tone = 'purple' }) {
  return (
    <div className="sub-kpi">
      <div className={`sub-kpi-icon ${tone}`}><Icon size={17} strokeWidth={1.8} /></div>
      <div className="sub-kpi-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{hint}</small>
      </div>
    </div>
  );
}

function PaymentMix({ items = [] }) {
  const total = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  let cursor = 0;
  const segments = items.map((item, i) => {
    const start = cursor;
    cursor += Number(item.share || 0);
    return `${METHOD_COLORS[i % METHOD_COLORS.length]} ${start}% ${cursor}%`;
  });
  const gradient = segments.length ? `conic-gradient(${segments.join(', ')})` : 'conic-gradient(#eee 0 100%)';
  const visible = items.filter((item) => item.amount > 0).slice(0, 5);

  return (
    <div className="sub-paymix">
      <div className="sub-donut" style={{ background: gradient }} role="img" aria-label="Payment distribution by method">
        <div className="sub-donut-center"><span>Collected</span><strong>{formatMoney(total)}</strong><small>this month</small></div>
      </div>
      <div className="sub-pay-legend">
        {visible.length ? visible.map((item, i) => (
          <div className="sub-pay-row" key={item.method}>
            <span className="sub-pay-dot" style={{ background: METHOD_COLORS[items.indexOf(item) % METHOD_COLORS.length] }} />
            <span className="sub-pay-name">{METHOD_LABEL[item.method] || item.method}</span>
            <strong>{formatMoney(item.amount)}</strong>
            <small>{Number(item.share || 0).toFixed(0)}%</small>
          </div>
        )) : <p className="muted">Payment methods will appear here as receipts come in.</p>}
      </div>
    </div>
  );
}

function PlanMix({ items = [] }) {
  const plans = items.slice(0, 4);
  const maxActive = Math.max(1, ...plans.map((p) => Number(p.active || 0)));
  return (
    <div className="sub-plan-list">
      {plans.map((plan, i) => {
        const total = Number(plan.active || 0) + Number(plan.paused || 0) + Number(plan.confirmed || 0);
        const progress = Math.max(2, Math.round((Number(plan.active || 0) / maxActive) * 100));
        return (
          <Link className="sub-plan-row" to={`/catalog/plans`} key={plan.plan_id}>
            <span className="sub-plan-symbol" style={{ '--plan-color': PLAN_COLORS[i % PLAN_COLORS.length] }}><CreditCard size={16} /></span>
            <span className="sub-plan-main">
              <span className="sub-plan-title"><strong>{plan.plan_name}</strong><small>{plan.billing_interval > 1 ? `Every ${plan.billing_interval} ` : ''}{plan.billing_period}</small></span>
              <span className="sub-plan-track"><i style={{ width: `${progress}%`, background: PLAN_COLORS[i % PLAN_COLORS.length] }} /></span>
            </span>
            <span className="sub-plan-count"><strong>{Number(plan.active || 0).toLocaleString('en-IN')}</strong><small>active · {total.toLocaleString('en-IN')} total</small></span>
            <ArrowRight className="sub-plan-arrow" size={15} />
          </Link>
        );
      })}
      {!plans.length && <p className="muted">No recurring plans are available yet.</p>}
      <Link to="/catalog/plans" className="sub-all-plans">Explore all plans <ArrowUpRight size={14} /></Link>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [months, setMonths] = useState(12);
  const [payInvoice, setPayInvoice] = useState(null);
  const periodText = useMemo(() => new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(new Date()), []);

  const load = useCallback(() => {
    const month = presetRange('this_month');
    Promise.all([
      api.get('/reports/summary'),
      api.get('/reports/summary', month),
      api.get('/reports/revenue', { months }),
      api.get('/reports/overdue', { limit: 5 }),
      api.get('/reports/subscriptions-by-plan'),
      api.get('/reports/payments-by-method', month),
    ])
      .then(([overall, thisMonth, revenue, overdue, planMix, paymentMix]) => {
        setData({ overall, thisMonth, revenue, overdue, planMix, paymentMix });
        setError(null);
      })
      .catch(setError);
  }, [months]);

  useEffect(() => { load(); }, [load]);

  if (error && !data) return <><PageHeader title="Dashboard" /><ErrorBanner error={error} /></>;
  if (!data) return <Spinner label="Loading subscription dashboard..." />;

  const { overall, thisMonth, revenue, overdue, planMix, paymentMix } = data;
  const subs = overall.subscriptions;
  const serverMs = Math.round((overall.generated_ms + thisMonth.generated_ms + revenue.generated_ms + overdue.generated_ms + planMix.generated_ms + paymentMix.generated_ms) * 10) / 10;
  const collected = thisMonth.revenue.collected;
  const pipeline = STATUS_ORDER.map((status) => ({ status, count: Number(subs[status] || 0) }));
  const maxPipeline = Math.max(1, ...pipeline.map((item) => item.count));

  return (
    <div className="subscription-dashboard">
      <ReportStyles />
      <PageHeader
        eyebrow="WORKSPACE OVERVIEW"
        title="Subscription dashboard"
        subtitle={`A clear view of your recurring business · ${periodText}`}
        actions={(
          <>
            <Timing ms={serverMs} />
            <button type="button" className="btn ghost" onClick={load}><RefreshCw size={14} /> Refresh</button>
          </>
        )}
      />
      <ErrorBanner error={error} />

      <section className="subscription-hero">
        <div className="subscription-hero-copy">
          <div className="sub-hero-eyebrow"><span className="sub-live-dot" /> SUBSCRIPTION PULSE <span className="sub-hero-period">{periodText}</span></div>
          <h2>Recurring revenue.<br /><em>Right on schedule.</em></h2>
          <p>Plans, renewals and customer payments, all moving in sync. See how your subscription business is performing today.</p>
          <div className="sub-hero-actions">
            <button type="button" className="btn sub-hero-primary" onClick={() => navigate('/subscriptions/new')}><Plus size={15} /> Create subscription</button>
            <button type="button" className="btn sub-hero-secondary" onClick={() => navigate('/billing')}><CalendarDays size={15} /> Open billing run</button>
          </div>
          <div className="sub-hero-meta"><BadgeCheck size={14} /><span>Recurring plans, in one place</span><span className="sub-meta-separator" /><span>Daily · weekly · monthly · yearly</span></div>
        </div>
        <div className="subscription-hero-art">
          <img src="/subscription-hero.svg" alt="Subscription plan cards connected by recurring billing cycles" />
        </div>
      </section>

      <section className="subscription-kpis" aria-label="Subscription business metrics">
        <MiniTrend icon={Sparkles} label="Active subscriptions" value={subs.active.toLocaleString('en-IN')} hint={`${subs.total.toLocaleString('en-IN')} total contracts`} />
        <MiniTrend icon={WalletCards} label="Monthly recurring revenue" value={formatMoney(overall.mrr)} hint="Normalized monthly value" tone="mint" />
        <MiniTrend icon={CreditCard} label="Collected this month" value={formatMoney(collected)} hint={`${thisMonth.revenue.payments_count.toLocaleString('en-IN')} payments received`} tone="blue" />
        <MiniTrend icon={Clock3} label="Overdue balance" value={formatMoney(overall.revenue.overdue_amount)} hint={`${overall.revenue.overdue_count.toLocaleString('en-IN')} invoices need follow-up`} tone="rose" />
      </section>

      <section className="sub-secondary-kpis">
        <div className="sub-secondary-metric"><span>Invoiced this month</span><strong>{formatMoney(thisMonth.revenue.invoiced)}</strong><small>{thisMonth.revenue.invoiced_count.toLocaleString('en-IN')} invoices issued</small></div>
        <div className="sub-secondary-divider" />
        <div className="sub-secondary-metric"><span>Outstanding invoices</span><strong>{formatMoney(overall.revenue.outstanding)}</strong><small>{overall.revenue.outstanding_count.toLocaleString('en-IN')} open balances</small></div>
        <Link to="/invoices?status=overdue" className="sub-overdue-link">Review overdue <ArrowUpRight size={14} /></Link>
      </section>

      <section className="sub-dashboard-grid sub-chart-grid">
        <Card title="Recurring revenue" actions={(
          <select className="input" value={months} onChange={(event) => setMonths(Number(event.target.value))} aria-label="Revenue chart period">
            <option value={6}>Last 6 months</option><option value={12}>Last 12 months</option>
          </select>
        )}>
          <div className="sub-chart-caption"><span>Invoiced and collected revenue over time</span><span className="sub-chart-legend"><i className="legend-purple" /> Invoiced <i className="legend-lilac" /> Collected</span></div>
          <RevenueBars items={revenue.items} height={242} />
          <div className="sub-revenue-totals">
            <div><span>Invoiced</span><strong>{formatMoney(revenue.totals.invoiced)}</strong></div>
            <div><span>Collected</span><strong>{formatMoney(revenue.totals.collected)}</strong></div>
            <Link to="/reports?tab=revenue">View revenue report <ArrowRight size={14} /></Link>
          </div>
        </Card>

        <Card title="Payment methods" actions={<Link to="/payments" className="sub-card-link">All payments <ArrowUpRight size={14} /></Link>}>
          <p className="sub-card-subtitle">How customers paid this month</p>
          <PaymentMix items={paymentMix.items} />
        </Card>
      </section>

      <section className="sub-dashboard-grid sub-lower-grid">
        <Card title="Plans at a glance" actions={<span className="sub-muted-count">{planMix.items.length} plans</span>}>
          <p className="sub-card-subtitle">Active subscribers across your recurring plans</p>
          <PlanMix items={planMix.items} />
        </Card>

        <Card title="Needs your attention" actions={<Link to="/reports?tab=overdue" className="sub-card-link">See all {overdue.total.toLocaleString('en-IN')} <ArrowUpRight size={14} /></Link>}>
          <p className="sub-card-subtitle">Overdue invoices with balances to follow up</p>
          <div className="sub-overdue-list">
            {overdue.items.length === 0 && <div className="sub-all-clear"><BadgeCheck size={20} /><span>No overdue invoices right now.</span></div>}
            {overdue.items.slice(0, 4).map((invoice) => (
              <div className="sub-overdue-row" key={invoice.id}>
                <div className="sub-overdue-icon"><CreditCard size={15} /></div>
                <div className="sub-overdue-info"><Link to={`/invoices/${invoice.id}`}><strong>{invoice.number}</strong></Link><span>{invoice.customer_name} · due {formatDate(invoice.due_date)}</span></div>
                <div className="sub-overdue-amount"><strong>{formatMoney(invoice.balance)}</strong><StatusBadge status="overdue" label={`${invoice.days_overdue}d`} /></div>
              </div>
            ))}
          </div>
          {overdue.items.length > 0 && <button type="button" className="btn sub-followup" onClick={() => setPayInvoice({ ...overdue.items[0], balance_due: overdue.items[0].balance })}><CreditCard size={14} /> Record a payment</button>}
        </Card>
      </section>

      <Card title="Subscription pipeline" actions={<Link to="/subscriptions" className="sub-card-link">Open subscriptions <ArrowUpRight size={14} /></Link>}>
        <div className="sub-pipeline">
          {pipeline.map(({ status, count }, index) => (
            <Link key={status} to={`/subscriptions?status=${status}`} className="sub-pipeline-stage">
              <div className="sub-pipeline-head"><StatusBadge status={status} /><strong>{count.toLocaleString('en-IN')}</strong></div>
              <div className="sub-pipeline-track"><i style={{ width: `${Math.max(2, (count / maxPipeline) * 100)}%` }} /></div>
              {index < pipeline.length - 1 && <span className="sub-pipeline-arrow">›</span>}
            </Link>
          ))}
        </div>
      </Card>

      <RecordPaymentModal open={Boolean(payInvoice)} invoice={payInvoice} onClose={() => setPayInvoice(null)} onSaved={load} />
    </div>
  );
}
