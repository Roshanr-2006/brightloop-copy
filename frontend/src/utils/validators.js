// Client-side form checks (owner: Sachin). They mirror the backend rules so users get instant
// feedback; the API still validates everything.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isEmail(value) {
  return typeof value === 'string' && EMAIL_RE.test(value.trim());
}

// Each rule: { key, label, test }. Used for the live checklist on signup/reset forms.
export const PASSWORD_RULES = [
  { key: 'length', label: 'More than 8 characters', test: (pw) => pw.length > 8 },
  { key: 'upper', label: 'An uppercase letter (A-Z)', test: (pw) => /[A-Z]/.test(pw) },
  { key: 'lower', label: 'A lowercase letter (a-z)', test: (pw) => /[a-z]/.test(pw) },
  { key: 'special', label: 'A special character (e.g. ! @ # $)', test: (pw) => /[^A-Za-z0-9]/.test(pw) },
];

/** List of unmet password rules (labels). Empty array = password is fine. */
export function passwordIssues(pw) {
  const value = typeof pw === 'string' ? pw : '';
  return PASSWORD_RULES.filter((r) => !r.test(value)).map((r) => r.label);
}

export function isStrongPassword(pw) {
  return passwordIssues(pw).length === 0;
}

const PHONE_RE = /^[0-9+()\-.\s]{6,30}$/;
export function isPhone(value) {
  return !value || PHONE_RE.test(value.trim());
}

/** Common checks for customer forms. Returns { field: message }. */
export function customerErrors(form, { requireEmail = true } = {}) {
  const errors = {};
  if (!form.name || form.name.trim().length < 2) errors.name = 'Name must be at least 2 characters';
  if (requireEmail) {
    if (!form.email?.trim()) errors.email = 'Email is required';
    else if (!isEmail(form.email)) errors.email = 'Enter a valid email address';
  }
  if (!isPhone(form.phone)) errors.phone = 'Enter a valid phone number';
  return errors;
}
