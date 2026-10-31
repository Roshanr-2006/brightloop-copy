import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The React dev server (5173) forwards every /api call to the Express API (4000),
// so the frontend can call fetch('/api/...') with cookies and no CORS issues.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Allow GitHub Codespaces preview URLs (*.app.github.dev).
    allowedHosts: ['.app.github.dev'],
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});
