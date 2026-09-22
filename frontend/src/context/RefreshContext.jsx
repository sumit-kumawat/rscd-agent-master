import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';

const RefreshContext = createContext({
  tick: 0,
  refresh: () => {},
  intervalSec: 15,
  setIntervalSec: () => {},
});

export function RefreshProvider({ children }) {
  const [tick, setTick] = useState(0);
  const [intervalSec, setIntervalSec] = useState(15);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const t = setInterval(refresh, intervalSec * 1000);
    return () => clearInterval(t);
  }, [intervalSec, refresh]);

  const value = useMemo(() => ({
    tick, refresh, intervalSec, setIntervalSec,
  }), [tick, refresh, intervalSec]);

  return (
    <RefreshContext.Provider value={value}>
      {children}
    </RefreshContext.Provider>
  );
}

export function useRefresh() {
  return useContext(RefreshContext);
}
