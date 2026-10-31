import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import {
  Card, DataTable, ErrorBanner, FormField, Modal, PageHeader, Spinner, StatusBadge, useToast,
} from '../../components/ui/index.jsx';
import { capitalize, formatDate, formatMoney } from '../../utils/format.js';
import { periodLabel } from './MySubscriptions.jsx';

const FLOW = ['quotation', 'confirmed', 'active', 'closed'];

const ACTIONS = {
  pause: {
    label: 'Pause', tone: 'ghost', title: 'Pause subscription',
    message: 'Billing stops while the subscription is paused. You can resume it at any time.',
  },
  resume: {
    label: 'Resume', tone: 'success', title: 'Resume subscription',
    message: 'The subscription becomes active again and billing continues from the next billing date.',
  },
  renew: {
    label: 'Renew', tone: 'primary', title: 'Renew subscription',
    message: 'The end date is extended by one more billing period.',
  },
  close: {
    label: 'Close subscription', tone: 'danger', title: 'Close subscription',
    message: 'Closing ends the subscription. No further invoices will be created. This cannot be undone from the portal.',
  },
};

function StatusFlow({ status }) {
  const current = status === 'paused' ? 'active' : status;
  const idx = FLOW.indexOf(current);
  return (
    <div className="status-flow" aria-label={`Status: ${status}`}>
      {FLOW.map((s, i) => (
        <span key={s} className={`status-step ${i < idx ? 'done' : ''} ${i === idx ? 'current' : ''}`}>
          {s === 'active' && status === 'paused' ? 'Paused' : capitalize(s)}
        </span>
      ))}
    </div>
  );
}

/** Actions the customer may take, from the API (allowed_actions) or the plan flags as a fallback. */
function availableActions(sub) {
  if (Array.isArray(sub.allowed_actions)) return sub.allowed_actions.filter((a) => ACTIONS[a]);
  const p = sub.plan || {};
  const out = [];
  if (sub.status === 'active' && p.pausable) out.push('pause');
  if (sub.status === 'paused' && p.pausable) out.push('resume');
  if (sub.status === 'active' && p.renewable) out.push('renew');
  if (['active', 'paused', 'confirmed'].includes(sub.status) && p.closable) out.push('close');
  return out;
}

