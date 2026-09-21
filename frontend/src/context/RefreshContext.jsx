import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const RefreshContext = createContext({
  tick: 0,
  refresh: () => {},
  autoRefresh: true,
  setAutoRefresh: () => {},
  intervalSec: 30,
  setIntervalSec: () => {},
});

export function RefreshProvider({ children }) {
  const [tick, setTick] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [intervalSec, setIntervalSec] = useState(30);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const t = setInterval(refresh, intervalSec * 1000);
    return () => clearInterval(t);
  }, [autoRefresh, intervalSec, refresh]);

  return (
    <RefreshContext.Provider value={{
      tick, refresh, autoRefresh, setAutoRefresh, intervalSec, setIntervalSec,
    }}>
      {children}
    </RefreshContext.Provider>
  );
}

export function useRefresh() {
  return useContext(RefreshContext);
}
