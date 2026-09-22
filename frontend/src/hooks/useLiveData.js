import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Fetch live data without blocking UI — keeps last good value, no skeleton states.
 */
export function useLiveData(fetcher, deps = []) {
  const [data, setData] = useState(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const mounted = useRef(true);

  const reload = useCallback(async () => {
    try {
      const result = await fetcherRef.current();
      if (mounted.current) setData(result);
    } catch {
      /* keep previous data */
    }
  }, []);

  const patchData = useCallback((patcher) => {
    setData((prev) => (typeof patcher === 'function' ? patcher(prev) : patcher));
  }, []);

  useEffect(() => {
    mounted.current = true;
    reload();
    return () => { mounted.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, ...deps]);

  return { data, reload, patchData, setData };
}
