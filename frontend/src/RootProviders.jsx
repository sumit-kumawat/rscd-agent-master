import { SocketProvider } from './context/SocketContext';
import { SearchProvider } from './context/SearchContext';
import { RefreshProvider } from './context/RefreshContext';
import { SyncProvider } from './context/SyncContext';

export default function RootProviders({ children }) {
  return (
    <SocketProvider>
      <SearchProvider>
        <RefreshProvider>
          <SyncProvider>
            {children}
          </SyncProvider>
        </RefreshProvider>
      </SearchProvider>
    </SocketProvider>
  );
}
