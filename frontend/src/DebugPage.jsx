import { useEffect, useState } from 'react';
import api from './api';
import { useSocketStatus } from './context/SocketContext';
import { useSync } from './context/SyncContext';

export default function DebugPage() {
  const socket = useSocketStatus();
  const sync = useSync();
  const [health, setHealth] = useState(null);
  const [ready, setReady] = useState(null);
  const [lastApi, setLastApi] = useState(null);

  useEffect(() => {
    const t0 = performance.now();
    fetch('/health').then((r) => r.json()).then(setHealth).catch((e) => setHealth({ error: e.message }));
    fetch('/ready').then((r) => r.json()).then(setReady).catch((e) => setReady({ error: e.message }));
    api.get('/sync/status')
      .then((r) => setLastApi({ url: '/api/sync/status', ms: Math.round(performance.now() - t0), ok: true, body: r }))
      .catch((e) => setLastApi({ url: '/api/sync/status', ms: Math.round(performance.now() - t0), ok: false, error: e.message }));
  }, []);

  if (import.meta.env.PROD) {
    return <div className="page"><div className="empty">Debug page is only available in development.</div></div>;
  }

  return (
    <div className="page debug-page">
      <h2 className="page-title">Debug</h2>
      <div className="debug-grid">
        <div className="debug-card"><h4>API base</h4><code>/api</code></div>
        <div className="debug-card"><h4>WebSocket</h4><code>{socket.connected ? 'connected' : socket.reconnecting ? 'reconnecting' : 'disconnected'}</code>{socket.lastError && <p className="muted">{socket.lastError}</p>}</div>
        <div className="debug-card"><h4>Sync</h4><code>{sync.syncing ? 'running' : 'idle'}</code></div>
        <div className="debug-card"><h4>Last sync</h4><code>{sync.lastSyncAt || 'never'}</code></div>
        <div className="debug-card"><h4>Health</h4><pre>{JSON.stringify(health, null, 2)}</pre></div>
        <div className="debug-card"><h4>Ready</h4><pre>{JSON.stringify(ready, null, 2)}</pre></div>
        <div className="debug-card"><h4>Last API</h4><pre>{JSON.stringify(lastApi, null, 2)}</pre></div>
      </div>
    </div>
  );
}
