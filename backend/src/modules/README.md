# Backend modules

Each owner creates their folder here using the same 4-file pattern:
`<name>.routes.js` -> `<name>.controller.js` -> `<name>.service.js` (+ `<name>.validators.js`),
then uncomments their line in `src/app.js`.

| Folder | Owner | Mounted at |
|---|---|---|
| `auth/` | Sachin | `/api/auth` (signup, login, logout, me, forgot/reset password) |
| `users/` | Sachin | `/api/users` (admin creates staff) |
| `customers/` | Sachin | `/api/customers` |
| `portal/` | Sachin | `/api/portal` (customer's own subscriptions/invoices) |
| `catalog/` | Roshan | `/api/catalog` (products, variants, taxes, payment terms, plans, templates, discounts) + `catalog.service.js` for Swathy |
| `subscriptions/` | Swathy | `/api/subscriptions` |
| `invoices/` | Swathy | `/api/invoices` |
| `billing/` | Swathy | `/api/billing` (billing run) |
| `payments/` | Merryl | `/api/payments` |
| `reports/` | Merryl | `/api/reports` |
