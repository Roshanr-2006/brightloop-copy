import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useList from '../../hooks/useList.js';
import {
  DataTable, ErrorBanner, PageHeader, Pagination, SearchInput, StatusBadge, Toolbar,
} from '../../components/ui/index.jsx';
import { formatMoney } from '../../utils/format.js';
import CustomerFormModal from './CustomerFormModal.jsx';

const SORTS = [
  { value: 'name:asc', label: 'Name (A-Z)' },
  { value: 'name:desc', label: 'Name (Z-A)' },
  { value: 'company:asc', label: 'Company' },
  { value: 'created:desc', label: 'Newest first' },
  { value: 'balance:desc', label: 'Highest balance' },
  { value: 'active:desc', label: 'Most active subscriptions' },
];

export default function CustomerList() {
  const navigate = useNavigate();
  const list = useList('/customers', { search: '', sort: 'name:asc', portal: '' });
  const [editing, setEditing] = useState(null); // null | 'new' | customer

  const columns = [
    {
      key: 'name',
      label: 'Customer',
      render: (c) => (
        <div>
          <div style={{ fontWeight: 600 }}>{c.name}</div>
          <div className="muted" style={{ fontSize: 12.5 }}>{c.email}</div>
        </div>
      ),
    },
    { key: 'company_name', label: 'Company', render: (c) => c.company_name || <span className="muted">-</span> },
    { key: 'city', label: 'City', render: (c) => [c.city, c.state].filter(Boolean).join(', ') || <span className="muted">-</span> },
    { key: 'active_subscriptions', label: 'Active subs', align: 'right' },
    {
      key: 'outstanding_balance',
      label: 'Outstanding',
      align: 'right',
      render: (c) => (
        <span style={{ color: c.overdue_invoices ? 'var(--danger)' : undefined, fontWeight: c.outstanding_balance ? 600 : 400 }}>
          {formatMoney(c.outstanding_balance)}
          {c.overdue_invoices > 0 && <div style={{ fontSize: 12 }}>{c.overdue_invoices} overdue</div>}
        </span>
      ),
    },
    { key: 'portal', label: 'Portal', render: (c) => (c.has_portal_access ? <StatusBadge status="active" label="Enabled" /> : <StatusBadge status="inactive" label="None" />) },
    {
      key: 'edit',
      label: '',
      align: 'right',
      render: (c) => (
        <button type="button" className="btn ghost sm" onClick={(e) => { e.stopPropagation(); setEditing(c); }}>Edit</button>
      ),
    },
  ];

  return (
    <div className="stack">
      <PageHeader
        title="Customers"
        subtitle="Billing contacts, their subscriptions and what they owe."
        actions={<button type="button" className="btn primary" onClick={() => setEditing('new')}>+ New customer</button>}
      />
      <Toolbar>
        <SearchInput value={list.params.search} onChange={(v) => list.setParam('search', v)} placeholder="Search name, email or company" />
        <select className="input" value={list.params.portal} onChange={(e) => list.setParam('portal', e.target.value)} aria-label="Portal access">
          <option value="">All customers</option>
          <option value="1">With portal access</option>
          <option value="0">Without portal access</option>
        </select>
        <select className="input" value={list.params.sort} onChange={(e) => list.setParam('sort', e.target.value)} aria-label="Sort">
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </Toolbar>
      <ErrorBanner error={list.error} />
      <DataTable
        columns={columns}
        rows={list.data.items}
        loading={list.loading}
        empty={list.params.search ? 'No customers match your search' : 'No customers yet. Add the first one.'}
        onRowClick={(c) => navigate(`/customers/${c.id}`)}
      />
      <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} onChange={list.setPage} />

      <CustomerFormModal
        open={Boolean(editing)}
        customer={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={(saved) => {
          const wasNew = editing === 'new';
          setEditing(null);
          if (wasNew) navigate(`/customers/${saved.id}`);
          else list.reload();
        }}
      />
    </div>
  );
}
