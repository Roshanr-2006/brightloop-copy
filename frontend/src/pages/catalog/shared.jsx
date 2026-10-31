// Shared bits for the catalog pages (owner: Roshan).
import { useCallback, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { StatusBadge } from '../../components/ui/index.jsx';
import './catalog.css';

/** true when the logged-in user may edit configuration. */
export function useIsAdmin() {
  const { user } = useAuth();
  return user?.role === 'admin';
}

/** Simple form state with server field errors. */
export function useForm(initial) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const set = useCallback((key, value) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => {
      if (!e[key]) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  }, []);
  /** Props for a controlled input: <input {...bind('name')} /> */
  const bind = (key) => ({
    value: values[key] ?? '',
    onChange: (e) => set(key, e.target.type === 'checkbox' ? e.target.checked : e.target.value),
  });
  return { values, setValues, set, bind, errors, setErrors };
}

/** Active / archived / all select for list toolbars. */
export function ActiveFilter({ value, onChange }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Show">
      <option value="1">Active</option>
      <option value="0">Archived</option>
      <option value="all">All</option>
    </select>
  );
}

export function ActiveBadge({ active }) {
  return active ? <StatusBadge status="active" /> : <StatusBadge status="inactive" label="archived" />;
}

/** Banner shown to staff on read-only configuration pages. */
export function ReadOnlyNote({ what = 'configuration' }) {
  return (
    <div className="alert alert-info readonly-note">
      You can view this {what}. Only an admin can change it.
    </div>
  );
}

/** Checkbox pills for multi-select (taxes, products). options: [{ value, label, hint? }] */
export function CheckGroup({ options, value = [], onChange, disabled, scroll = false, empty = 'Nothing to choose from' }) {
  if (!options.length) return <span className="muted">{empty}</span>;
  const toggle = (v) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div className={`check-group ${scroll ? 'check-scroll' : ''}`}>
      {options.map((o) => {
        const checked = value.includes(o.value);
        return (
          <label key={o.value} className={`check-pill ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}`} title={o.hint}>
            <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggle(o.value)} />
            {o.label}
          </label>
        );
      })}
    </div>
  );
}

const PERIOD_UNIT = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };

/** "Monthly", "Every 3 months" */
export function periodLabel(period, interval = 1) {
  const n = Number(interval) || 1;
  if (n === 1) return period ? period.charAt(0).toUpperCase() + period.slice(1) : '-';
  return `Every ${n} ${PERIOD_UNIT[period] || period}s`;
}

/** Number input value -> number or '' (keeps empty input editable). */
export const num = (v) => (v === '' || v === null || v === undefined ? '' : Number(v));

/** Turn an ApiError into { message, fields } for forms. */
export function apiErrorParts(err) {
  return { message: err?.message || 'Something went wrong', fields: err?.fields || {} };
}

/** Percent or fixed tax label: "18%" / "₹ 150.00 per unit" */
export function taxRateLabel(tax, formatMoney) {
  if (!tax) return '';
  return tax.computation === 'fixed' ? `${formatMoney(tax.amount)} / unit` : `${Number(tax.amount)}%`;
}

/** Tax amount for a base (mirrors backend utils/money.js). */
export function lineTax(taxes, base, qty) {
  return (taxes || []).reduce((s, t) => {
    const amt = t.computation === 'fixed' ? Number(t.amount) * qty : (base * Number(t.amount)) / 100;
    return s + Math.round(amt * 100) / 100;
  }, 0);
}
