# Brightloop: Project Structure, Flow and Getting Started

Stack: **Node.js 22 LTS + Express** (backend), **React + Vite** (frontend), **SQLite via built-in `node:sqlite`** (no native build, no DB server, works offline).
Ports: backend `http://localhost:4000`, frontend `http://localhost:5173` (Vite proxies `/api` to the backend).

---

## 1. Folder structure (with owners)

```
Brightloop/
├── README.md                          SACHIN  setup + run steps, screenshots (final)
├── .gitignore                         SACHIN  node_modules, .env, *.db, dist
├── database/                          SHARED  (already on main, change only after telling the team)
│   ├── schema.sql                             tables, constraints, indexes, views
│   ├── seed.sql                               taxes, terms, sample products, plans, template
│   ├── check-schema.js                        rule checks: node database/check-schema.js
│   └── README.md
├── docs/
│   ├── PROJECT_STRUCTURE.md                   this file
│   └── Brightloop-Team-Plan.pdf
│
├── backend/
│   ├── package.json                   SACHIN  express, bcryptjs, jsonwebtoken, cookie-parser, cors
│   ├── .env.example                   SACHIN  PORT=4000, JWT_SECRET=change-me, DB_FILE=./data/brightloop.db
│   ├── data/                                  SQLite file lives here (git-ignored)
│   ├── scripts/
│   │   ├── reset-db.js                SACHIN  delete DB, re-run schema + seed, create first admin
│   │   └── seed-demo.js               MERRYL  ~5,000 customers/subscriptions/invoices for the speed demo
│   └── src/
│       ├── server.js                  SACHIN  starts the HTTP server
│       ├── app.js                     SACHIN  express app, JSON parser, mounts every module router under /api
│       ├── config.js                  SACHIN  reads .env
│       ├── db/
│       │   └── index.js               SACHIN  opens SQLite, PRAGMA foreign_keys=ON, runs schema/seed on first run, transaction() helper
│       ├── middleware/
│       │   ├── auth.js                SACHIN  requireAuth -> sets req.user = { id, role, customerId }
│       │   ├── roles.js               SACHIN  requireRole('admin'), requireRole('admin','staff')
│       │   ├── validate.js            SACHIN  runs a validator, returns 422 { error, fields }
│       │   └── errorHandler.js        SACHIN  one place that turns errors into JSON
│       ├── utils/
│       │   ├── pagination.js          SACHIN  parsePage(req) -> { page, limit, offset }; paged(items,total,...)
│       │   ├── money.js               SWATHY  round2(), lineTotals(), taxAmount()
│       │   ├── dates.js               SWATHY  addPeriod(date, 'monthly', 1), today()
│       │   └── sequence.js            SWATHY  nextNumber(db, 'invoice') -> 'INV/2026/00001'
│       └── modules/
│           ├── auth/                  SACHIN  signup, login, logout, me, forgot/reset password
│           ├── users/                 SACHIN  admin creates/lists staff
│           ├── customers/             SACHIN  customer CRUD (admin + staff)
│           ├── portal/                SACHIN  /api/portal/* : customer's own subscriptions/invoices
│           ├── catalog/               ROSHAN
│           │   ├── products/                  products + variants (attributes/values/extra price)
│           │   ├── taxes/
│           │   ├── payment-terms/
│           │   ├── plans/                     recurring plans + lifecycle options
│           │   ├── templates/                 quotation templates + lines
│           │   ├── discounts/                 discount rules (admin only)
│           │   └── catalog.service.js         SHARED API for Swathy: getPrice, getProductTaxes,
│           │                                  getTemplate, getApplicableDiscounts
│           ├── subscriptions/         SWATHY  CRUD, lines, status flow, history, from-template
│           ├── invoices/              SWATHY  list/detail, confirm/cancel/send/print
│           ├── billing/               SWATHY  billing run (idempotent), auto-close
│           ├── payments/              MERRYL  record payment, mark invoice paid
│           └── reports/               MERRYL  dashboard KPIs, revenue, outstanding, overdue
│
└── frontend/
    ├── package.json                   SACHIN  react, react-dom, react-router-dom, vite
    ├── vite.config.js                 SACHIN  proxy /api -> http://localhost:4000
    ├── index.html
    └── src/
        ├── main.jsx, App.jsx          SACHIN
        ├── routes.jsx                 SACHIN  every page registered here (others ask Sachin, or add 1 line each)
        ├── api/client.js              SACHIN  api.get/post/put/patch/delete, handles 401 + error JSON
        ├── context/AuthContext.jsx    SACHIN  current user + role, login/logout
        ├── components/
        │   ├── layout/                MERRYL  AppLayout, Sidebar (menu by role), Topbar
        │   └── ui/                    MERRYL  DataTable, Pagination, FormField, Select, Modal,
        │                                      ConfirmDialog, StatusBadge, Toast, EmptyState, Card
        ├── styles/theme.css           MERRYL  colors, spacing, typography (one consistent theme)
        ├── utils/
        │   ├── format.js              MERRYL  formatMoney (INR), formatDate
        │   └── validators.js          SACHIN  email/password rules shared by forms
        └── pages/
            ├── auth/                  SACHIN  Login, Signup, ForgotPassword, ResetPassword
            ├── admin/                 SACHIN  StaffList, StaffForm
            ├── customers/             SACHIN  CustomerList, CustomerForm
            ├── portal/                SACHIN  MySubscriptions, MyInvoices
            ├── catalog/               ROSHAN  Products, ProductForm (with variants), Taxes, PaymentTerms,
            │                                  Plans, PlanForm, Templates, TemplateForm, Discounts, DiscountForm
            ├── subscriptions/         SWATHY  SubscriptionList, SubscriptionForm, SubscriptionDetail
            ├── invoices/              SWATHY  InvoiceList, InvoiceDetail, InvoicePrint, BillingRun
            ├── payments/              MERRYL  PaymentList, PaymentForm
            └── reports/               MERRYL  Dashboard (home page for admin/staff)
```

