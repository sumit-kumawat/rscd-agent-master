import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from './components/Toast';
import ErrorBoundary from './components/ErrorBoundary';
import { SearchProvider } from './context/SearchContext';
import { RefreshProvider } from './context/RefreshContext';
import { SyncProvider } from './context/SyncContext';
import { EnvironmentProvider } from './context/EnvironmentContext';
import { SocketProvider } from './context/SocketContext';
import Layout from './Layout';
import DashboardPage from './DashboardPage';
import VmsPage from './VmsPage';
import JobsPage, { NewJobPage } from './JobsPage';
import JobPage from './JobPage';
import LogsPage from './LogsPage';
import DebugPage from './DebugPage';

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <SocketProvider>
          <SearchProvider>
            <RefreshProvider>
              <SyncProvider>
                <EnvironmentProvider>
                <BrowserRouter>
                  <Routes>
                    <Route path="/" element={<Layout />}>
                      <Route index element={<Navigate to="/dashboard" replace />} />
                      <Route path="dashboard" element={<DashboardPage />} />
                      <Route path="vms" element={<VmsPage />} />
                      <Route path="jobs" element={<JobsPage />} />
                      <Route path="jobs/new" element={<NewJobPage />} />
                      <Route path="jobs/:id" element={<JobPage />} />
                      <Route path="logs" element={<LogsPage />} />
                      <Route path="debug" element={<DebugPage />} />
                    </Route>
                    <Route path="*" element={<Navigate to="/dashboard" replace />} />
                  </Routes>
                </BrowserRouter>
                </EnvironmentProvider>
              </SyncProvider>
            </RefreshProvider>
          </SearchProvider>
        </SocketProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
