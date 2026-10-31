// Current user + role for the whole app (owner: Sachin).
//   const { user, login, logout, hasRole } = useAuth();
// Expects these backend endpoints (Sachin's auth module):
//   GET  /api/auth/me      -> { user: { id, name, email, role, customerId } }
//   POST /api/auth/login   -> { user }   (sets an httpOnly cookie)
//   POST /api/auth/logout

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get('/auth/me');
      setUser(data?.user || null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const onExpired = () => setUser(null);
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [refresh]);

  const login = useCallback(async (email, password) => {
    const data = await api.post('/auth/login', { email, password });
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } finally { setUser(null); }
  }, []);

  const value = useMemo(() => ({
    user,
    loading,
    login,
    logout,
    refresh,
    hasRole: (...roles) => Boolean(user && roles.includes(user.role)),
  }), [user, loading, login, logout, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
