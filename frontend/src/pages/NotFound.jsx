import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="card empty-state">
      <h2>Page not found</h2>
      <p className="muted">The page you are looking for does not exist.</p>
      <Link to="/" className="btn primary">Go to dashboard</Link>
    </div>
  );
}
