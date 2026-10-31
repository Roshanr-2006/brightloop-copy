-- =====================================================================
-- Brightloop Subscription Management System - database schema (SQLite)
-- =====================================================================
-- Conventions
--   * Money:  NUMERIC(12,2), always rounded to 2 decimals in the app layer.
--   * Dates:  TEXT 'YYYY-MM-DD'; timestamps: TEXT ISO-8601 (UTC).
--   * Every business rule that the database can enforce is enforced here
--     (unique emails, status values, no double billing, usage counters...),
--     so a bug in one module cannot corrupt data for the others.
--   * Run with:  PRAGMA foreign_keys = ON;  (must be set per connection)
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- 1. Users, roles, authentication
-- ---------------------------------------------------------------------
-- admin    : full control, the only role that can create staff, discounts,
--            taxes and other configuration.
-- staff    : day-to-day work (customers, subscriptions, invoices, payments).
-- customer : portal access to their own subscriptions and invoices only.
CREATE TABLE users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT    NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 100),
    email          TEXT    NOT NULL COLLATE NOCASE UNIQUE,      -- one account per email
    password_hash  TEXT    NOT NULL,                            -- bcrypt/argon2, never plain text
    role           TEXT    NOT NULL DEFAULT 'customer'
                           CHECK (role IN ('admin', 'staff', 'customer')),
    is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_by     INTEGER REFERENCES users(id),                -- admin who created a staff account
    last_login_at  TEXT,
    created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- "Forgot password": store only a hash of the emailed token; single use, expiring.
CREATE TABLE password_reset_tokens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT    NOT NULL UNIQUE,
    expires_at  TEXT    NOT NULL,
    used_at     TEXT,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_reset_tokens_user ON password_reset_tokens(user_id);

-- ---------------------------------------------------------------------
-- 2. Customers (billing contacts). A customer may or may not have a portal login.
-- ---------------------------------------------------------------------
CREATE TABLE customers (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL, -- portal login
    name             TEXT    NOT NULL CHECK (length(trim(name)) >= 2),
    company_name     TEXT,
    email            TEXT    NOT NULL COLLATE NOCASE UNIQUE,
    phone            TEXT,
    billing_address  TEXT,
    city             TEXT,
    state            TEXT,
    country          TEXT    DEFAULT 'India',
    tax_id           TEXT,                                       -- e.g. GSTIN
    created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---------------------------------------------------------------------
-- 3. Taxes and payment terms (admin configuration)
-- ---------------------------------------------------------------------
CREATE TABLE taxes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL UNIQUE,                        -- e.g. 'GST 18%'
    computation  TEXT    NOT NULL DEFAULT 'percent' CHECK (computation IN ('percent', 'fixed')),
    amount       NUMERIC(12,2) NOT NULL CHECK (amount >= 0),      -- 18.00 (%) or fixed amount per unit
    is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (computation <> 'percent' OR amount <= 100)
);

