// Paginated list loader for any `{ items, total, page, pages }` endpoint.
//   const list = useList('/catalog/products', { search: '', status: '' });
//   list.data.items, list.loading, list.error, list.params, list.setParam('search', 'crm'), list.setPage(2), list.reload()
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

export default function useList(path, initialParams = {}, { limit = 20 } = {}) {
  const [params, setParams] = useState({ page: 1, limit, ...initialParams });
  const [data, setData] = useState({ items: [], total: 0, page: 1, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get(path, params)
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [path, JSON.stringify(params), tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const setParam = useCallback((key, value) => setParams((p) => ({ ...p, [key]: value, page: 1 })), []);
  const setPage = useCallback((page) => setParams((p) => ({ ...p, page })), []);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  return { data, loading, error, params, setParams, setParam, setPage, reload };
}
