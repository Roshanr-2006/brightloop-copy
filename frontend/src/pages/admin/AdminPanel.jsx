// Admin panel: overview, data loading (demo dataset + CSV import) and admin security.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Database, KeyRound, Upload } from 'lucide-react';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Card, ConfirmDialog, DataTable, ErrorBanner, FormField, Spinner, StatusBadge, Tabs, useToast } from '../../components/ui/index.jsx';
import { passwordIssues } from '../../utils/validators.js';
import { PasswordChecklist } from '../auth/AuthCard.jsx';
import './admin.css';

const fmtBytes = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fmtUptime = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}m`);

/* ------------------------------------------------------------------ Overview */
function Overview({ data, onGoLoad }) {
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="admin-stats">
        {data.counts.filter((c) => c.count !== null).map((c) => (
          <div className="admin-stat" key={c.table}>
            <div className="num">{c.count.toLocaleString('en-IN')}</div>
            <div className="lbl">{c.label}</div>
          </div>
        ))}
      </div>
      <div className="admin-two">
        <Card title="System">
          <table className="table"><tbody>
            <tr><td className="muted">Database</td><td>{data.database.file} ({fmtBytes(data.database.sizeBytes)})</td></tr>
            <tr><td className="muted">Environment</td><td><StatusBadge status={data.server.env === 'production' ? 'active' : 'draft'} label={data.server.env} /></td></tr>
            <tr><td className="muted">Node</td><td>{data.server.node}</td></tr>
            <tr><td className="muted">API uptime</td><td>{fmtUptime(data.server.uptimeSeconds)}</td></tr>
            <tr><td className="muted">Admins / staff / customers</td><td>{data.roles.admin || 0} / {data.roles.staff || 0} / {data.roles.customer || 0}</td></tr>
          </tbody></table>
        </Card>
        <Card title="Demo data">
          {data.demo.loaded
            ? <p>Demo dataset is loaded ({data.demo.customers.toLocaleString('en-IN')} demo customers).</p>
            : <p>No demo data yet. The database only has the starter catalog.</p>}
          <button type="button" className="btn primary" onClick={onGoLoad}><Upload size={15} /> Go to data loader</button>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Load data */
function DemoLoader({ demoLoaded, onFinished }) {
  const toast = useToast();
  const [job, setJob] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState(null);
  const wasRunning = useRef(false);

  const poll = useCallback(async () => {
    try { setJob(await api.get('/admin/demo-data')); } catch (e) { setError(e); }
  }, []);

  useEffect(() => { poll(); }, [poll]);
  useEffect(() => {
    if (job?.status !== 'running') {
      if (wasRunning.current) {
        wasRunning.current = false;
        if (job?.status === 'done') toast.success('Demo data loader finished');
        else toast.error('Demo data loader failed, see the log');
        onFinished();
      }
      return undefined;
    }
    wasRunning.current = true;
    const id = setInterval(poll, 1500);
    return () => clearInterval(id);
  }, [job?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    setConfirm(false);
    try { setJob(await api.post('/admin/demo-data', { force: demoLoaded })); setError(null); } catch (e) { setError(e); }
  }

  const running = job?.status === 'running';
  return (
    <Card title="Sample dataset">
      <div className="stack">
        <p className="admin-note">Adds about 5,000 customers, 6,000 subscriptions, 15,000 invoices and matching payments. Nothing is deleted. Takes up to a minute.</p>
        <ErrorBanner error={error} />
        {running && <div className="progress" role="progressbar" aria-label="Loading demo data"><span /></div>}
        <div className="row">
          <button type="button" className="btn primary" disabled={running} onClick={() => (demoLoaded ? setConfirm(true) : start())}>
            <Database size={15} /> {running ? 'Loading...' : demoLoaded ? 'Add another batch' : 'Load demo data'}
          </button>
          {job && job.status !== 'idle' && <StatusBadge status={job.status === 'done' ? 'active' : job.status === 'failed' ? 'overdue' : 'sent'} label={job.status} />}
        </div>
        {job?.log?.length > 0 && <div className="log-box" aria-label="Loader log">{job.log.join('\n')}</div>}
      </div>
      <ConfirmDialog
        open={confirm}
        title="Add another demo batch?"
        message="Demo data already exists. This adds another 5,000 customers and their subscriptions and invoices on top."
        confirmLabel="Add batch"
        onConfirm={start}
        onCancel={() => setConfirm(false)}
      />
    </Card>
  );
}

const CSV_TEMPLATE = 'name,email,company_name,phone,billing_address,city,state,country,tax_id\nAsha Menon,asha@example.com,Lotus Traders,+91 98470 00000,12 MG Road,Kochi,Kerala,India,\n';

function CustomerImport({ onFinished }) {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [csv, setCsv] = useState('');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const input = useRef(null);

  async function pick(f) {
    if (!f) return;
    if (!/\.csv$/i.test(f.name) && f.type !== 'text/csv') { setError('Please choose a .csv file'); return; }
    setError(null); setResult(null); setFile(f); setCsv(await f.text());
  }

  async function run(dryRun) {
    setBusy(true); setError(null);
    try {
      const r = await api.post('/admin/import/customers', { csv, dryRun });
      setResult(r);
      if (!dryRun) { toast.success(`${r.inserted} customers imported`); onFinished(); }
    } catch (e) { setError(e.fields?.csv || e.message); } finally { setBusy(false); }
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'customers-template.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  const cols = [
    { key: 'line', label: 'Line', width: 70 },
    { key: 'email', label: 'Email', render: (e) => e.email || '-' },
    { key: 'message', label: 'Problem' },
  ];

  return (
    <Card title="Import customers (CSV)" actions={<button type="button" className="btn link" onClick={downloadTemplate}>Download template</button>}>
      <div className="stack">
        <div
          className={`dropzone ${over ? 'over' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') input.current?.click(); }}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); }}
        >
          <strong>{file ? file.name : 'Drop a CSV here or click to browse'}</strong>
          <span className="muted">Required columns: name, email. Duplicate emails are skipped. Max 5,000 rows.</span>
          <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => pick(e.target.files[0])} />
        </div>
        <ErrorBanner error={error} />
        <div className="row">
          <button type="button" className="btn ghost" disabled={!csv || busy} onClick={() => run(true)}>Preview (no changes)</button>
          <button type="button" className="btn primary" disabled={!csv || busy} onClick={() => run(false)}>{busy ? 'Working...' : 'Import'}</button>
        </div>
        {result && (
          <div className={`alert ${result.errorCount ? 'alert-info' : 'alert-success'}`}>
            {result.dryRun ? `Preview: ${result.wouldInsert} new` : `Imported ${result.inserted}`}, {result.skipped} duplicates skipped, {result.errorCount} invalid rows, of {result.total} rows.
          </div>
        )}
        {result?.errors?.length > 0 && <DataTable columns={cols} rows={result.errors} rowKey="line" />}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ Security */