CREATE TABLE payment_terms (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE,                          -- 'Immediate', '15 Days', '30 Days'
    due_days   INTEGER NOT NULL DEFAULT 0 CHECK (due_days >= 0),
    is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

-- ---------------------------------------------------------------------
-- 4. Products and variants
-- ---------------------------------------------------------------------
CREATE TABLE products (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL CHECK (length(trim(name)) >= 2),
    type         TEXT    NOT NULL DEFAULT 'service'
                         CHECK (type IN ('service', 'goods', 'addon')),
    sales_price  NUMERIC(12,2) NOT NULL CHECK (sales_price >= 0),
    cost_price   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
    notes        TEXT,
    is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_products_active ON products(is_active, name);

-- Default taxes applied to a product (copied onto subscription/invoice lines).
CREATE TABLE product_taxes (
    product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    tax_id      INTEGER NOT NULL REFERENCES taxes(id)    ON DELETE RESTRICT,
    PRIMARY KEY (product_id, tax_id)
);

-- Attributes such as "Brand" with values such as "Odoo".
CREATE TABLE product_attributes (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL UNIQUE
);

CREATE TABLE product_attribute_values (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    attribute_id  INTEGER NOT NULL REFERENCES product_attributes(id) ON DELETE CASCADE,
    name          TEXT    NOT NULL,
    UNIQUE (attribute_id, name)
);

-- A variant = product + attribute value, with an extra price
-- (e.g. choosing Brand = Odoo adds 560 to the sales price).
CREATE TABLE product_variants (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id          INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    attribute_value_id  INTEGER NOT NULL REFERENCES product_attribute_values(id) ON DELETE RESTRICT,
    extra_price         NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (extra_price >= 0),
    is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    UNIQUE (product_id, attribute_value_id)
);

-- ---------------------------------------------------------------------
-- 5. Recurring plans
-- ---------------------------------------------------------------------
CREATE TABLE recurring_plans (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT    NOT NULL UNIQUE,
    price            NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    billing_period   TEXT    NOT NULL CHECK (billing_period IN ('daily', 'weekly', 'monthly', 'yearly')),
    billing_interval INTEGER NOT NULL DEFAULT 1 CHECK (billing_interval >= 1),  -- every N periods
    min_quantity     INTEGER NOT NULL DEFAULT 1 CHECK (min_quantity >= 1),
    start_date       TEXT,                                       -- available from
    end_date         TEXT,                                       -- available until
    -- Per-plan lifecycle options chosen by the admin:
    auto_close       INTEGER NOT NULL DEFAULT 0 CHECK (auto_close IN (0, 1)),  -- close itself at expiry
    closable         INTEGER NOT NULL DEFAULT 1 CHECK (closable   IN (0, 1)),  -- can be closed early
    pausable         INTEGER NOT NULL DEFAULT 0 CHECK (pausable   IN (0, 1)),
    renewable        INTEGER NOT NULL DEFAULT 1 CHECK (renewable  IN (0, 1)),
    is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active  IN (0, 1)),
    created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

-- ---------------------------------------------------------------------
-- 6. Quotation templates (pre-filled plan + product lines, valid N days)
-- ---------------------------------------------------------------------
CREATE TABLE quotation_templates (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT    NOT NULL UNIQUE,
    validity_days    INTEGER NOT NULL DEFAULT 30 CHECK (validity_days >= 1),
    plan_id          INTEGER NOT NULL REFERENCES recurring_plans(id) ON DELETE RESTRICT,
    payment_term_id  INTEGER REFERENCES payment_terms(id) ON DELETE SET NULL,
    notes            TEXT,
    is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE quotation_template_lines (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id  INTEGER NOT NULL REFERENCES quotation_templates(id) ON DELETE CASCADE,
    product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    variant_id   INTEGER REFERENCES product_variants(id) ON DELETE RESTRICT,
    description  TEXT,
    quantity     INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1)
);
CREATE INDEX idx_template_lines_template ON quotation_template_lines(template_id);

-- ---------------------------------------------------------------------
-- 7. Subscriptions
-- ---------------------------------------------------------------------
-- Lifecycle: draft -> quotation -> confirmed -> active -> closed
--            (active <-> paused only if the plan is pausable)
CREATE TABLE subscriptions (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    number                 TEXT    NOT NULL UNIQUE,              -- e.g. SUB/2026/00001 (see sequences)
    customer_id            INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    plan_id                INTEGER NOT NULL REFERENCES recurring_plans(id) ON DELETE RESTRICT,
    template_id            INTEGER REFERENCES quotation_templates(id) ON DELETE SET NULL,
    payment_term_id        INTEGER REFERENCES payment_terms(id) ON DELETE SET NULL,
    salesperson_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status                 TEXT    NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft', 'quotation', 'confirmed', 'active', 'paused', 'closed')),
    start_date             TEXT    NOT NULL,
    expiry_date            TEXT,                                 -- NULL = runs until closed
    quotation_valid_until  TEXT,                                 -- from template validity_days
    next_invoice_date      TEXT,                                 -- billing run picks rows where this <= today
    notes                  TEXT,
    closed_at              TEXT,
    close_reason           TEXT,
    created_by             INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at             TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at             TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (expiry_date IS NULL OR expiry_date >= start_date)
);
CREATE INDEX idx_subscriptions_customer     ON subscriptions(customer_id);
CREATE INDEX idx_subscriptions_status       ON subscriptions(status);
CREATE INDEX idx_subscriptions_plan         ON subscriptions(plan_id);
CREATE INDEX idx_subscriptions_billing_due  ON subscriptions(status, next_invoice_date);

CREATE TABLE subscription_lines (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    subscription_id  INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    product_id       INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    variant_id       INTEGER REFERENCES product_variants(id) ON DELETE RESTRICT,
    description      TEXT,
    quantity         INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
    unit_price       NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),   -- product price + variant extra
    amount           NUMERIC(12,2) NOT NULL CHECK (amount >= 0)        -- quantity * unit_price (before tax)
);
CREATE INDEX idx_subscription_lines_sub ON subscription_lines(subscription_id);

CREATE TABLE subscription_line_taxes (
    line_id  INTEGER NOT NULL REFERENCES subscription_lines(id) ON DELETE CASCADE,
    tax_id   INTEGER NOT NULL REFERENCES taxes(id) ON DELETE RESTRICT,
    PRIMARY KEY (line_id, tax_id)
);

-- Full audit trail so anyone on the team can see where a subscription stands.
CREATE TABLE subscription_status_history (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    subscription_id  INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    from_status      TEXT,
    to_status        TEXT    NOT NULL,
    changed_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    note             TEXT,
    changed_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_sub_history_sub ON subscription_status_history(subscription_id, changed_at);

-- ---------------------------------------------------------------------
-- 8. Discounts (admin only)
-- ---------------------------------------------------------------------
-- scope = 'product'      -> applies to lines whose product is in discount_products
-- scope = 'subscription' -> applies to the whole subscription total; if
--                           discount_subscriptions has rows it is limited to them,
--                           otherwise it applies to every subscription.
CREATE TABLE discounts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL UNIQUE,
    discount_type   TEXT    NOT NULL CHECK (discount_type IN ('fixed', 'percent')),
    value           NUMERIC(12,2) NOT NULL CHECK (value > 0),
    scope           TEXT    NOT NULL DEFAULT 'subscription' CHECK (scope IN ('product', 'subscription')),
    min_purchase    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (min_purchase >= 0),
    min_quantity    INTEGER NOT NULL DEFAULT 0 CHECK (min_quantity >= 0),
    start_date      TEXT,
    end_date        TEXT,
    usage_limit     INTEGER CHECK (usage_limit IS NULL OR usage_limit >= 1),   -- NULL = unlimited
    usage_count     INTEGER NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (discount_type <> 'percent' OR value <= 100),
    CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
    CHECK (usage_limit IS NULL OR usage_count <= usage_limit)              -- can never exceed the limit
);

CREATE TABLE discount_products (
    discount_id  INTEGER NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,
    product_id   INTEGER NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
    PRIMARY KEY (discount_id, product_id)
);

CREATE TABLE discount_subscriptions (
    discount_id      INTEGER NOT NULL REFERENCES discounts(id)     ON DELETE CASCADE,
    subscription_id  INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    PRIMARY KEY (discount_id, subscription_id)
);

-- ---------------------------------------------------------------------
-- 9. Invoices
-- ---------------------------------------------------------------------
-- Lifecycle: draft -> confirmed -> paid   (draft/confirmed -> cancelled)
CREATE TABLE invoices (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    number           TEXT    NOT NULL UNIQUE,                    -- e.g. INV/2026/00001
    subscription_id  INTEGER REFERENCES subscriptions(id) ON DELETE RESTRICT,
    customer_id      INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    status           TEXT    NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'confirmed', 'paid', 'cancelled')),
    invoice_date     TEXT    NOT NULL,
    due_date         TEXT    NOT NULL,
    period_start     TEXT,                                       -- billing period covered
    period_end       TEXT,
    untaxed_amount   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (untaxed_amount >= 0),
    discount_amount  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    tax_amount       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    total_amount     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    amount_paid      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
    sent_at          TEXT,
    confirmed_at     TEXT,
    paid_at          TEXT,
    cancelled_at     TEXT,
    created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- NULL = billing run
    created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (due_date >= invoice_date),
    CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start),
    CHECK (amount_paid <= total_amount)
);
-- NO DOUBLE BILLING: one live (non-cancelled) invoice per subscription per period.
-- A cancelled invoice frees the period so it can be re-billed correctly.
CREATE UNIQUE INDEX uq_invoices_subscription_period
    ON invoices(subscription_id, period_start)
    WHERE subscription_id IS NOT NULL AND status <> 'cancelled';
