// Pick an outstanding (confirmed) invoice, then hand it to RecordPaymentModal.
//   <InvoicePickerModal open onClose={...} onPick={(invoice) => ...} />
import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { ErrorBanner, Modal, SearchInput, StatusBadge } from '../ui';
import { formatDate, formatMoney } from '../../utils/format';

export default function InvoicePickerModal({ open, onClose, onPick }) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    api.get('/invoices', { status: 'confirmed', search, limit: 10 })
      .then((d) => { if (!cancelled) { setItems(d.items || []); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, search]);

  useEffect(() => { if (!open) setSearch(''); }, [open]);

  return (
    <Modal open={open} title="Record payment - choose an invoice" onClose={onClose} wide>
      <div className="stack">
        <SearchInput value={search} onChange={setSearch} placeholder="Search invoice number or customer" />
        <ErrorBanner error={error} />
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Due</th>
                <th style={{ textAlign: 'right' }}>Balance</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={5} className="muted center">Loading...</td></tr>}
              {!loading && items.length === 0 && (
                <tr><td colSpan={5} className="muted center">No outstanding invoices{search ? ` matching "${search}"` : ''}</td></tr>
              )}
              {!loading && items.map((inv) => (
                <tr key={inv.id}>
                  <td><strong>{inv.number}</strong></td>
                  <td>{inv.customer_name}</td>
                  <td>
                    {formatDate(inv.due_date)}{' '}
                    {inv.is_overdue ? <StatusBadge status="overdue" /> : null}
                  </td>
                  <td style={{ textAlign: 'right' }}>{formatMoney(inv.balance_due ?? (inv.total_amount - inv.amount_paid))}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" className="btn primary sm" onClick={() => onPick(inv)}>Select</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Only confirmed invoices with a balance can take payments.</p>
      </div>
    </Modal>
  );
}
