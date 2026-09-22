import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

/**
 * Migrate old bookmarked paths (/vms) to hash routes (/#/vms) so SPA works behind any proxy.
 */
function migrateHistoryPathToHash() {
  const { pathname, search, hash } = window.location;
  if (hash && hash.startsWith('#/')) return;
  const appPaths = ['/dashboard', '/vms', '/jobs', '/logs', '/debug'];
  const isAppPath = pathname === '/' || appPaths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isAppPath) return;
  const target = pathname === '/' ? '/dashboard' : pathname;
  window.location.replace(`/#${target}${search}`);
}

migrateHistoryPathToHash();

createRoot(document.getElementById('root')).render(<App />);
