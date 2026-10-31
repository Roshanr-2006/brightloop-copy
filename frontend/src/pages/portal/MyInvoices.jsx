import { useNavigate } from 'react-router-dom';
import useList from '../../hooks/useList.js';
import {
  DataTable, ErrorBanner, PageHeader, Pagination, StatCard, StatusBadge, Tabs,
} from '../../components/ui/index.jsx';
import { formatDate, formatMoney } from '../../utils/format.js';

const TABS = [
  { value: '', label: 'All' },
  { value: 'outstanding', label: 'To pay' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Paid' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function MyInvoices() {
  const navigate = useNavigate();
  const list = useList('/portal/invoices', { status: '' });
  const summary = list.data.summary;

  const columns = [
    { key: 'number', label: 'Invoice', render: (i) => <strong>{i.number}</strong> },
    { key: 'subscription_number', label: 'Subscription', render: (i) => i.subscription_number || '-' },
    { key: 'invoice_date', label: 'Date', render: (i) => formatDate(i.invoice_date) },
    { key: 'due_date', label: 'Due', render: (i) => formatDate(i.due_date) },
    { key: 'status', label: 'Status', render: (i) => <StatusBadge status={i.is_overdue ? 'overdue' : i.status} /> },
    { key: 'total_amount', label: 'Total', align: 'right', render: (i) => formatMoney(i.total_amount) },
    {
      key: 'balance_due',
      label: 'Balance',
      align: 'right',
      render: (i) => (i.status === 'confirmed'
        ? <strong style={{ color: i.is_overdue ? 'var(--danger)' : undefined }}>{formatMoney(i.balance_due)}</strong>
        : <span className="muted">-</span>),
    },
  ];

  return (
    <div className="stack">
      <PageHeader title="My invoices" subtitle="Your bills, what is paid and what is still due." />
      {summary && (
        <div className="grid-2">
          <StatCard label="Outstanding" value={formatMoney(summary.outstanding)} tone={summary.outstanding > 0 ? 'warning' : 'success'} />
          <StatCard label="Overdue" value={formatMoney(summary.overdue)} tone={summary.overdue > 0 ? 'danger' : 'success'} hint={summary.overdue > 0 ? 'Please pay these as soon as possible' : 'Nothing overdue'} />
        </div>
      )}
      <Tabs tabs={TABS} value={list.params.status} onChange={(v) => list.setParam('status', v)} />
      <ErrorBanner error={list.error} />
      <DataTable
        columns={columns}
        rows={list.data.items}
        loading={list.loading}
        empty={list.params.status ? 'No invoices in this view' : 'No invoices yet'}
        onRowClick={(i) => navigate(`/portal/invoices/${i.id}`)}
      />
      <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} onChange={list.setPage} />
    </div>
  );
}