### Inside every backend module (same pattern for everyone)

```
modules/<name>/
├── <name>.routes.js       URL -> middleware -> controller   (router.get('/', requireAuth, requireRole(...), ctrl.list))
├── <name>.controller.js   reads req, calls service, sends JSON (no SQL here)
├── <name>.service.js      all SQL + business rules + transactions (no req/res here)
└── <name>.validators.js   input checks -> { field: 'message' }
```
Each module exports its router and Sachin mounts it once in `app.js`, e.g. `app.use('/api/plans', plansRouter)`.

---

## 2. Flows

### 2.1 Request flow (every API call)

```
React page
  -> api/client.js  (fetch /api/..., sends auth cookie/token)
  -> Vite proxy -> Express app.js
  -> <module>.routes.js
  -> requireAuth (who are you?)  -> requireRole (are you allowed?)  -> validate (is the input OK?)
  -> controller  -> service (SQL in a transaction)  -> SQLite
  <- JSON:  list   { items, total, page, pages }
            item   { ...row }
            error  { error: 'message', fields: { name: 'Name is required' } }   (401/403/404/409/422)
  <- page renders with Merryl's UI components, shows field errors under inputs
```

### 2.2 Business flow (one billing month, mapped to modules)

```
[B Roshan]  Admin sets up: taxes -> payment terms -> products + variants -> plans -> quotation templates -> discounts
                 |
[A Sachin]  Staff creates customer (optionally gives portal login)
                 |
[C Swathy]  Subscription from template -> Draft -> Quotation -> Confirmed -> Active
                 |  (uses Roshan's getPrice / getProductTaxes / getTemplate)
[C Swathy]  Billing run: active + next_invoice_date <= today
                 -> invoice with lines, taxes, discounts (getApplicableDiscounts) -> next_invoice_date moves on
                 -> run again = 0 new invoices (no double billing)
[C Swathy]  Invoice Draft -> Confirmed (send / print)
                 |
[D Merryl]  Payment recorded -> invoice Paid when fully paid; otherwise outstanding / overdue
                 |
[D Merryl]  Finance dashboard: active subs, revenue, owed, overdue (filters + summary)
[A Sachin]  Customer portal: only their own subscriptions + invoices
```

### 2.3 Role access (enforced in backend routes)

