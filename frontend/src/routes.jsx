import { createHashRouter, Navigate } from 'react-router-dom';
import RootProviders from './RootProviders';
import Layout from './Layout';
import DashboardPage from './DashboardPage';
import VmsPage from './VmsPage';
import JobsPage, { NewJobPage } from './JobsPage';
import JobPage from './JobPage';
import LogsPage from './LogsPage';
import DebugPage from './DebugPage';

export const router = createHashRouter([
  {
    path: '/',
    element: (
      <RootProviders>
        <Layout />
      </RootProviders>
    ),
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'vms', element: <VmsPage /> },
      { path: 'jobs', element: <JobsPage /> },
      { path: 'jobs/new', element: <NewJobPage /> },
      { path: 'jobs/:id', element: <JobPage /> },
      { path: 'logs', element: <LogsPage /> },
      { path: 'debug', element: <DebugPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/dashboard" replace /> },
]);
