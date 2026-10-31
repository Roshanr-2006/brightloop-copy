// Shared display formatters (owner: Merryl).
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
const day = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

export const formatMoney = (n) => inr.format(Number(n) || 0);
export const formatDate = (iso) => (iso ? day.format(new Date(`${String(iso).slice(0, 10)}T00:00:00`)) : '-');
export const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
