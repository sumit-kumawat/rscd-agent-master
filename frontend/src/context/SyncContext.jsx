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

function unwrapStatus(body) {
  if (!body) return null;
  if (body.running != null || body.lastSyncAt != null || body.progress != null) return body;
  if (body.data) return body.data;
  return body;
}

function isUiSync(payload) {
  if (payload?.ui === false) return false;
  const reason = payload?.reason;
  return reason === 'manual' || reason === 'initial';
}

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
  const manualActive = useRef(false);

  const applyStatus = useCallback((raw, { respectUi = true } = {}) => {
    const s = unwrapStatus(raw);
    if (!s) return;

    const showUi = !respectUi || s.ui !== false || manualActive.current;

    let completed = 0;
    let total = 0;
    if (s.running && s.progress?.total) {
      completed = s.progress.completed ?? 0;
      total = s.progress.total;
    } else if (s.running && s.lastSummary?.total) {
      total = s.lastSummary.total;
      completed = s.lastSummary.ok ?? 0;
    }

    const next = {
      running: !!s.running,
      lastSyncAt: s.lastSyncAt || null,
      completed,
      total,
    };
    if (statusEqual(lastStatus.current, next)) return;
    lastStatus.current = next;

    if (s.initialSyncDone != null) setInitialSyncDone(!!s.initialSyncDone);
    if (next.lastSyncAt) setLastSyncAt(next.lastSyncAt);

    if (!s.running) {
      setSyncing(false);
      setSyncProgress(null);
      manualActive.current = false;
      if (s.initialSyncDone !== false) setInitialSyncDone(true);
      return;
    }

    if (!showUi && !isUiSync(s)) {
      setSyncing(false);
      setSyncProgress(null);
      return;
    }

    setSyncing(true);
    if (next.total > 0) {
      setSyncProgress({ completed: next.completed, total: next.total });
    }
  }, []);

  const syncNow = useCallback(async () => {
    manualActive.current = true;
    setSyncing(true);
    try {
      await api.post('/sync/full', { reason: 'manual' });
    } catch {
      setSyncing(false);
      setSyncProgress(null);
      manualActive.current = false;
    }
  }, []);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;

    api.get('/sync/status').then((r) => {
      const s = unwrapStatus(r);
      if (s?.lastSyncAt) setLastSyncAt(s.lastSyncAt);
      if (s?.initialSyncDone != null) setInitialSyncDone(!!s.initialSyncDone);
      if (s?.running && isUiSync(s)) {
        applyStatus(s, { respectUi: true });
      }
    }).catch(() => {});
  }, [applyStatus]);

  useEffect(() => {
    if (!syncing) return undefined;
    const poll = () => api.get('/sync/status').then((raw) => applyStatus(raw)).catch(() => {});
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [syncing, applyStatus]);

  useEffect(() => onSocket('sync:start', (p) => {
    if (!isUiSync(p) && !manualActive.current) return;
    setSyncing(true);
    setInitialSyncDone(false);
    if (p?.total) {
      setSyncProgress({ completed: p.completed ?? 0, total: p.total });
    }
  }), []);

  useEffect(() => onSocket('sync:progress', (p) => {
    if (!isUiSync(p) && !manualActive.current) return;
    if (!p?.total) return;
    setSyncing(true);
    setSyncProgress({ completed: p.completed ?? 0, total: p.total });
  }), []);

  useEffect(() => onSocket('sync:complete', (payload) => {
    if (!isUiSync(payload) && !manualActive.current) {
      if (payload?.lastSyncAt) setLastSyncAt(payload.lastSyncAt);
      setSyncedTick((t) => t + 1);
      return;
    }
    setSyncing(false);
    setSyncProgress(null);
    manualActive.current = false;
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
