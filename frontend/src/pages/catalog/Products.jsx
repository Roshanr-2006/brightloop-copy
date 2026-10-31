// Products & variants list (owner: Roshan).
import { useNavigate } from 'react-router-dom';
import useList from '../../hooks/useList';
import { formatMoney, capitalize } from '../../utils/format';
import {
  Card, PageHeader, DataTable, Pagination, SearchInput, ErrorBanner, StatusBadge,
} from '../../components/ui/index.jsx';
import { useIsAdmin, ActiveFilter, ActiveBadge } from './shared.jsx';

const TYPE_TONE = { service: 'info', goods: 'brand', addon: 'warning' };

export default function Products() {
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const list = useList('/catalog/products', { search: '', type: '', active: '1', sort: 'name' });

  const columns = [
    {
      key: 'name', label: 'Product', render: (r) => (
        <>
          <span className="cat-name">{r.name}</span>
          {r.notes && <span className="cat-sub">{r.notes}</span>}
        </>
      ),
    },
    { key: 'type', label: 'Type', render: (r) => <span className={`badge badge-${TYPE_TONE[r.type] || 'neutral'}`}>{capitalize(r.type)}</span> },
    { key: 'sales_price', label: 'Sales price', align: 'right', render: (r) => <span className="cat-num">{formatMoney(r.sales_price)}</span> },
    { key: 'cost_price', label: 'Cost', align: 'right', render: (r) => <span className="cat-num muted">{formatMoney(r.cost_price)}</span> },
    {
      key: 'variant_count', label: 'Variants', align: 'right',
      render: (r) => (r.variant_count ? `${r.variant_count} variant${r.variant_count === 1 ? '' : 's'}` : <span className="muted">None</span>),
    },
    { key: 'tax_names', label: 'Taxes', render: (r) => r.tax_names || <span className="muted">No tax</span> },
    { key: 'is_active', label: 'Status', render: (r) => <ActiveBadge active={r.is_active} /> },
  ];

  return (
    <div className="stack">
      <PageHeader
        title="Products & variants"
        subtitle="What you sell on subscriptions. Variants add an extra price, e.g. Brand: Odoo adds 560."
        actions={isAdmin && (
          <button type="button" className="btn primary" onClick={() => navigate('/catalog/products/new')}>New product</button>
        )}
      />
      <Card>
        <div className="cat-filters" style={{ marginBottom: 12 }}>
          <SearchInput value={list.params.search} onChange={(v) => list.setParam('search', v)} placeholder="Search name or notes" />
          <select className="input" value={list.params.type} onChange={(e) => list.setParam('type', e.target.value)} aria-label="Type">
            <option value="">All types</option>
            <option value="service">Service</option>
            <option value="goods">Goods</option>
            <option value="addon">Add-on</option>
          </select>
          <ActiveFilter value={list.params.active} onChange={(v) => list.setParam('active', v)} />
          <select className="input" value={list.params.sort} onChange={(e) => list.setParam('sort', e.target.value)} aria-label="Sort">
            <option value="name">Name A-Z</option>
            <option value="name:desc">Name Z-A</option>
            <option value="price:desc">Price high-low</option>
            <option value="price">Price low-high</option>
            <option value="created:desc">Newest first</option>
          </select>
        </div>
        <ErrorBanner error={list.error} />
        <DataTable
          columns={columns}
          rows={list.data.items}
          loading={list.loading}
          empty={list.params.search ? 'No products match your search' : 'No products yet'}
          onRowClick={(r) => navigate(`/catalog/products/${r.id}`)}
        />
        <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} onChange={list.setPage} />
      </Card>
      {!isAdmin && <p className="muted">Click a product to see its variants and taxes. <StatusBadge status="staff" label="read only" /></p>}
    </div>
  );
}
