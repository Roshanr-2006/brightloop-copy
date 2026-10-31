// Quotation templates list (owner: Roshan).
import { useNavigate } from 'react-router-dom';
import useList from '../../hooks/useList';
import { formatMoney } from '../../utils/format';
import { Card, PageHeader, DataTable, Pagination, SearchInput, ErrorBanner } from '../../components/ui/index.jsx';
import { useIsAdmin, ActiveFilter, ActiveBadge, periodLabel } from './shared.jsx';

export default function Templates() {
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const list = useList('/catalog/templates', { search: '', active: '1', sort: 'name' });

  const columns = [
    {
      key: 'name', label: 'Template', render: (r) => (
        <>
          <span className="cat-name">{r.name}</span>
          {r.notes && <span className="cat-sub">{r.notes}</span>}
        </>
      ),
    },
    {
      key: 'plan_name', label: 'Plan', render: (r) => (
        <>
          {r.plan_name}
          <span className="cat-sub">{periodLabel(r.billing_period, r.billing_interval)}{r.plan_active ? '' : ' (archived plan)'}</span>
        </>
      ),
    },
    { key: 'line_count', label: 'Lines', align: 'right' },
    { key: 'untaxed_amount', label: 'Untaxed / period', align: 'right', render: (r) => <span className="cat-num">{formatMoney(r.untaxed_amount)}</span> },
    { key: 'validity_days', label: 'Valid for', align: 'right', render: (r) => `${r.validity_days} day${r.validity_days === 1 ? '' : 's'}` },
    { key: 'payment_term_name', label: 'Payment term', render: (r) => r.payment_term_name || <span className="muted">Default</span> },
    { key: 'subscription_count', label: 'Used', align: 'right' },
    { key: 'is_active', label: 'Status', render: (r) => <ActiveBadge active={r.is_active} /> },
  ];

  return (
    <div className="stack">
      <PageHeader
        title="Quotation templates"
        subtitle="Ready-made quotations: a plan plus product lines. Pick one when creating a subscription to fill everything in."
        actions={isAdmin && (
          <button type="button" className="btn primary" onClick={() => navigate('/catalog/templates/new')}>New template</button>
        )}
      />
      <Card>
        <div className="cat-filters" style={{ marginBottom: 12 }}>
          <SearchInput value={list.params.search} onChange={(v) => list.setParam('search', v)} placeholder="Search template or plan" />
          <ActiveFilter value={list.params.active} onChange={(v) => list.setParam('active', v)} />
          <select className="input" value={list.params.sort} onChange={(e) => list.setParam('sort', e.target.value)} aria-label="Sort">
            <option value="name">Name A-Z</option>
            <option value="plan">Plan</option>
            <option value="created:desc">Newest first</option>
          </select>
        </div>
        <ErrorBanner error={list.error} />
        <DataTable
          columns={columns}
          rows={list.data.items}
          loading={list.loading}
          empty="No templates match these filters"
          onRowClick={(r) => navigate(`/catalog/templates/${r.id}`)}
        />
        <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} onChange={list.setPage} />
      </Card>
    </div>
  );
}
