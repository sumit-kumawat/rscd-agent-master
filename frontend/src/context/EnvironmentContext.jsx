import { createContext, useContext, useMemo, useState } from 'react';

const EnvironmentContext = createContext({
  environment: 'rnd',
  setEnvironment: () => {},
  isProd: false,
});

export function EnvironmentProvider({ children }) {
  const [environment, setEnvironment] = useState('rnd');
  const value = useMemo(() => ({
    environment,
    setEnvironment,
    isProd: environment === 'prod',
  }), [environment]);
  return (
    <EnvironmentContext.Provider value={value}>
      {children}
    </EnvironmentContext.Provider>
  );
}

export function useEnvironment() {
  return useContext(EnvironmentContext);
}
