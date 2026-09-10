import { createContext, useCallback, useContext, useState } from 'react';

const RefreshContext = createContext({ tick: 0, refresh: () => {} });

export function RefreshProvider({ children }) {
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return (
    <RefreshContext.Provider value={{ tick, refresh }}>
      {children}
    </RefreshContext.Provider>
  );
}

export function useRefresh() {
  return useContext(RefreshContext);
}
