// Billing run (owner: Swathy): preview due subscriptions, then generate invoices.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import {
  Card, ConfirmDialog, DataTable, ErrorBanner, FormField, PageHeader, StatCard, useToast,
} from '../../components/ui';
import { formatDate, formatMoney } from '../../utils/format';
import { periodText, todayIso } from '../subscriptions/subscriptionUtils';

const MAX_ROWS = 200; // keep the page light when thousands are due

export default function BillingRun() {
  const navigate = useNavigate();
  const toast = useToast();
  const [date, setDate] = useState(todayIso());
  const [autoConfirm, setAutoConfirm] = useState(false);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const loadPreview = useCallback(() => {
    setLoading(true);
    api.get('/billing/preview', { date })
      .then((d) => { setPreview(d); setError(null); })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [date]);
  useEffect(() => { loadPreview(); }, [loadPreview]);

  const run = async () => {
    setRunning(true);
    try {
      const r = await api.post('/billing/run', { date, auto_confirm: autoConfirm });
      setResult(r);
      setConfirming(false);
      toast.success(`Billing run done: ${r.created} invoice${r.created === 1 ? '' : 's'} created`);
      loadPreview();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setRunning(false);
    }
  };

  const dueColumns = [
    { key: 'number', label: 'Subscription', render: (r) => <Link to={`/subscriptions/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.number}</Link> },
    { key: 'customer_name', label: 'Customer' },
    { key: 'plan_name', label: 'Plan', render: (r) => <>{r.plan_name} <span className="muted">({periodText(r.billing_period)})</span></> },
    { key: 'next_invoice_date', label: 'Due since', render: (r) => formatDate(r.next_invoice_date) },
    { key: 'periods', label: 'Periods', align: 'right', render: (r) => (r.periods > 1 ? <strong style={{ color: 'var(--warning)' }}>{r.periods}</strong> : r.periods) },
    { key: 'estimated_untaxed', label: 'Est. untaxed', align: 'right', render: (r) => formatMoney(r.estimated_untaxed) },
  ];

  const resultColumns = [
    { key: 'number', label: 'Invoice', render: (r) => <Link to={`/invoices/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.number}</Link> },
    { key: 'customer_name', label: 'Customer' },
    { key: 'subscription_number', label: 'Subscription' },
    { key: 'period', label: 'Period', render: (r) => `${formatDate(r.period_start)} - ${formatDate(r.period_end)}` },
    { key: 'total_amount', label: 'Total', align: 'right', render: (r) => formatMoney(r.total_amount) },
  ];

  const estimated = preview ? preview.items.reduce((s, i) => s + i.estimated_untaxed, 0) : 0;
  const nothingToDo = preview && preview.periods === 0 && preview.to_close.length === 0;

  return (
    <>
      <PageHeader
        title="Billing run"
        subtitle="Creates one invoice per due billing period for every active subscription. Safe to run more than once: periods are never billed twice."
      />

      <Card>
        <div className="form-grid" style={{ alignItems: 'end' }}>
          <FormField label="Bill everything due on or before" hint="Missed periods are caught up one invoice each">
            <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setResult(null); }} />
          </FormField>
          <label className="field checkbox">
            <input type="checkbox" checked={autoConfirm} onChange={(e) => setAutoConfirm(e.target.checked)} />
            <span>Confirm invoices automatically (otherwise they are created as drafts)</span>
          </label>
        </div>
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={loadPreview} disabled={loading}>Refresh preview</button>
          <button
            type="button"
            className="btn primary"
            disabled={loading || running || !preview || nothingToDo}
            onClick={() => setConfirming(true)}
          >
            {running ? 'Running...' : 'Run billing'}
          </button>
        </div>
      </Card>

      <ErrorBanner error={error} />

      {result && (
        <Card title={`Result for ${formatDate(result.date)}`}>
          <div className="grid-4">
            <StatCard label="Invoices created" value={result.created} tone="success" />
            <StatCard label="Skipped (already billed)" value={result.skipped} />
            <StatCard label="Subscriptions closed" value={result.closed} tone={result.closed ? 'warning' : undefined} />
            <StatCard label="Errors" value={result.errors.length} tone={result.errors.length ? 'danger' : undefined} />
          </div>
          {result.errors.length > 0 && (
            <div className="alert alert-error" style={{ marginTop: 12 }}>
              {result.errors.map((e) => <div key={e.subscription_id}><strong>{e.number}</strong>: {e.error}</div>)}
            </div>
          )}
          {result.closed_subscriptions?.length > 0 && (
            <div className="alert alert-info" style={{ marginTop: 12 }}>
              Auto-closed after expiry: {result.closed_subscriptions.map((s, i) => (
                <span key={s.id}>{i > 0 && ', '}<Link to={`/subscriptions/${s.id}`}>{s.number}</Link></span>
              ))}
            </div>
          )}
          {result.invoices.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <DataTable columns={resultColumns} rows={result.invoices.slice(0, MAX_ROWS)} onRowClick={(r) => navigate(`/invoices/${r.id}`)} />
              {result.invoices.length > MAX_ROWS && (
                <p className="muted">Showing the first {MAX_ROWS} of {result.invoices.length} invoices. <Link to="/invoices">See all invoices</Link></p>
              )}
            </div>
          )}
        </Card>
      )}

      <Card title="Due for billing">
        {preview && (
          <div className="grid-4" style={{ marginBottom: 12 }}>
            <StatCard label="Subscriptions due" value={preview.subscriptions} />
            <StatCard label="Invoices to create" value={preview.periods} />
            <StatCard label="Estimated untaxed" value={formatMoney(estimated)} />
            <StatCard label="Will auto-close" value={preview.to_close.length} tone={preview.to_close.length ? 'warning' : undefined} />
          </div>
        )}
        <DataTable
          columns={dueColumns}
          rows={(preview?.items || []).slice(0, MAX_ROWS)}
          loading={loading}
          empty="Nothing is due on this date. All active subscriptions are billed up to date."
          onRowClick={(r) => navigate(`/subscriptions/${r.id}`)}
        />
        {preview && preview.items.length > MAX_ROWS && (
          <p className="muted">Showing the first {MAX_ROWS} of {preview.items.length} subscriptions due.</p>
        )}
      </Card>

      <ConfirmDialog
        open={confirming}
        title="Run billing?"
        message={`This creates ${preview?.periods ?? 0} ${autoConfirm ? 'confirmed' : 'draft'} invoice(s) for ${preview?.subscriptions ?? 0} subscription(s) due on or before ${formatDate(date)}${preview?.to_close.length ? ` and auto-closes ${preview.to_close.length} expired subscription(s)` : ''}.`}
        confirmLabel="Run billing"
        busy={running}
        onConfirm={run}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
