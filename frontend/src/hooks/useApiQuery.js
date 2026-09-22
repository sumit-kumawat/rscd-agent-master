import { useCallback, useEffect, useRef, useState } from 'react';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Stable data-fetch hook: timeout + retry, never infinite loading.
 * - First fetch: loading skeleton when no cached data
 * - Refetch: silent (keeps previous data, no loading flash)
 * - AbortController on unmount / dep change
 */
export function useApiQuery(fetcher, deps = [], options = {}) {
  const {
    enabled = true,
    timeout = 15000,
    retries = 2,
    initialData = undefined,
  } = options;

  const [status, setStatus] = useState(
    initialData !== undefined && initialData !== null ? 'success' : 'idle',
  );
  const [data, setData] = useState(initialData);
  const [error, setError] = useState(null);
  const runId = useRef(0);
  const fetcherRef = useRef(fetcher);
  const abortRef = useRef(null);
  const dataRef = useRef(initialData);
  fetcherRef.current = fetcher;
  dataRef.current = data;

  const patchData = useCallback((patcher) => {
    setData((prev) => {
      const next = typeof patcher === 'function' ? patcher(prev) : patcher;
      dataRef.current = next;
      return next;
    });
  }, []);

  const reload = useCallback(async (silent = false) => {
    if (!enabled) return;
    const id = ++runId.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const cur = dataRef.current;
    const hasData = cur !== undefined && cur !== null
      && !(Array.isArray(cur) && cur.length === 0);
    if (!silent && !hasData) setStatus('loading');
    setError(null);

    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (controller.signal.aborted) return;
      try {
        const result = await fetcherRef.current({ timeout, signal: controller.signal });
        if (id !== runId.current || controller.signal.aborted) return;
        const isEmpty = result == null || (Array.isArray(result) && result.length === 0);
        setData(result);
        setStatus(isEmpty ? 'empty' : 'success');
        return;
      } catch (err) {
        if (err.name === 'AbortError') {
          if (id === runId.current) {
            const stillHasData = dataRef.current !== undefined && dataRef.current !== null;
            setStatus(stillHasData ? 'success' : 'idle');
          }
          return;
        }
        lastErr = err;
        if (attempt < retries) await sleep(Math.min(1000 * 2 ** attempt, 8000));
      }
    }

    if (id !== runId.current) return;
    setError(lastErr?.message || 'Request failed');
    const stillHasData = dataRef.current !== undefined && dataRef.current !== null;
    setStatus(stillHasData ? 'success' : 'error');
  }, [enabled, retries, timeout]);

  useEffect(() => {
    setData(initialData);
    dataRef.current = initialData;
    setError(null);
    setStatus(
      initialData !== undefined && initialData !== null ? 'success' : (enabled ? 'idle' : 'empty'),
    );

    if (!enabled) return undefined;

    reload(true);
    return () => { abortRef.current?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, enabled, initialData, ...deps]);

  const silentReload = useCallback(() => reload(true), [reload]);
  const isLoading = status === 'loading';

  return {
    status,
    data,
    error,
    reload,
    silentReload,
    patchData,
    isLoading,
    isError: status === 'error',
    isEmpty: status === 'empty',
  };
}
