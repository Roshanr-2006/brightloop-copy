// Every page of the app is registered here.
// Pages load lazily from src/pages/<file>.jsx: create the file (default export) and it
// replaces the placeholder automatically, no edit to this file needed.
//   roles:  who can open it (also builds the sidebar). Backend enforces the same roles.
//   hidden: true -> routable but not in the sidebar (detail/form pages).
import { lazy, Suspense } from 'react';
import Placeholder from './components/Placeholder.jsx';

export const REQUIRE_LOGIN = true;

const ADMIN = 'admin';
const STAFF = 'staff';
const CUSTOMER = 'customer';
const INTERNAL = [ADMIN, STAFF];

const pageModules = import.meta.glob(['./pages/**/*.jsx', '!./pages/NotFound.jsx']);

function page(file, title, owner, bare = false) {
  const loader = pageModules[`./pages/${file}.jsx`];
  if (!loader) return <Placeholder title={title} owner={owner} bare={bare} />;
  const Component = lazy(loader);
  return (
    <Suspense fallback={<div className="page-loading">Loading...</div>}>
      <Component />
    </Suspense>
  );
}

// section groups items in the sidebar
export const appRoutes = [
  // Overview (D. Merryl)
  { path: '/', label: 'Dashboard', section: 'Overview', roles: INTERNAL, element: page('reports/Dashboard', 'Dashboard', 'Merryl') },
  { path: '/reports', label: 'Reports', section: 'Overview', roles: INTERNAL, element: page('reports/Reports', 'Finance reports', 'Merryl') },

  // Sales (C. Swathy, D. Merryl, A. Sachin)
  { path: '/subscriptions', label: 'Subscriptions', section: 'Sales', roles: INTERNAL, element: page('subscriptions/SubscriptionList', 'Subscriptions', 'Swathy') },
  { path: '/subscriptions/new', label: 'New subscription', section: 'Sales', roles: INTERNAL, hidden: true, element: page('subscriptions/SubscriptionForm', 'New subscription', 'Swathy') },
  { path: '/subscriptions/:id', label: 'Subscription', section: 'Sales', roles: INTERNAL, hidden: true, element: page('subscriptions/SubscriptionDetail', 'Subscription', 'Swathy') },
  { path: '/subscriptions/:id/edit', label: 'Edit subscription', section: 'Sales', roles: INTERNAL, hidden: true, element: page('subscriptions/SubscriptionForm', 'Edit subscription', 'Swathy') },
  { path: '/invoices', label: 'Invoices', section: 'Sales', roles: INTERNAL, element: page('invoices/InvoiceList', 'Invoices', 'Swathy') },
  { path: '/invoices/:id', label: 'Invoice', section: 'Sales', roles: INTERNAL, hidden: true, element: page('invoices/InvoiceDetail', 'Invoice', 'Swathy') },
  { path: '/billing', label: 'Billing run', section: 'Sales', roles: INTERNAL, element: page('invoices/BillingRun', 'Billing run', 'Swathy') },
  { path: '/payments', label: 'Payments', section: 'Sales', roles: INTERNAL, element: page('payments/PaymentList', 'Payments', 'Merryl') },
  { path: '/customers', label: 'Customers', section: 'Sales', roles: INTERNAL, element: page('customers/CustomerList', 'Customers', 'Sachin') },
  { path: '/customers/:id', label: 'Customer', section: 'Sales', roles: INTERNAL, hidden: true, element: page('customers/CustomerDetail', 'Customer', 'Sachin') },

  // Configuration (B. Roshan)
  { path: '/catalog/products', label: 'Products', section: 'Configuration', roles: INTERNAL, element: page('catalog/Products', 'Products & variants', 'Roshan') },
  { path: '/catalog/products/new', label: 'New product', section: 'Configuration', roles: [ADMIN], hidden: true, element: page('catalog/ProductForm', 'New product', 'Roshan') },
  { path: '/catalog/products/:id', label: 'Product', section: 'Configuration', roles: INTERNAL, hidden: true, element: page('catalog/ProductForm', 'Product', 'Roshan') },
  { path: '/catalog/plans', label: 'Recurring plans', section: 'Configuration', roles: INTERNAL, element: page('catalog/Plans', 'Recurring plans', 'Roshan') },
  { path: '/catalog/templates', label: 'Quotation templates', section: 'Configuration', roles: INTERNAL, element: page('catalog/Templates', 'Quotation templates', 'Roshan') },
  { path: '/catalog/templates/new', label: 'New template', section: 'Configuration', roles: [ADMIN], hidden: true, element: page('catalog/TemplateForm', 'New template', 'Roshan') },
  { path: '/catalog/templates/:id', label: 'Template', section: 'Configuration', roles: INTERNAL, hidden: true, element: page('catalog/TemplateForm', 'Template', 'Roshan') },
  { path: '/catalog/discounts', label: 'Discounts', section: 'Configuration', roles: [ADMIN], element: page('catalog/Discounts', 'Discounts', 'Roshan') },
  { path: '/catalog/taxes', label: 'Taxes', section: 'Configuration', roles: INTERNAL, element: page('catalog/Taxes', 'Taxes', 'Roshan') },
  { path: '/catalog/payment-terms', label: 'Payment terms', section: 'Configuration', roles: INTERNAL, element: page('catalog/PaymentTerms', 'Payment terms', 'Roshan') },

  // Administration (A. Sachin)
  { path: '/admin/staff', label: 'Staff users', section: 'Administration', roles: [ADMIN], element: page('admin/StaffList', 'Staff users', 'Sachin') },

  // Customer portal (A. Sachin)
  { path: '/portal/subscriptions', label: 'My subscriptions', section: 'My account', roles: [CUSTOMER], element: page('portal/MySubscriptions', 'My subscriptions', 'Sachin') },
  { path: '/portal/subscriptions/:id', label: 'My subscription', section: 'My account', roles: [CUSTOMER], hidden: true, element: page('portal/MySubscriptionDetail', 'My subscription', 'Sachin') },
  { path: '/portal/invoices', label: 'My invoices', section: 'My account', roles: [CUSTOMER], element: page('portal/MyInvoices', 'My invoices', 'Sachin') },
  { path: '/portal/invoices/:id', label: 'My invoice', section: 'My account', roles: [CUSTOMER], hidden: true, element: page('portal/MyInvoiceDetail', 'My invoice', 'Sachin') },
  { path: '/portal/profile', label: 'My profile', section: 'My account', roles: [CUSTOMER], element: page('portal/Profile', 'My profile', 'Sachin') },
];

// Logged-in pages without the sidebar layout (print views).
export const bareRoutes = [
  { path: '/invoices/:id/print', roles: INTERNAL, element: page('invoices/InvoicePrint', 'Print invoice', 'Swathy', true) },
  { path: '/portal/invoices/:id/print', roles: [CUSTOMER], element: page('invoices/InvoicePrint', 'Print invoice', 'Swathy', true) },
];

// Pages outside the app layout, no login needed (A. Sachin)
export const publicRoutes = [
  { path: '/login', element: page('auth/Login', 'Login', 'Sachin', true) },
  { path: '/signup', element: page('auth/Signup', 'Sign up', 'Sachin', true) },
  { path: '/forgot-password', element: page('auth/ForgotPassword', 'Forgot password', 'Sachin', true) },
  { path: '/reset-password', element: page('auth/ResetPassword', 'Reset password', 'Sachin', true) },
];

/** Where a role lands after login. */
export function homeFor(role) {
  return role === CUSTOMER ? '/portal/subscriptions' : '/';
}