export default function MySubscriptionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [sub, setSub] = useState(null);
  const [error, setError] = useState(null);
  const [action, setAction] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get(`/portal/subscriptions/${id}`).then((s) => { setSub(s); setError(null); }).catch(setError);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function run() {
    setBusy(true);
    try {
      const updated = await api.post(`/portal/subscriptions/${id}/${action}`, note.trim() ? { note: note.trim() } : {});
      setSub(updated);
      const done = { pause: 'paused', resume: 'resumed', renew: 'renewed', close: 'closed' }[action];
      toast.success(`Subscription ${done}`);
      setAction(null);
      setNote('');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="stack">
        <ErrorBanner error={error.status === 404 ? 'Subscription not found.' : error} />
        <Link to="/portal/subscriptions">Back to my subscriptions</Link>
      </div>
    );
  }
  if (!sub) return <Spinner />;

  const actions = availableActions(sub);
  const plan = sub.plan || {};
  const totals = sub.totals || {};

  const lineColumns = [
    {
      key: 'product_name',
      label: 'Product',
      render: (l) => (
        <div>
          <div style={{ fontWeight: 600 }}>{l.product_name}</div>
          {(l.variant_name || l.description) && <div className="muted" style={{ fontSize: 12.5 }}>{[l.variant_name, l.description].filter(Boolean).join(' \u00b7 ')}</div>}
        </div>
      ),
    },
    { key: 'quantity', label: 'Qty', align: 'right' },
    { key: 'unit_price', label: 'Unit price', align: 'right', render: (l) => formatMoney(l.unit_price) },
    { key: 'taxes', label: 'Taxes', render: (l) => (l.taxes?.length ? l.taxes.map((t) => t.name).join(', ') : '-') },
    { key: 'amount', label: 'Amount', align: 'right', render: (l) => formatMoney(l.amount) },
  ];
  const invoiceColumns = [
    { key: 'number', label: 'Invoice', render: (i) => <strong>{i.number}</strong> },
    { key: 'period', label: 'Period', render: (i) => (i.period_start ? `${formatDate(i.period_start)} - ${formatDate(i.period_end)}` : '-') },
    { key: 'due_date', label: 'Due', render: (i) => formatDate(i.due_date) },
    { key: 'status', label: 'Status', render: (i) => <StatusBadge status={i.is_overdue ? 'overdue' : i.status} /> },
    { key: 'total_amount', label: 'Total', align: 'right', render: (i) => formatMoney(i.total_amount) },
  ];

  return (
    <div className="stack">
      <div><Link to="/portal/subscriptions">&larr; My subscriptions</Link></div>
      <PageHeader
        title={sub.number}
        subtitle={`${sub.plan_name || plan.name || ''} \u00b7 ${periodLabel(plan.billing_period, plan.billing_interval)}`}
        actions={actions.map((a) => (
          <button key={a} type="button" className={`btn ${ACTIONS[a].tone}`} onClick={() => setAction(a)}>{ACTIONS[a].label}</button>
        ))}
      />
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <StatusFlow status={sub.status} />
        <StatusBadge status={sub.status} />
      </div>

      <div className="grid-2">
        <Card title="Details">
          <dl className="dl">
            <dt>Plan</dt><dd>{sub.plan_name || plan.name}</dd>
            <dt>Billing</dt><dd>{capitalize(plan.billing_period)}{plan.billing_interval > 1 ? ` (every ${plan.billing_interval})` : ''}</dd>
            <dt>Start date</dt><dd>{formatDate(sub.start_date)}</dd>
            <dt>End date</dt><dd>{sub.expiry_date ? formatDate(sub.expiry_date) : 'Until cancelled'}</dd>
            {sub.status === 'active' && <><dt>Next invoice</dt><dd>{formatDate(sub.next_invoice_date)}</dd></>}
            {sub.status === 'quotation' && sub.quotation_valid_until && <><dt>Quote valid until</dt><dd>{formatDate(sub.quotation_valid_until)}</dd></>}
            {sub.payment_term_name && <><dt>Payment terms</dt><dd>{sub.payment_term_name}</dd></>}
            {sub.closed_at && <><dt>Closed on</dt><dd>{formatDate(sub.closed_at)}</dd></>}
          </dl>
        </Card>
        <Card title="Plan options">
          <dl className="dl">
            <dt>Pause allowed</dt><dd>{plan.pausable ? 'Yes' : 'No'}</dd>
            <dt>Early close</dt><dd>{plan.closable ? 'Yes' : 'No'}</dd>
            <dt>Renewable</dt><dd>{plan.renewable ? 'Yes' : 'No'}</dd>
            <dt>Auto close at end</dt><dd>{plan.auto_close ? 'Yes' : 'No'}</dd>
          </dl>
        </Card>
      </div>

      <Card title="Products">
        <DataTable columns={lineColumns} rows={sub.lines || []} empty="No products on this subscription" />
        <div className="stack" style={{ alignItems: 'flex-end', marginTop: 12, gap: 4 }}>
          <div>Untaxed: <strong>{formatMoney(totals.untaxed)}</strong></div>
          <div>Tax: <strong>{formatMoney(totals.tax)}</strong></div>
          <div style={{ fontSize: 16 }}>Total per period: <strong>{formatMoney(totals.total)}</strong></div>
        </div>
      </Card>

      <Card title="Invoices">
        <DataTable columns={invoiceColumns} rows={sub.invoices || []} empty="No invoices yet" onRowClick={(i) => navigate(`/portal/invoices/${i.id}`)} />
      </Card>

      {sub.history?.length > 0 && (
        <Card title="History">
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }} className="stack">
            {[...sub.history].reverse().map((h) => (
              <li key={h.id} className="row" style={{ alignItems: 'baseline' }}>
                <span className="muted" style={{ minWidth: 110 }}>{formatDate(h.changed_at)}</span>
                <span>
                  {h.from_status && h.from_status !== h.to_status ? <>{capitalize(h.from_status)} &rarr; </> : null}
                  <strong>{capitalize(h.to_status)}</strong>
                  {h.note && <span className="muted"> &middot; {h.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Modal
        open={Boolean(action)}
        title={action ? ACTIONS[action].title : ''}
        onClose={() => !busy && setAction(null)}
        footer={(
          <>
            <button type="button" className="btn ghost" onClick={() => setAction(null)} disabled={busy}>Cancel</button>
            <button type="button" className={`btn ${action === 'close' ? 'danger' : 'primary'}`} onClick={run} disabled={busy}>
              {busy ? 'Working...' : `Yes, ${action ? ACTIONS[action].label.toLowerCase() : ''}`}
            </button>
          </>
        )}
      >
        {action && (
          <div className="stack">
            <p style={{ margin: 0 }}>{ACTIONS[action].message}</p>
            {(action === 'close' || action === 'pause') && (
              <FormField label="Reason (optional)">
                <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              </FormField>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
