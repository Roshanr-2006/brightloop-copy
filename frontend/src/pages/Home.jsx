// Temporary home page: proves frontend -> /api proxy -> Express -> SQLite works.
// Merryl replaces this with the finance dashboard.
import { useEffect, useState } from 'react';
import { api } from '../api/client';

export default function Home() {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/health').then(setHealth).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="card">
      <h2>Welcome to Brightloop</h2>
      <p className="muted">Subscription management: plans, subscriptions, invoices, payments and reports.</p>
      {error && <p className="error-text">{error}</p>}
      {health && (
        <p>
          API status: <strong>{health.status}</strong> &middot; {health.database.products} products,{' '}
          {health.database.plans} plans in the database.
        </p>
      )}
    </div>
  );
}
