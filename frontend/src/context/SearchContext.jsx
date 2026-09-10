import { createContext, useContext, useState } from 'react';

const SearchContext = createContext({ search: '', setSearch: () => {} });

export function SearchProvider({ children }) {
  const [search, setSearch] = useState('');
  return (
    <SearchContext.Provider value={{ search, setSearch }}>
      {children}
    </SearchContext.Provider>
  );
}

export function useSearch() {
  return useContext(SearchContext);
}
