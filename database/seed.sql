-- =====================================================================
-- Brightloop - reference/seed data (no users: the app creates the first
-- admin on setup so the password is hashed by the app, never stored here)
-- =====================================================================

INSERT INTO sequences (code, prefix, next_value) VALUES
    ('subscription', 'SUB', 1),
    ('invoice',      'INV', 1);

INSERT INTO payment_terms (name, due_days) VALUES
    ('Immediate', 0),
    ('15 Days',   15),
    ('30 Days',   30),
    ('45 Days',   45);

INSERT INTO taxes (name, computation, amount) VALUES
    ('GST 5%',  'percent', 5),
    ('GST 12%', 'percent', 12),
    ('GST 18%', 'percent', 18);

INSERT INTO products (name, type, sales_price, cost_price, notes) VALUES
    ('Brightloop CRM',        'service', 1200, 300, 'Customer relationship management suite'),
    ('Brightloop Accounting', 'service', 1500, 400, 'Invoicing and accounting'),
    ('Extra Storage 100 GB',  'addon',    250,  60, 'Add-on: additional cloud storage'),
    ('Priority Support',      'addon',    499, 150, 'Add-on: 4-hour response SLA'),
    ('Onboarding Kit',        'goods',   2999, 1800, 'One-time hardware/setup kit');

-- Every product gets GST 18% by default.
INSERT INTO product_taxes (product_id, tax_id)
SELECT p.id, t.id FROM products p, taxes t WHERE t.name = 'GST 18%';

INSERT INTO product_attributes (name) VALUES ('Brand');
INSERT INTO product_attribute_values (attribute_id, name)
SELECT id, v.name FROM product_attributes,
     (SELECT 'Odoo' AS name UNION ALL SELECT 'Brightloop') v
WHERE product_attributes.name = 'Brand';

-- Problem statement example: choosing the Odoo brand adds 560 to the price.
INSERT INTO product_variants (product_id, attribute_value_id, extra_price)
SELECT p.id, v.id, CASE v.name WHEN 'Odoo' THEN 560 ELSE 0 END
FROM products p
JOIN product_attribute_values v ON 1 = 1
WHERE p.name = 'Brightloop CRM';

INSERT INTO recurring_plans
    (name, price, billing_period, min_quantity, start_date, end_date, auto_close, closable, pausable, renewable)
VALUES
    ('Daily Trial',     0,     'daily',   1, '2026-01-01', NULL,         1, 1, 0, 0),
    ('Weekly Starter',  299,   'weekly',  1, '2026-01-01', NULL,         0, 1, 1, 1),
    ('Monthly Basic',   999,   'monthly', 1, '2026-01-01', NULL,         0, 1, 1, 1),
    ('Yearly Business', 9999,  'yearly',  5, '2026-01-01', NULL,         0, 0, 0, 1),
    ('Festive Offer',   799,   'monthly', 1, '2026-10-01', '2026-12-31', 1, 1, 0, 0);

INSERT INTO quotation_templates (name, validity_days, plan_id, payment_term_id, notes)
SELECT 'Enterprise Yearly Bundle', 15, p.id, t.id, 'CRM + Accounting + Priority Support, billed yearly'
FROM recurring_plans p, payment_terms t
WHERE p.name = 'Yearly Business' AND t.name = '30 Days';

INSERT INTO quotation_template_lines (template_id, product_id, quantity)
SELECT qt.id, pr.id, q.qty
FROM quotation_templates qt
JOIN (SELECT 'Brightloop CRM' AS name, 10 AS qty
      UNION ALL SELECT 'Brightloop Accounting', 5
      UNION ALL SELECT 'Priority Support', 1) q
JOIN products pr ON pr.name = q.name
WHERE qt.name = 'Enterprise Yearly Bundle';
