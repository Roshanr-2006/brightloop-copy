// Subscriptions list (owner: Swathy).
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import useList from '../../hooks/useList';
import {
  Card, DataTable, ErrorBanner, PageHeader, Pagination, SearchInput, StatusBadge, Tabs, Toolbar,
} from '../../components/ui';
import { capitalize, formatDate, formatMoney } from '../../utils/format';
import { SUB_STATUSES, periodText } from './subscriptionUtils';

export default function SubscriptionList() {
  const navigate = useNavigate();
  const [query] = useSearchParams();
  const list = useList('/subscriptions', {
    status: query.get('status') || '',
    search: '',
    plan_id: '',
    customer_id: query.get('customer') || '',
  });
  const [plans, setPlans] = useState([]);

  useEffect(() => {
    api.get('/catalog/plans/options').then((d) => setPlans(d.items || [])).catch(() => setPlans([]));
  }, []);

  const counts = list.data.counts || {};
  const tabs = [
    { value: '', label: 'All', count: counts.all },
    ...SUB_STATUSES.map((s) => ({ value: s, label: capitalize(s), count: counts[s] })),
  ];

  const columns = [
    { key: 'number', label: 'Number', render: (r) => <Link to={`/subscriptions/${r.id}`} onClick={(e) => e.stopPropagation()}><strong>{r.number}</strong></Link> },
    { key: 'customer_name', label: 'Customer' },
    { key: 'plan_name', label: 'Plan', render: (r) => <>{r.plan_name}<div className="muted" style={{ fontSize: 12 }}>{periodText(r.billing_period, r.billing_interval)}</div></> },
    { key: 'start_date', label: 'Start', render: (r) => formatDate(r.start_date) },
    { key: 'expiry_date', label: 'Expiry', render: (r) => (r.expiry_date ? formatDate(r.expiry_date) : <span className="muted">Open-ended</span>) },
    { key: 'next_invoice_date', label: 'Next invoice', render: (r) => (['active'].includes(r.status) && r.next_invoice_date ? formatDate(r.next_invoice_date) : '-') },
    { key: 'recurring_total', label: 'Recurring', align: 'right', render: (r) => formatMoney(r.recurring_total) },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <PageHeader
        title="Subscriptions"
        subtitle="Every quotation and recurring contract, visible to the whole team"
        actions={<Link className="btn primary" to="/subscriptions/new">New subscription</Link>}
      />
      <Card>
        <Tabs tabs={tabs} value={list.params.status} onChange={(v) => list.setParam('status', v)} />
        <Toolbar>
          <SearchInput
            value={list.params.search}
            onChange={(v) => list.setParam('search', v)}
            placeholder="Search number or customer"
          />
          <select
            className="input"
            value={list.params.plan_id}
            onChange={(e) => list.setParam('plan_id', e.target.value)}
            aria-label="Filter by plan"
          >
            <option value="">All plans</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {list.params.customer_id && (
            <button type="button" className="btn ghost sm" onClick={() => list.setParam('customer_id', '')}>
              Clear customer filter
            </button>
          )}
        </Toolbar>
        <ErrorBanner error={list.error} />
        <DataTable
          columns={columns}
          rows={list.data.items}
          loading={list.loading}
          empty="No subscriptions match these filters"
          onRowClick={(r) => navigate(`/subscriptions/${r.id}`)}
        />
        <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} onChange={list.setPage} />
      </Card>
    </>
  );
}
