// Shared UI kit. Import what you need:
//   import { DataTable, Pagination, FormField, Modal, ConfirmDialog, StatusBadge,
//            PageHeader, Toolbar, SearchInput, EmptyState, Card, useToast } from '../../components/ui';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/* ---------- Layout bits ---------- */

export function Card({ title, actions, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          {title && <h3>{title}</h3>}
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-header">
      <div>
        <h2>{title}</h2>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Toolbar({ children }) {
  return <div className="toolbar">{children}</div>;
}

export function EmptyState({ title = 'Nothing here yet', message, action }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      {message && <p className="muted">{message}</p>}
      {action}
    </div>
  );
}

export function ErrorBanner({ error }) {
  if (!error) return null;
  return <div className="alert alert-error" role="alert">{typeof error === 'string' ? error : error.message}</div>;
}

export function Spinner({ label = 'Loading...' }) {
  return <div className="page-loading" role="status">{label}</div>;
}

/* ---------- Status badges ---------- */

const STATUS_TONE = {
  draft: 'neutral',
  quotation: 'info',
  confirmed: 'info',
  active: 'success',
  paused: 'warning',
  closed: 'neutral',
  paid: 'success',
  cancelled: 'danger',
  overdue: 'danger',
  outstanding: 'warning',
  sent: 'info',
  inactive: 'neutral',
  admin: 'brand',
  staff: 'info',
  customer: 'neutral',
};

export function StatusBadge({ status, label, className = '' }) {
  const key = String(status || '').toLowerCase();
  return <span className={`badge badge-${STATUS_TONE[key] || 'neutral'} ${className}`.trim()}>{label || key.replace(/_/g, ' ') || '-'}</span>;
}

/* ---------- Table + pagination ---------- */

// columns: [{ key, label, render?: (row) => node, align?: 'right', width? }]
export function DataTable({ columns, rows, loading, empty = 'No records found', onRowClick, rowKey = 'id' }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ textAlign: c.align || 'left', width: c.width }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr><td colSpan={columns.length} className="muted center">Loading...</td></tr>
          )}
          {!loading && (!rows || rows.length === 0) && (
            <tr><td colSpan={columns.length} className="muted center">{empty}</td></tr>
          )}
          {!loading && rows?.map((row) => (
            <tr
              key={row[rowKey]}
              className={onRowClick ? 'clickable' : ''}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} style={{ textAlign: c.align || 'left' }}>
                  {c.render ? c.render(row) : row[c.key] ?? '-'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page = 1, pages = 1, total, onChange }) {
  if (!pages || pages <= 1) {
    return total !== undefined ? <div className="pagination muted">{total} record{total === 1 ? '' : 's'}</div> : null;
  }
  return (
    <div className="pagination">
      <span className="muted">{total} records &middot; page {page} of {pages}</span>
      <div className="pagination-buttons">
        <button type="button" className="btn ghost sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</button>
        <button type="button" className="btn ghost sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button>
      </div>
    </div>
  );
}

/* ---------- Forms ---------- */

// <FormField label="Name" error={fields.name}><input ... /></FormField>
export function FormField({ label, error, hint, children, required, className = '' }) {
  return (
    <label className={`field ${error ? 'has-error' : ''} ${className}`}>
      {label && <span className="field-label">{label}{required && <span className="req"> *</span>}</span>}
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

// Debounced search box: <SearchInput value={q} onChange={setQ} placeholder="Search products" />
export function SearchInput({ value, onChange, placeholder = 'Search...', delay = 300 }) {
  const [text, setText] = useState(value || '');
  const first = useRef(true);
  useEffect(() => { setText(value || ''); }, [value]);
  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    const id = setTimeout(() => { if (text !== (value || '')) onChange(text); }, delay);
    return () => clearTimeout(id);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input
      type="search"
      className="input search"
      value={text}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(e) => setText(e.target.value)}
    />
  );
}

/* ---------- Dialogs ---------- */

export function Modal({ open, title, onClose, children, footer, wide = false }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title = 'Are you sure?', message, confirmLabel = 'Confirm', danger, busy, onConfirm, onCancel }) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={(
        <>
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className={`btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working...' : confirmLabel}
          </button>
        </>
      )}
    >
      <p>{message}</p>
    </Modal>
  );
}

/* ---------- Tabs ---------- */

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          className={`tab ${value === t.value ? 'active' : ''}`}
          onClick={() => onChange(t.value)}
        >
          {t.label}{t.count !== undefined && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------- KPI tile ---------- */

export function StatCard({ label, value, hint, tone }) {
  return (
    <div className={`stat-card ${tone ? `tone-${tone}` : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint muted">{hint}</div>}
    </div>
  );
}

/* ---------- Toasts ---------- */

const ToastContext = createContext({ notify: () => {} });

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const notify = useCallback((message, type = 'success') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>)}
      </div>
    </ToastContext.Provider>
  );
}

// const toast = useToast(); toast.success('Saved'); toast.error(err.message)
export function useToast() {
  const { notify } = useContext(ToastContext);
  return {
    success: (m) => notify(m, 'success'),
    error: (m) => notify(m, 'error'),
    info: (m) => notify(m, 'info'),
  };
}
