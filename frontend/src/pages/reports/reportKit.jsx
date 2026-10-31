// Shared bits for the dashboard and reports pages (owner: Merryl).
import { formatMoney } from '../../utils/format';

const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayIso = () => isoDate(new Date());

export const PRESETS = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'this_quarter', label: 'This quarter' },
  { value: 'this_year', label: 'This year' },
  { value: 'last_12', label: 'Last 12 months' },
  { value: 'custom', label: 'Custom range' },
];

/** { from, to } for a preset, based on the browser's today. */
export function presetRange(preset, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case 'last_month':
      return { from: isoDate(new Date(y, m - 1, 1)), to: isoDate(new Date(y, m, 0)) };
    case 'this_quarter': {
      const q = Math.floor(m / 3) * 3;
      return { from: isoDate(new Date(y, q, 1)), to: isoDate(now) };
    }
    case 'this_year':
      return { from: `${y}-01-01`, to: isoDate(now) };
    case 'last_12':
      return { from: isoDate(new Date(y, m - 11, 1)), to: isoDate(now) };
    case 'this_month':
    default:
      return { from: isoDate(new Date(y, m, 1)), to: isoDate(now) };
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (ym, withYear = false) => {
  const [y, m] = String(ym).split('-');
  return `${MONTHS[Number(m) - 1] || m}${withYear ? ` ${y}` : ` '${String(y).slice(2)}`}`;
};

export const METHOD_LABELS = {
  bank_transfer: 'Bank transfer', upi: 'UPI', cash: 'Cash', card: 'Card', cheque: 'Cheque', other: 'Other',
};

/** Compact INR: 1.2 Cr, 3.4 L, 12.5 K */
export function compactMoney(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  if (abs >= 1e3) return `₹${(v / 1e3).toFixed(1)} K`;
  return formatMoney(v);
}

/** Download rows as CSV. columns: [{ key, label, value?: (row) => any }] */
export function downloadCsv(filename, columns, rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    columns.map((c) => esc(c.label)).join(','),
    ...rows.map((r) => columns.map((c) => esc(c.value ? c.value(r) : r[c.key])).join(',')),
  ];
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Grouped CSS bar chart: invoiced vs collected per month. */
export function RevenueBars({ items, height = 200 }) {
  const max = Math.max(1, ...items.map((r) => Math.max(r.invoiced, r.collected)));
  return (
    <div className="rk-chart">
      <div className="rk-legend">
        <span><i className="rk-swatch rk-invoiced" /> Invoiced</span>
        <span><i className="rk-swatch rk-collected" /> Collected</span>
      </div>
      <div className="bar-chart" style={{ height }} role="img" aria-label="Invoiced and collected revenue per month">
        {items.map((r) => (
          <div className="bar-col" key={r.month} title={`${monthLabel(r.month, true)}\nInvoiced: ${formatMoney(r.invoiced)}\nCollected: ${formatMoney(r.collected)}`}>
            <span className="rk-bar-value">{r.invoiced ? compactMoney(r.invoiced) : ''}</span>
            <div className="rk-pair">
              <div className="bar rk-invoiced" style={{ height: `${(r.invoiced / max) * 100}%` }} />
              <div className="bar rk-collected" style={{ height: `${(r.collected / max) * 100}%` }} />
            </div>
            <span className="bar-label">{monthLabel(r.month)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Horizontal share bar used in small breakdown tables. */
export function ShareBar({ value, max, tone = 'brand' }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="rk-share" aria-hidden="true">
      <div className={`rk-share-fill rk-${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Timing({ ms }) {
  if (ms === undefined || ms === null) return null;
  return <span className="rk-timing" title="Server time to compute this report">computed in {ms} ms</span>;
}

/** Page-scoped styles (kept here so the shared theme file stays untouched). */
export function ReportStyles() {
  return (
    <style>{`
      .rk-chart { display: flex; flex-direction: column; gap: 6px; }
      .rk-legend { display: flex; gap: 16px; font-size: 12px; color: var(--muted); }
      .rk-legend span { display: inline-flex; align-items: center; gap: 6px; }
      .rk-swatch { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
      .rk-invoiced { background: var(--brand); }
      .rk-collected { background: #3aa57a; }
      .rk-pair { display: flex; align-items: flex-end; justify-content: center; gap: 3px; width: 100%; flex: 1; min-height: 0; }
      .rk-pair .bar { max-width: 22px; transition: height .3s ease; }
      .rk-bar-value { font-size: 10px; color: var(--muted); white-space: nowrap; min-height: 12px; }
      .rk-share { height: 8px; background: #f2f4f7; border-radius: 999px; overflow: hidden; min-width: 80px; }
      .rk-share-fill { height: 100%; border-radius: 999px; }
      .rk-brand { background: var(--brand); }
      .rk-success { background: #3aa57a; }
      .rk-warning { background: #f0a020; }
      .rk-danger { background: var(--danger); }
      .rk-timing { font-size: 11px; color: var(--muted); background: #f2f4f7; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
      .rk-kpis { display: grid; gap: 14px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .table th { text-align: left; }
      .table th.num, .table td.num { text-align: right; }
      .rk-kpis .stat-value { font-size: 21px; }
      .rk-grid { display: grid; gap: 16px; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); }
      .rk-buckets { display: grid; gap: 12px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .rk-bucket { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; background: var(--surface); }
      .rk-bucket strong { display: block; font-size: 18px; margin-top: 2px; }
      .rk-bucket.b3 strong { color: var(--danger); }
      .rk-status-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
      .rk-status-list li { display: grid; grid-template-columns: 96px 1fr 56px; align-items: center; gap: 10px; font-size: 14px; }
      .rk-status-list li span:last-child { text-align: right; font-weight: 600; }
      .rk-quick { display: flex; flex-direction: column; gap: 8px; }
      .rk-quick .btn { justify-content: flex-start; }
      .rk-filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; }
      .rk-filters .field { min-width: 150px; }
      .rk-customer { position: relative; min-width: 220px; }
      .rk-suggest { position: absolute; z-index: 20; top: 100%; left: 0; right: 0; background: var(--surface); border: 1px solid var(--border);
        border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.08); margin-top: 4px; max-height: 240px; overflow: auto; }
      .rk-suggest button { display: block; width: 100%; text-align: left; padding: 8px 10px; border: none; background: none; font: inherit; cursor: pointer; }
      .rk-suggest button:hover { background: var(--brand-light); }
      .rk-chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 999px; background: var(--brand-light); color: var(--brand); font-weight: 600; font-size: 13px; }
      .rk-chip button { border: none; background: none; color: inherit; cursor: pointer; font-size: 15px; line-height: 1; padding: 0; }
      .rk-section-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin: 16px 0 10px; }
      .rk-section-head h3 { margin: 0; font-size: 16px; }
      .rk-section-head select.input, .card-actions select.input { width: auto; }
      .rk-total-row td { font-weight: 700; background: #fafafa; }
      .num { text-align: right; font-variant-numeric: tabular-nums; }
      @media (max-width: 900px) {
        .rk-grid { grid-template-columns: 1fr; }
        .rk-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .rk-buckets { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (max-width: 640px) {
        .rk-kpis { grid-template-columns: 1fr; }
        .rk-bar-value { display: none; }
        .rk-pair .bar { max-width: 10px; }
      }
    `}</style>
  );
}
