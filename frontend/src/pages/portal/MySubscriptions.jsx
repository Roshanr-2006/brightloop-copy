import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import useList from '../../hooks/useList.js';
import {
  DataTable, EmptyState, ErrorBanner, PageHeader, Pagination, StatusBadge, Tabs,
} from '../../components/ui/index.jsx';
import { capitalize, formatDate, formatMoney } from '../../utils/format.js';

const TABS = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'quotation', label: 'Quotations' },
  { value: 'closed', label: 'Closed' },
];

export function periodLabel(period, interval = 1) {
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[period] || period;
  return Number(interval) > 1 ? `every ${interval} ${unit}s` : `per ${unit}`;
}

export default function MySubscriptions() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const list = useList('/portal/subscriptions', { status: '' });

  const columns = [
    { key: 'number', label: 'Subscription', render: (s) => <strong>{s.number}</strong> },
    { key: 'plan_name', label: 'Plan', render: (s) => `${s.plan_name} (${capitalize(s.billing_period)})` },
    { key: 'status', label: 'Status', render: (s) => <StatusBadge status={s.status} /> },
    { key: 'start_date', label: 'Started', render: (s) => formatDate(s.start_date) },
    { key: 'expiry_date', label: 'Ends', render: (s) => (s.expiry_date ? formatDate(s.expiry_date) : 'Until cancelled') },
    { key: 'next_invoice_date', label: 'Next bill', render: (s) => (s.status === 'active' ? formatDate(s.next_invoice_date) : '-') },
    {
      key: 'recurring_amount',
      label: 'Amount',
      align: 'right',
      render: (s) => (
        <span>{formatMoney(s.recurring_amount)} <span className="muted" style={{ fontSize: 12 }}>{periodLabel(s.billing_period, s.billing_interval)}</span></span>
      ),
    },
  ];

  const empty = !list.loading && !list.error && list.data.total === 0 && !list.params.status;

  return (
    <div className="stack">
      <PageHeader title="My subscriptions" subtitle={`Hello ${user?.name?.split(' ')[0] || ''}, here are your plans with us.`} />
      {empty ? (
        <div className="card">
          <EmptyState title="No subscriptions yet" message="When our team sets up a subscription or sends you a quotation, it will appear here." />
        </div>
      ) : (
        <>
          <Tabs tabs={TABS} value={list.params.status} onChange={(v) => list.setParam('status', v)} />
          <ErrorBanner error={list.error} />
          <DataTable
            columns={columns}
            rows={list.data.items}
            loading={list.loading}
            empty="No subscriptions with this status"
            onRowClick={(s) => navigate(`/portal/subscriptions/${s.id}`)}
          />
          <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} onChange={list.setPage} />
        </>
      )}
    </div>
  );
}
