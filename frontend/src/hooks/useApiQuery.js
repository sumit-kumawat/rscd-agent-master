import { useCallback, useEffect, useRef, useState } from 'react';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hasLoadedData(cur) {
  if (cur === undefined || cur === null) return false;
  if (Array.isArray(cur)) return cur.length > 0;
  return true;
}

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
    hasLoadedData(initialData) ? 'success' : 'idle',
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

    const hasData = hasLoadedData(dataRef.current);
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
        dataRef.current = result;
        setStatus(isEmpty ? 'empty' : 'success');
        return;
      } catch (err) {
        if (err.name === 'AbortError' && id !== runId.current) {
          return;
        }
        if (err.name === 'AbortError' && controller.signal.aborted && id === runId.current) {
          lastErr = err.message?.includes('timed out')
            ? err
            : new Error(err.message || 'Request cancelled');
          if (attempt < retries && lastErr.message?.includes('timed out')) {
            await sleep(Math.min(1000 * 2 ** attempt, 8000));
            continue;
          }
          break;
        }
        lastErr = err;
        if (attempt < retries) await sleep(Math.min(1000 * 2 ** attempt, 8000));
      }
    }

    if (id !== runId.current) return;
    setError(lastErr?.message || 'Request failed');
    setStatus(hasLoadedData(dataRef.current) ? 'success' : 'error');
  }, [enabled, retries, timeout]);

  useEffect(() => {
    setError(null);
    if (!enabled) return undefined;

    const silent = hasLoadedData(dataRef.current);
    reload(silent);
    return () => { abortRef.current?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, enabled, ...deps]);

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
