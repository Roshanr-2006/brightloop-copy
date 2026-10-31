// Every page of the app is registered here (owner: Sachin).
// To add your page: import it and replace its `element` (Placeholder) below. One-line change, pull first.
//   roles: who can open it (also used to build the sidebar). Backend must enforce the same roles.

import Placeholder from './components/Placeholder.jsx';
import Home from './pages/Home.jsx';

// Sachin: set to true once /api/auth/login and /api/auth/me work.
// While false, every page is reachable without logging in so everyone can build their UI.
export const REQUIRE_LOGIN = false;

const ADMIN = 'admin';
const STAFF = 'staff';
const CUSTOMER = 'customer';
const INTERNAL = [ADMIN, STAFF];

// section groups items in the sidebar
export const appRoutes = [
  { path: '/', label: 'Dashboard', section: 'Overview', roles: INTERNAL, element: <Home /> },

  // D. Merryl
  { path: '/reports', label: 'Reports', section: 'Overview', roles: INTERNAL, element: <Placeholder title="Finance reports" owner="Merryl" /> },

  // C. Swathy
  { path: '/subscriptions', label: 'Subscriptions', section: 'Sales', roles: INTERNAL, element: <Placeholder title="Subscriptions" owner="Swathy" /> },
  { path: '/invoices', label: 'Invoices', section: 'Sales', roles: INTERNAL, element: <Placeholder title="Invoices" owner="Swathy" /> },
  { path: '/billing', label: 'Billing run', section: 'Sales', roles: INTERNAL, element: <Placeholder title="Billing run" owner="Swathy" /> },

  // D. Merryl
  { path: '/payments', label: 'Payments', section: 'Sales', roles: INTERNAL, element: <Placeholder title="Payments" owner="Merryl" /> },

  // A. Sachin
  { path: '/customers', label: 'Customers', section: 'Sales', roles: INTERNAL, element: <Placeholder title="Customers" owner="Sachin" /> },

  // B. Roshan
  { path: '/catalog/products', label: 'Products', section: 'Configuration', roles: INTERNAL, element: <Placeholder title="Products & variants" owner="Roshan" /> },
  { path: '/catalog/plans', label: 'Recurring plans', section: 'Configuration', roles: INTERNAL, element: <Placeholder title="Recurring plans" owner="Roshan" /> },
  { path: '/catalog/templates', label: 'Quotation templates', section: 'Configuration', roles: INTERNAL, element: <Placeholder title="Quotation templates" owner="Roshan" /> },
  { path: '/catalog/discounts', label: 'Discounts', section: 'Configuration', roles: [ADMIN], element: <Placeholder title="Discounts" owner="Roshan" /> },
  { path: '/catalog/taxes', label: 'Taxes', section: 'Configuration', roles: INTERNAL, element: <Placeholder title="Taxes" owner="Roshan" /> },
  { path: '/catalog/payment-terms', label: 'Payment terms', section: 'Configuration', roles: INTERNAL, element: <Placeholder title="Payment terms" owner="Roshan" /> },

  // A. Sachin
  { path: '/admin/staff', label: 'Staff users', section: 'Administration', roles: [ADMIN], element: <Placeholder title="Staff users" owner="Sachin" /> },

  // Customer portal (A. Sachin)
  { path: '/portal/subscriptions', label: 'My subscriptions', section: 'My account', roles: [CUSTOMER], element: <Placeholder title="My subscriptions" owner="Sachin" /> },
  { path: '/portal/invoices', label: 'My invoices', section: 'My account', roles: [CUSTOMER], element: <Placeholder title="My invoices" owner="Sachin" /> },
];

// Pages outside the app layout (no sidebar). A. Sachin
export const publicRoutes = [
  { path: '/login', element: <Placeholder title="Login" owner="Sachin" bare /> },
  { path: '/signup', element: <Placeholder title="Sign up" owner="Sachin" bare /> },
  { path: '/forgot-password', element: <Placeholder title="Forgot password" owner="Sachin" bare /> },
  { path: '/reset-password', element: <Placeholder title="Reset password" owner="Sachin" bare /> },
];
