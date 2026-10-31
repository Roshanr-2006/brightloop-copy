// Small helpers shared by the subscription and invoice pages (owner: Swathy).

export const SUB_STATUSES = ['draft', 'quotation', 'confirmed', 'active', 'paused', 'closed'];

export const FLOW = ['draft', 'quotation', 'confirmed', 'active', 'closed'];

export const PERIOD_LABEL = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };

export function periodText(period, interval = 1) {
  const unit = PERIOD_LABEL[period] || period;
  return Number(interval) > 1 ? `every ${interval} ${unit}s` : `per ${unit}`;
}

export const ACTION_META = {
  send: { label: 'Send quotation', tone: 'primary', message: 'The customer will receive the quotation by email and the subscription moves to Quotation.' },
  confirm: { label: 'Confirm', tone: 'primary', message: 'Confirm this subscription? Lines can no longer be edited afterwards.' },
  activate: { label: 'Activate', tone: 'success', message: 'Activate the subscription? Billing starts from the start date.' },
  pause: { label: 'Pause', tone: 'ghost', message: 'Pause the subscription? No invoices are generated while paused.', note: true },
  resume: { label: 'Resume', tone: 'success', message: 'Resume billing for this subscription?' },
  renew: { label: 'Renew', tone: 'ghost', message: 'Extend the expiry date by one billing period?' },
  close: { label: 'Close', tone: 'danger', message: 'Close this subscription? It will no longer be billed.', note: true, noteLabel: 'Reason' },
};

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Same maths as backend utils/money computeLine (taxes on the line amount). */
export function lineTotals(quantity, unitPrice, taxes = []) {
  const qty = Number(quantity) || 0;
  const amount = round2(qty * (Number(unitPrice) || 0));
  const tax = round2(taxes.reduce((s, t) => s + (t.computation === 'fixed'
    ? round2(Number(t.amount) * qty)
    : round2((amount * Number(t.amount)) / 100)), 0));
  return { amount, tax, total: round2(amount + tax) };
}

export const todayIso = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
