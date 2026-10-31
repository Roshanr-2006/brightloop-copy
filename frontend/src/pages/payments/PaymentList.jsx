// Payments register: filters, paging, totals, admin-only reversal, record payment flow.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import useList from '../../hooks/useList';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import {
  ConfirmDialog, DataTable, ErrorBanner, PageHeader, Pagination, SearchInput, StatCard, Toolbar, useToast,
} from '../../components/ui';
import { formatDate, formatMoney } from '../../utils/format';
import RecordPaymentModal, { PAYMENT_METHODS } from '../../components/payments/RecordPaymentModal.jsx';
import InvoicePickerModal from '../../components/payments/InvoicePickerModal.jsx';

const methodLabel = (m) => PAYMENT_METHODS.find((x) => x.value === m)?.label || m;

export default function PaymentList() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('admin');
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const list = useList('/payments', {
    search: searchParams.get('search') || '',
    method: '',
    from: '',
    to: '',
    customer_id: searchParams.get('customer_id') || '',
    invoice_id: searchParams.get('invoice_id') || '',
  });
  const [picker, setPicker] = useState(searchParams.get('record') === '1');
  const [payInvoice, setPayInvoice] = useState(null);
  const [reversing, setReversing] = useState(null);
  const [busy, setBusy] = useState(false);

  const { items = [], total = 0, page = 1, pages = 1, total_amount: filteredTotal = 0 } = list.data;
  const pageTotal = items.reduce((s, p) => s + Number(p.amount || 0), 0);
  const p = list.params;
  const hasFilters = p.search || p.method || p.from || p.to || p.customer_id || p.invoice_id;

  const reverse = async () => {
    setBusy(true);
    try {
      await api.delete(`/payments/${reversing.id}`);
      toast.success(`Payment of ${formatMoney(reversing.amount)} reversed. ${reversing.invoice_number} is open again.`);
      setReversing(null);
      list.reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    { key: 'payment_date', label: 'Date', render: (r) => formatDate(r.payment_date) },
    { key: 'invoice_number', label: 'Invoice', render: (r) => <Link to={`/invoices/${r.invoice_id}`}><strong>{r.invoice_number}</strong></Link> },
    { key: 'customer_name', label: 'Customer', render: (r) => <Link to={`/customers/${r.customer_id}`}>{r.customer_name}</Link> },
    { key: 'method', label: 'Method', render: (r) => <span className="badge badge-neutral">{methodLabel(r.method)}</span> },
    { key: 'reference', label: 'Reference', render: (r) => r.reference || <span className="muted">-</span> },
    { key: 'recorded_by_name', label: 'Recorded by', render: (r) => r.recorded_by_name || <span className="muted">-</span> },
    { key: 'amount', label: 'Amount', align: 'right', render: (r) => <strong>{formatMoney(r.amount)}</strong> },
  ];
  if (isAdmin) {
    columns.push({
      key: 'actions',
      label: '',
      align: 'right',
      render: (r) => (
        <button type="button" className="btn ghost sm" onClick={() => setReversing(r)} title="Reverse this payment">Reverse</button>
      ),
    });
  }

  return (
    <div className="stack">
      <PageHeader
        title="Payments"
        subtitle="Money received against invoices"
        actions={<button type="button" className="btn primary" onClick={() => setPicker(true)}>+ Record payment</button>}
      />

      <div className="grid-3">
        <StatCard label={hasFilters ? 'Payments (filtered)' : 'Payments'} value={total.toLocaleString('en-IN')} />
        <StatCard label={hasFilters ? 'Total received (filtered)' : 'Total received'} value={formatMoney(filteredTotal)} tone="success" />
        <StatCard label="This page" value={formatMoney(pageTotal)} hint={`${items.length} payment${items.length === 1 ? '' : 's'}`} />
      </div>

      <Toolbar>
        <SearchInput value={p.search} onChange={(v) => list.setParam('search', v)} placeholder="Search invoice, customer or reference" />
        <select className="input" value={p.method} onChange={(e) => list.setParam('method', e.target.value)} aria-label="Method">
          <option value="">All methods</option>
          {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <label className="row" style={{ gap: 6 }}>
          <span className="muted">From</span>
          <input type="date" className="input" style={{ width: 'auto' }} value={p.from} max={p.to || undefined} onChange={(e) => list.setParam('from', e.target.value)} />
        </label>
        <label className="row" style={{ gap: 6 }}>
          <span className="muted">To</span>
          <input type="date" className="input" style={{ width: 'auto' }} value={p.to} min={p.from || undefined} onChange={(e) => list.setParam('to', e.target.value)} />
        </label>
        {hasFilters && (
          <button
            type="button"
            className="btn link"
            onClick={() => list.setParams((x) => ({ ...x, search: '', method: '', from: '', to: '', customer_id: '', invoice_id: '', page: 1 }))}
          >
            Clear filters
          </button>
        )}
      </Toolbar>

      <ErrorBanner error={list.error} />
      <DataTable
        columns={columns}
        rows={items}
        loading={list.loading}
        empty={hasFilters ? 'No payments match these filters' : 'No payments recorded yet'}
      />
      <Pagination page={page} pages={pages} total={total} onChange={list.setPage} />

      <InvoicePickerModal open={picker} onClose={() => setPicker(false)} onPick={(inv) => { setPicker(false); setPayInvoice(inv); }} />
      <RecordPaymentModal open={Boolean(payInvoice)} invoice={payInvoice} onClose={() => setPayInvoice(null)} onSaved={() => list.reload()} />
      <ConfirmDialog
        open={Boolean(reversing)}
        title="Reverse payment?"
        danger
        busy={busy}
        confirmLabel="Reverse payment"
        message={reversing ? `This removes the ${formatMoney(reversing.amount)} payment from ${reversing.invoice_number} and puts the amount back on the invoice balance. If the invoice was paid it goes back to confirmed.` : ''}
        onConfirm={reverse}
        onCancel={() => setReversing(null)}
      />
    </div>
  );
}
