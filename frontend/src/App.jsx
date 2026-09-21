import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from './components/Toast';
import { SearchProvider } from './context/SearchContext';
import { RefreshProvider } from './context/RefreshContext';
import Layout from './Layout';
import VmsPage from './VmsPage';
import JobsPage, { NewJobPage } from './JobsPage';
import JobPage from './JobPage';
import LogsPage from './LogsPage';
import api from './api';

function LoginBootstrap() {
  useEffect(() => {
    api.post('/system/operator-session', {}).catch(() => {});
  }, []);
  return null;
}

export default function App() {
  return (
    <ToastProvider>
      <SearchProvider>
        <RefreshProvider>
        <BrowserRouter>
          <LoginBootstrap />
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="vms" element={<VmsPage />} />
              <Route path="jobs" element={<JobsPage />} />
              <Route path="jobs/new" element={<NewJobPage />} />
              <Route path="jobs/:id" element={<JobPage />} />
              <Route path="logs" element={<LogsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
        </RefreshProvider>
      </SearchProvider>
    </ToastProvider>
  );
}
