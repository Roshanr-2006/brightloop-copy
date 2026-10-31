// One place for every API call (owner: Sachin).
//   import { api } from '../api/client';
//   const { items, total } = await api.get('/catalog/products', { page: 1, search: 'crm' });
//   await api.post('/catalog/products', { name, sales_price });
// Errors throw ApiError with .status and .fields ({ field: 'message' }) for showing under inputs.

export class ApiError extends Error {
  constructor(message, status, fields = {}) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

function buildQuery(params) {
  if (!params) return '';
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : '';
}

async function request(method, path, { body, params } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}${buildQuery(params)}`, {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Is the backend running on port 4000?', 0);
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event('auth:expired'));
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data?.fields || {});
  }
  return data;
}

export const api = {
  get: (path, params) => request('GET', path, { params }),
  post: (path, body) => request('POST', path, { body }),
  put: (path, body) => request('PUT', path, { body }),
  patch: (path, body) => request('PATCH', path, { body }),
  delete: (path) => request('DELETE', path),
};
