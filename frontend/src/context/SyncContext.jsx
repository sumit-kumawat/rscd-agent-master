import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import api from '../api';
import { onSocket } from '../socket';

const SyncContext = createContext({
  syncing: false,
  syncedTick: 0,
  lastSyncAt: null,
  syncProgress: null,
  syncNow: async () => {},
  initialSyncDone: true,
});

function statusEqual(a, b) {
  return a?.running === b?.running
    && a?.lastSyncAt === b?.lastSyncAt
    && a?.completed === b?.completed
    && a?.total === b?.total;
}

export function SyncProvider({ children }) {
  const [syncing, setSyncing] = useState(false);
  const [syncedTick, setSyncedTick] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [syncProgress, setSyncProgress] = useState(null);
  const [initialSyncDone, setInitialSyncDone] = useState(true);
  const booted = useRef(false);
  const lastStatus = useRef(null);

  const applyStatus = useCallback((s) => {
    if (!s) return;
    const next = {
      running: !!s.running,
      lastSyncAt: s.lastSyncAt || null,
      completed: s.lastSummary?.ok ?? 0,
      total: s.lastSummary?.total ?? 0,
    };
    if (statusEqual(lastStatus.current, next)) return;
    lastStatus.current = next;

    setSyncing(next.running);
    if (next.lastSyncAt) setLastSyncAt(next.lastSyncAt);
    if (next.total) setSyncProgress({ completed: next.completed, total: next.total });
    if (!next.running) setInitialSyncDone(true);
  }, []);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      await api.post('/sync/full', { reason: 'manual' });
    } catch {
      setSyncing(false);
      setInitialSyncDone(true);
    }
  }, []);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;

    api.post('/system/login', {}).catch(() => {});

    api.get('/sync/status').then((r) => {
      applyStatus(r.data);
      const s = r.data;
      if (!s?.running) {
        api.post('/sync/full', { reason: 'boot' }).catch(() => {});
      } else {
        setInitialSyncDone(false);
      }
    }).catch(() => setInitialSyncDone(true));

    const poll = () => api.get('/sync/status')
      .then((r) => applyStatus(r.data))
      .catch(() => {});
    const interval = setInterval(poll, 15000);
    return () => clearInterval(interval);
  }, [applyStatus]);

  useEffect(() => onSocket('sync:start', () => {
    setSyncing(true);
    setInitialSyncDone(false);
  }), []);

  useEffect(() => onSocket('sync:progress', (p) => {
    if (!p?.total) return;
    setSyncProgress((prev) => {
      if (prev?.completed === p.completed && prev?.total === p.total) return prev;
      return { completed: p.completed ?? 0, total: p.total };
    });
  }), []);

  useEffect(() => onSocket('sync:complete', (payload) => {
    setSyncing(false);
    setSyncProgress(null);
    setInitialSyncDone(true);
    setLastSyncAt(payload?.lastSyncAt || new Date().toISOString());
    setSyncedTick((t) => t + 1);
  }), []);

  const value = useMemo(() => ({
    syncing,
    syncedTick,
    lastSyncAt,
    syncProgress,
    syncNow,
    initialSyncDone,
  }), [syncing, syncedTick, lastSyncAt, syncProgress, syncNow, initialSyncDone]);

  return (
    <SyncContext.Provider value={value}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSync() {
  return useContext(SyncContext);
}