| Area | Admin | Staff | Customer |
|---|---|---|---|
| Create staff users | yes | no | no |
| Products, taxes, plans, templates, discounts | full | view | no |
| Customers | full | full | no |
| Subscriptions, invoices, billing run | full | full | own only (portal, read) |
| Payments | full | full | own only (read) |
| Reports dashboard | yes | yes | no |

### 2.4 Shared contracts (agree once, don't change silently)

- `req.user = { id, role, customerId }` (customerId only for customers)
- Lists accept `?page=1&limit=20&search=&sort=&status=` and return `{ items, total, page, pages }`
- Money: numbers with 2 decimals, rounded with `round2()`; dates `YYYY-MM-DD`
- `catalog.service.js` (Roshan -> Swathy):
  - `getPrice(productId, variantId) -> number`
  - `getProductTaxes(productId) -> [{ id, name, computation, amount }]`
  - `getTemplate(templateId) -> { plan, payment_term_id, validity_days, lines: [...] }`
  - `getApplicableDiscounts({ subscription, lines, date }) -> [{ id, discount_type, value, scope, productIds }]`
- Payments (Merryl) may update `invoices.amount_paid`, `invoices.status = 'paid'`, `paid_at`. Nobody else writes those.

---

## 3. Who starts and how

### Step 0: before 10:00 (SACHIN only)
1. Add `vivp-odoo` as a collaborator (repo Settings -> Collaborators).
2. Submit the repo link in "Submit Problem Solution" on the hackathon portal.

### Step 1: skeleton (SACHIN, target 10:30, one push)
Everyone else waits for this push before creating files, so nobody creates conflicting `package.json`s.
1. `git pull`
2. Create `backend/` and `frontend/` exactly as above (empty module folders can hold a `.gitkeep`).
3. Backend: `npm init -y`, `npm i express bcryptjs jsonwebtoken cookie-parser cors`, write `server.js`, `app.js`, `config.js`, `db/index.js` (loads `database/schema.sql` + `seed.sql` on first run), `errorHandler.js`, and a `GET /api/health` route.
4. Frontend: `npm create vite@latest frontend -- --template react`, `npm i react-router-dom`, add the `/api` proxy, `api/client.js`, empty `routes.jsx`.
5. Check: `cd backend && npm run dev` shows the health check, `cd frontend && npm run dev` opens the app.
6. Commit `chore: project skeleton (express + vite + sqlite)` and push. Tell the team: "skeleton pushed, pull now".

### Step 2: while waiting (10:00 to 10:30, everyone else, no commits yet)
- ROSHAN: list the catalog endpoints and form fields; draft the SQL for products/variants/plans in `catalog` (local only).
- SWATHY: write `dates.js` (addPeriod) and the billing-run steps on paper; draft subscription SQL.
- MERRYL: pick the color palette and draw the sidebar menu per role; start `theme.css` locally.

### Step 3: everyone starts (after the skeleton push)
```
git pull
cd backend  && npm install && cp .env.example .env && npm run dev
cd frontend && npm install && npm run dev
```
Then work only inside your folders. First pushes, in this order of priority:

| By | Who | First push |
|---|---|---|
| ~10:45 | SACHIN | `auth.js` + `roles.js` middleware and login/signup API (others need this) |
| ~10:45 | MERRYL | `theme.css`, `AppLayout`, `Sidebar`, `DataTable`, `FormField`, `Modal` (others need these) |
| ~11:00 | ROSHAN | products API + Products page using Merryl's components |
| ~11:00 | SWATHY | subscriptions list/create API + `dates.js`, `sequence.js` |
| ~12:30 | ROSHAN | `catalog.service.js` handoff functions for Swathy |

Until Sachin's middleware lands, write routes without `requireAuth` and add it after the next pull (one-line change).

### Step 4: rhythm for the rest of the day
- `git pull --rebase` -> code -> run it -> `git add <your folder>` -> commit -> `git pull --rebase` -> `git push`, at least every 45-60 min.
- Adding a page to the menu or a router to `app.js`? One line each. Pull first, push immediately, tell the group.
- 12:30 five-minute check-in on handoffs. 3:30 feature freeze. 3:30 to 4:30 end-to-end test using the demo flow in the team plan.
