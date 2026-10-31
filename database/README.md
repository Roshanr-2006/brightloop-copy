# Database

SQLite schema for the Brightloop Subscription Management System. It runs locally and offline, with no DB server.

| File | Purpose |
|------|---------|
| `schema.sql` | Tables, constraints, indexes and reporting views |
| `seed.sql` | Reference data: taxes, payment terms, sample products/variants, plans, a quotation template |
| `check-schema.js` | Loads both files into an in-memory DB and verifies the key business rules (`node database/check-schema.js`) |

Always enable foreign keys on every connection: `PRAGMA foreign_keys = ON;`

## Tables by module

| Module | Tables |
|--------|--------|
| A. Auth & roles | `users` (role: admin / staff / customer), `password_reset_tokens`, `customers` (portal login via `user_id`) |
| B. Configuration | `products`, `product_taxes`, `product_attributes`, `product_attribute_values`, `product_variants`, `taxes`, `payment_terms`, `recurring_plans`, `quotation_templates`, `quotation_template_lines`, `discounts`, `discount_products`, `discount_subscriptions` |
| C. Subscriptions & billing | `subscriptions`, `subscription_lines`, `subscription_line_taxes`, `subscription_status_history`, `invoices`, `invoice_lines`, `invoice_line_taxes`, `discount_usages`, `sequences` |
| D. Payments & reports | `payments`, views `v_invoice_balances`, `v_subscription_summary` |

## Relationships

```
users 1--0..1 customers 1--* subscriptions *--1 recurring_plans
                                  |  \--* subscription_lines *--1 products 1--* product_variants
                                  |                                   \--* product_taxes *--1 taxes
                                  \--* invoices 1--* invoice_lines --* invoice_line_taxes
                                          |  \--* payments
                                          \--* discount_usages *--1 discounts
quotation_templates *--1 recurring_plans ; quotation_templates 1--* quotation_template_lines
```

## Status flows

- **Subscription:** `draft -> quotation -> confirmed -> active -> closed` (`active <-> paused` only if the plan is `pausable`; early close only if `closable`; `auto_close` plans close at `expiry_date`). Every change is logged in `subscription_status_history`.
- **Invoice:** `draft -> confirmed -> paid`; `draft/confirmed -> cancelled`.

## Rules enforced by the database

- **One account per email:** `users.email` is `UNIQUE COLLATE NOCASE`.
- **No double billing:** the partial unique index `uq_invoices_subscription_period` allows only one non-cancelled invoice per `(subscription_id, period_start)`. The billing run can be re-run safely, and cancelling an invoice frees the period for re-billing.
- **Discount limits:** `usage_count <= usage_limit`, and percent is capped at 100. `discount_usages` is unique per `(discount, invoice)`, so a discount can't be counted twice on one invoice.
- **Money sanity:** prices >= 0, payments > 0, `amount_paid <= total_amount`, `due_date >= invoice_date`.
- **History is protected:** products, plans, customers and invoices referenced by other records can't be deleted (`ON DELETE RESTRICT`). Deactivate them with `is_active = 0` instead.

## App-layer rules (not expressible in SQL)

- Password policy: more than 8 characters, with an uppercase letter, a lowercase letter and a special character. Store bcrypt/argon2 hashes only.
- Only an admin can create `staff` users, discounts, taxes and plans. Check the role in API middleware, not just in the UI.
- Customers must only ever query rows where `customer_id` is their own customer record.
- Billing run (one transaction per subscription): pick `status = 'active' AND next_invoice_date <= today`, build the invoice from the lines, apply valid discounts (date range, min purchase/qty, usage left), compute taxes, insert `discount_usages` and increment `usage_count`, then advance `next_invoice_date` by the plan's period.
- Numbering: take the next value from `sequences` inside the same transaction, formatted as `INV/2026/00001`.
- Performance (< 2 s with thousands of rows): always paginate with `LIMIT/OFFSET`, filter on the indexed columns, and compute report totals with SQL aggregates rather than in JS.
