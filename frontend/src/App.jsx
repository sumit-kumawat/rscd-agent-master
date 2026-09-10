import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from './components/Toast';
import { SearchProvider } from './context/SearchContext';
import { RefreshProvider } from './context/RefreshContext';
import Layout from './Layout';
import VmsPage from './VmsPage';
import JobsPage, { NewJobPage } from './JobsPage';
import JobPage from './JobPage';
import LogsPage from './LogsPage';

export default function App() {
  return (
    <ToastProvider>
      <SearchProvider>
        <RefreshProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Navigate to="/vms" replace />} />
              <Route path="vms" element={<VmsPage />} />
              <Route path="jobs" element={<JobsPage />} />
              <Route path="jobs/new" element={<NewJobPage />} />
              <Route path="jobs/:id" element={<JobPage />} />
              <Route path="logs" element={<LogsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/vms" replace />} />
          </Routes>
        </BrowserRouter>
        </RefreshProvider>
      </SearchProvider>
    </ToastProvider>
  );
}