function strength(pw) {
  const unmet = passwordIssues(pw).filter((i) => !i.includes('at most')).length;
  const score = pw ? Math.max(4 - unmet, 1) : 0;
  return { pct: score * 25, color: ['var(--border)', 'var(--danger)', 'var(--warning)', 'var(--warning)', 'var(--success)'][score] };
}

function ChangeAdminPassword() {
  const toast = useToast();
  const { user } = useAuth();
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm: '' });
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const s = strength(form.new_password);

  async function submit(e) {
    e.preventDefault();
    const errs = {};
    if (!form.current_password) errs.current_password = 'Enter your current password';
    if (passwordIssues(form.new_password).length) errs.new_password = 'Password does not meet all the rules';
    if (form.confirm !== form.new_password) errs.confirm = 'Passwords do not match';
    setFields(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await api.post('/auth/change-password', { current_password: form.current_password, new_password: form.new_password });
      toast.success('Admin password changed');
      setForm({ current_password: '', new_password: '', confirm: '' });
    } catch (err) {
      setFields(err.fields || {});
      if (!err.fields) toast.error(err.message);
    } finally { setBusy(false); }
  }

  return (
    <Card title="Change admin password">
      <form className="stack" onSubmit={submit} noValidate>
        <p className="admin-note">Signed in as <strong>{user?.email}</strong>. Other sessions stay valid until they expire.</p>
        <FormField label="Current password" error={fields.current_password}>
          <input type="password" autoComplete="current-password" value={form.current_password} onChange={set('current_password')} />
        </FormField>
        <FormField label="New password" error={fields.new_password}>
          <input type="password" autoComplete="new-password" value={form.new_password} onChange={set('new_password')} />
          <div className="strength" aria-hidden="true"><span style={{ width: `${s.pct}%`, background: s.color }} /></div>
          <PasswordChecklist password={form.new_password} />
        </FormField>
        <FormField label="Confirm new password" error={fields.confirm}>
          <input type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />
        </FormField>
        <div className="form-actions">
          <button type="submit" className="btn primary" disabled={busy}><KeyRound size={15} /> {busy ? 'Saving...' : 'Update password'}</button>
        </div>
      </form>
    </Card>
  );
}

/* ------------------------------------------------------------------ Page */
export default function AdminPanel() {
  const { user } = useAuth();
  const [tab, setTab] = useState('overview');
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api.get('/admin/overview').then((d) => { setOverview(d); setError(null); }).catch(setError);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="admin-hero">
        <div>
          <h2>Admin panel</h2>
          <p>Manage data and security for your Brightloop workspace.</p>
        </div>
        <span className="pill">{user?.name} &middot; admin</span>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[{ value: 'overview', label: 'Overview' }, { value: 'data', label: 'Load data' }, { value: 'security', label: 'Security' }]}
      />
      <ErrorBanner error={error} />
      {tab === 'overview' && (overview ? <Overview data={overview} onGoLoad={() => setTab('data')} /> : !error && <Spinner />)}
      {tab === 'data' && (
        <div className="admin-two">
          <DemoLoader demoLoaded={Boolean(overview?.demo.loaded)} onFinished={load} />
          <CustomerImport onFinished={load} />
        </div>
      )}
      {tab === 'security' && <div className="admin-two"><ChangeAdminPassword /></div>}
    </div>
  );
}