CREATE INDEX idx_invoices_customer       ON invoices(customer_id);
CREATE INDEX idx_invoices_status_due     ON invoices(status, due_date);      -- overdue report
CREATE INDEX idx_invoices_invoice_date   ON invoices(invoice_date);          -- revenue by period
CREATE INDEX idx_invoices_subscription   ON invoices(subscription_id);

CREATE TABLE invoice_lines (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id       INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id       INTEGER REFERENCES products(id) ON DELETE RESTRICT,
    variant_id       INTEGER REFERENCES product_variants(id) ON DELETE RESTRICT,
    description      TEXT    NOT NULL,
    quantity         INTEGER NOT NULL CHECK (quantity >= 1),
    unit_price       NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
    discount_amount  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    tax_amount       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    subtotal         NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),        -- qty*price - discount
    total            NUMERIC(12,2) NOT NULL CHECK (total >= 0)            -- subtotal + tax
);
CREATE INDEX idx_invoice_lines_invoice ON invoice_lines(invoice_id);

-- Snapshot of each tax applied (name/rate copied so later tax edits don't change old invoices).
CREATE TABLE invoice_line_taxes (
    line_id    INTEGER NOT NULL REFERENCES invoice_lines(id) ON DELETE CASCADE,
    tax_id     INTEGER REFERENCES taxes(id) ON DELETE SET NULL,
    tax_name   TEXT    NOT NULL,
    rate       NUMERIC(12,2) NOT NULL,
    amount     NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    PRIMARY KEY (line_id, tax_name)
);

-- Each time a discount lands on an invoice it is recorded once here;
-- the app increments discounts.usage_count in the same transaction.
CREATE TABLE discount_usages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    discount_id  INTEGER NOT NULL REFERENCES discounts(id) ON DELETE RESTRICT,
    invoice_id   INTEGER NOT NULL REFERENCES invoices(id)  ON DELETE CASCADE,
    amount       NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (discount_id, invoice_id)
);

