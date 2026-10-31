import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { REQUIRE_LOGIN } from '../routes.jsx';

// Blocks a page unless the user is logged in with one of `roles`.
// (UI convenience only: the backend must still check roles on every API route.)
export default function ProtectedRoute({ roles, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (!REQUIRE_LOGIN) return children;
  if (loading) return <div className="page-loading">Loading...</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.includes(user.role)) {
    return (
      <div className="card empty-state">
        <h2>Access denied</h2>
        <p className="muted">Your role ({user.role}) cannot open this page.</p>
      </div>
    );
  }
  return children;
}
