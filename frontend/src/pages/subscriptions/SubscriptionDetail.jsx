// Subscription detail with lifecycle actions (owner: Swathy).
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import {
  Card, ConfirmDialog, DataTable, ErrorBanner, FormField, Modal, PageHeader, Spinner, StatusBadge, useToast,
} from '../../components/ui';
import { capitalize, formatDate, formatMoney } from '../../utils/format';
import { ACTION_META, FLOW, periodText } from './subscriptionUtils';

function StatusFlow({ status }) {
  const current = status === 'paused' ? 'active' : status;
  const idx = FLOW.indexOf(current);
  return (
    <div className="status-flow" aria-label="Subscription progress">
      {FLOW.map((s, i) => (
        <span key={s} className={`status-step ${i < idx ? 'done' : ''} ${i === idx ? 'current' : ''}`}>
          {s === 'active' && status === 'paused' ? 'Paused' : capitalize(s)}
        </span>
      ))}
    </div>
  );
}

function Timeline({ items }) {
  if (!items.length) return <p className="muted">No history yet.</p>;
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {[...items].reverse().map((h) => (
        <li key={h.id} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
          <span
            aria-hidden="true"
            style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--brand)', marginTop: 6, flex: '0 0 auto' }}
          />
          <div style={{ flex: 1 }}>
            <div>
              {h.from_status ? (
                h.from_status === h.to_status
                  ? <><StatusBadge status={h.to_status} /> <span className="muted">updated</span></>
                  : <><StatusBadge status={h.from_status} /> <span className="muted">&rarr;</span> <StatusBadge status={h.to_status} /></>
              ) : <><span className="muted">Created as</span> <StatusBadge status={h.to_status} /></>}
            </div>
            {h.note && <div style={{ marginTop: 4 }}>{h.note}</div>}
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              {new Date(h.changed_at).toLocaleString('en-IN')}{h.changed_by_name ? ` · ${h.changed_by_name}` : ' · System'}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function SubscriptionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [sub, setSub] = useState(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null); // action name or 'delete' | 'invoice'
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get(`/subscriptions/${id}`).then((s) => { setSub(s); setError(null); }).catch(setError);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const close = () => { setPending(null); setNote(''); };

  const run = async () => {
    setBusy(true);
    try {
      if (pending === 'delete') {
        await api.delete(`/subscriptions/${id}`);
        toast.success('Draft deleted');
        navigate('/subscriptions');
        return;
      }
      if (pending === 'invoice') {
        const inv = await api.post(`/subscriptions/${id}/invoice`, {});
        toast.success(`Invoice ${inv.number} created`);
        close();
        load();
        return;
      }
      const meta = ACTION_META[pending];
      const body = meta.note ? (pending === 'close' ? { reason: note } : { note }) : {};
      const updated = await api.post(`/subscriptions/${id}/actions/${pending}`, body);
      setSub(updated);
      toast.success(`${meta.label}: done`);
      close();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorBanner error={error} />;
  if (!sub) return <Spinner />;

  const editable = ['draft', 'quotation'].includes(sub.status);
  const actions = sub.allowed_actions || [];
  const plan = sub.plan || {};
  const meta = pending && ACTION_META[pending];
  const quotationExpired = sub.quotation_valid_until && sub.quotation_valid_until < new Date().toISOString().slice(0, 10)
    && ['draft', 'quotation'].includes(sub.status);

  const lineColumns = [
    {
      key: 'product_name',
      label: 'Product',
      render: (l) => (
        <>
          <strong>{l.product_name}</strong>
          {l.variant_name && <div className="muted" style={{ fontSize: 12 }}>{l.variant_name}</div>}
          {l.description && <div className="muted" style={{ fontSize: 12 }}>{l.description}</div>}
        </>
      ),
    },
    { key: 'quantity', label: 'Qty', align: 'right' },
    { key: 'unit_price', label: 'Unit price', align: 'right', render: (l) => formatMoney(l.unit_price) },
    { key: 'taxes', label: 'Taxes', render: (l) => (l.taxes.length ? l.taxes.map((t) => t.name).join(', ') : '-') },
    { key: 'amount', label: 'Amount', align: 'right', render: (l) => formatMoney(l.amount) },
    { key: 'tax_amount', label: 'Tax', align: 'right', render: (l) => formatMoney(l.tax_amount) },
    { key: 'total', label: 'Total', align: 'right', render: (l) => <strong>{formatMoney(l.total)}</strong> },
  ];

  const invoiceColumns = [
    { key: 'number', label: 'Invoice', render: (i) => <Link to={`/invoices/${i.id}`} onClick={(e) => e.stopPropagation()}>{i.number}</Link> },
    { key: 'period', label: 'Period', render: (i) => (i.period_start ? <span style={{ whiteSpace: 'nowrap' }}>{formatDate(i.period_start)} - {formatDate(i.period_end)}</span> : '-') },
    { key: 'due_date', label: 'Due', render: (i) => <span style={{ whiteSpace: 'nowrap' }}>{formatDate(i.due_date)}</span> },
    { key: 'total_amount', label: 'Total', align: 'right', render: (i) => formatMoney(i.total_amount) },
    { key: 'balance_due', label: 'Balance', align: 'right', render: (i) => (i.status === 'cancelled' ? '-' : formatMoney(i.balance_due)) },
    { key: 'status', label: 'Status', render: (i) => <StatusBadge status={i.is_overdue ? 'overdue' : i.status} /> },
  ];

  return (
    <>
      <PageHeader
        title={<>{sub.number} <StatusBadge status={sub.status} /></>}
        subtitle={`${sub.customer_name} · ${sub.plan_name} (${periodText(plan.billing_period, plan.billing_interval)})`}
        actions={(
          <>
            <Link className="btn ghost" to="/subscriptions">Back</Link>
            {editable && <Link className="btn ghost" to={`/subscriptions/${sub.id}/edit`}>Edit</Link>}
            {sub.status === 'draft' && <button type="button" className="btn danger" onClick={() => setPending('delete')}>Delete</button>}
            {sub.status === 'active' && (
              <button type="button" className="btn ghost" onClick={() => setPending('invoice')}>Generate invoice now</button>
            )}
            {actions.map((a) => (
              <button key={a} type="button" className={`btn ${ACTION_META[a].tone}`} onClick={() => setPending(a)}>
                {ACTION_META[a].label}
              </button>
            ))}
          </>
        )}
      />

      <Card>
        <StatusFlow status={sub.status} />
        {quotationExpired && (
          <div className="alert alert-error" style={{ marginTop: 12 }}>
            The quotation expired on {formatDate(sub.quotation_valid_until)}. Edit it to refresh before confirming.
          </div>
        )}
        {sub.status === 'closed' && sub.close_reason && (
          <div className="alert alert-info" style={{ marginTop: 12 }}>Closed: {sub.close_reason}</div>
        )}
      </Card>

      <div className="grid-2">
        <Card title="Subscription">
          <dl className="dl">
            <dt>Customer</dt><dd><Link to={`/customers/${sub.customer_id}`}>{sub.customer_name}</Link>{sub.customer_email && <div className="muted">{sub.customer_email}</div>}</dd>
            <dt>Plan</dt><dd>{sub.plan_name} &middot; {periodText(plan.billing_period, plan.billing_interval)}</dd>
            <dt>Payment term</dt><dd>{sub.payment_term_name || 'Immediate'}</dd>
            <dt>Start date</dt><dd>{formatDate(sub.start_date)}</dd>
            <dt>Expiry date</dt><dd>{sub.expiry_date ? formatDate(sub.expiry_date) : 'Open-ended'}</dd>
            {sub.quotation_valid_until && <><dt>Quotation valid until</dt><dd>{formatDate(sub.quotation_valid_until)}</dd></>}
            <dt>Next invoice</dt><dd>{sub.next_invoice_date ? formatDate(sub.next_invoice_date) : '-'}</dd>
            {sub.template_name && <><dt>Template</dt><dd>{sub.template_name}</dd></>}
            <dt>Salesperson</dt><dd>{sub.salesperson_name || '-'}</dd>
            {sub.notes && <><dt>Notes</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{sub.notes}</dd></>}
          </dl>
        </Card>
        <Card title="Plan rules">
          <dl className="dl">
            <dt>Minimum quantity</dt><dd>{plan.min_quantity}</dd>
            <dt>Auto-close at expiry</dt><dd>{plan.auto_close ? 'Yes' : 'No'}</dd>
            <dt>Can be closed early</dt><dd>{plan.closable ? 'Yes' : 'No'}</dd>
            <dt>Can be paused</dt><dd>{plan.pausable ? 'Yes' : 'No'}</dd>
            <dt>Renewable</dt><dd>{plan.renewable ? 'Yes' : 'No'}</dd>
          </dl>
          <div className="grid-3" style={{ marginTop: 12 }}>
            <div><div className="muted">Untaxed</div><strong>{formatMoney(sub.totals.untaxed)}</strong></div>
            <div><div className="muted">Taxes</div><strong>{formatMoney(sub.totals.tax)}</strong></div>
            <div><div className="muted">Total / period</div><strong>{formatMoney(sub.totals.total)}</strong></div>
          </div>
        </Card>
      </div>

      <Card title="Order lines">
        <DataTable columns={lineColumns} rows={sub.lines} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <table className="table" style={{ width: 'auto', minWidth: 280 }}>
            <tbody>
              <tr><td>Untaxed amount</td><td style={{ textAlign: 'right' }}>{formatMoney(sub.totals.untaxed)}</td></tr>
              <tr><td>Taxes</td><td style={{ textAlign: 'right' }}>{formatMoney(sub.totals.tax)}</td></tr>
              <tr><td><strong>Total</strong></td><td style={{ textAlign: 'right' }}><strong>{formatMoney(sub.totals.total)}</strong></td></tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={`Invoices (${sub.invoices.length})`} actions={sub.invoices.length > 0 ? <Link className="btn link sm" to={`/invoices?subscription=${sub.id}`}>Open in invoices</Link> : null}>
          <DataTable
            columns={invoiceColumns}
            rows={sub.invoices}
            empty={sub.status === 'active' ? 'No invoices yet. Run billing or generate one now.' : 'No invoices yet'}
            onRowClick={(i) => navigate(`/invoices/${i.id}`)}
          />
      </Card>
      <Card title="History">
        <Timeline items={sub.history} />
      </Card>

      {pending === 'delete' && (
        <ConfirmDialog
          open
          danger
          title="Delete draft?"
          message={`${sub.number} will be removed permanently.`}
          confirmLabel="Delete"
          busy={busy}
          onConfirm={run}
          onCancel={close}
        />
      )}
      {pending === 'invoice' && (
        <ConfirmDialog
          open
          title="Generate invoice now?"
          message={`A draft invoice for the period starting ${formatDate(sub.next_invoice_date || sub.start_date)} will be created, and the next billing date moves forward one period.`}
          confirmLabel="Generate invoice"
          busy={busy}
          onConfirm={run}
          onCancel={close}
        />
      )}
      {meta && !meta.note && (
        <ConfirmDialog
          open
          title={`${meta.label}?`}
          message={meta.message}
          confirmLabel={meta.label}
          danger={meta.tone === 'danger'}
          busy={busy}
          onConfirm={run}
          onCancel={close}
        />
      )}
      {meta && meta.note && (
        <Modal
          open
          title={`${meta.label}?`}
          onClose={close}
          footer={(
            <>
              <button type="button" className="btn ghost" onClick={close} disabled={busy}>Cancel</button>
              <button type="button" className={`btn ${meta.tone === 'danger' ? 'danger' : 'primary'}`} onClick={run} disabled={busy}>
                {busy ? 'Working...' : meta.label}
              </button>
            </>
          )}
        >
          <p>{meta.message}</p>
          <FormField label={meta.noteLabel || 'Note'} hint="Saved in the history">
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
        </Modal>
      )}
    </>
  );
}