-- ---------------------------------------------------------------------
-- 10. Payments
-- ---------------------------------------------------------------------
CREATE TABLE payments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id    INTEGER NOT NULL REFERENCES invoices(id)  ON DELETE RESTRICT,
    customer_id   INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    method        TEXT    NOT NULL CHECK (method IN ('cash', 'bank_transfer', 'card', 'upi', 'cheque', 'other')),
    amount        NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    payment_date  TEXT    NOT NULL,
    reference     TEXT,                                          -- UTR / cheque no.
    note          TEXT,
    recorded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_payments_invoice  ON payments(invoice_id);
CREATE INDEX idx_payments_date     ON payments(payment_date);
CREATE INDEX idx_payments_customer ON payments(customer_id);

-- ---------------------------------------------------------------------
-- 11. Document numbering (SUB/2026/00001, INV/2026/00001)
-- ---------------------------------------------------------------------
-- Increment inside the same transaction that creates the document:
--   UPDATE sequences SET next_value = next_value + 1 WHERE code = 'invoice' RETURNING next_value - 1;
CREATE TABLE sequences (
    code        TEXT    PRIMARY KEY,                             -- 'subscription', 'invoice'
    prefix      TEXT    NOT NULL,                                -- 'SUB', 'INV'
    next_value  INTEGER NOT NULL DEFAULT 1 CHECK (next_value >= 1)
);

-- ---------------------------------------------------------------------
-- 12. Reporting views (finance dashboard)
-- ---------------------------------------------------------------------
-- Outstanding = confirmed and not fully paid. Overdue = outstanding and past due date.
CREATE VIEW v_invoice_balances AS
SELECT
    i.*,
    ROUND(i.total_amount - i.amount_paid, 2)                         AS balance_due,
    CASE
        WHEN i.status = 'confirmed' AND i.due_date < date('now') THEN 1 ELSE 0
    END                                                               AS is_overdue,
    CASE
        WHEN i.status = 'confirmed' AND i.due_date < date('now')
        THEN CAST(julianday('now') - julianday(i.due_date) AS INTEGER) ELSE 0
    END                                                               AS days_overdue
FROM invoices i;

CREATE VIEW v_subscription_summary AS
SELECT
    s.id, s.number, s.status, s.start_date, s.expiry_date, s.next_invoice_date,
    c.id   AS customer_id, c.name AS customer_name,
    p.id   AS plan_id,     p.name AS plan_name, p.billing_period,
    COALESCE(SUM(l.amount), 0) AS recurring_amount
FROM subscriptions s
JOIN customers       c ON c.id = s.customer_id
JOIN recurring_plans p ON p.id = s.plan_id
LEFT JOIN subscription_lines l ON l.subscription_id = s.id
GROUP BY s.id;
