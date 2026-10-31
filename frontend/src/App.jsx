import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import { ToastProvider } from './components/ui/index.jsx';
import NotFound from './pages/NotFound.jsx';
import { appRoutes, bareRoutes, publicRoutes } from './routes.jsx';

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        {publicRoutes.map((r) => (
          <Route key={r.path} path={r.path} element={r.element} />
        ))}

        {bareRoutes.map((r) => (
          <Route key={r.path} path={r.path} element={<ProtectedRoute roles={r.roles}>{r.element}</ProtectedRoute>} />
        ))}

        <Route element={<AppLayout />}>
          {appRoutes.map((r) => (
            <Route
              key={r.path}
              path={r.path}
              element={<ProtectedRoute roles={r.roles}>{r.element}</ProtectedRoute>}
            />
          ))}
          <Route path="/home" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}
