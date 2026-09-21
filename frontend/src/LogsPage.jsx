import { useEffect, useState, useRef } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import api from './api';
import { onSocket } from './socket';
import { useSearch } from './context/SearchContext';
import { useRefresh } from './context/RefreshContext';

const levelClass = { error: 'log-msg-error', warning: 'log-msg-warning', success: 'log-msg-success' };

export default function LogsPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const topRef = useRef(null);
  const { search } = useSearch();
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const { tick } = useRefresh();

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter) params.set('category', filter);
    if (debouncedSearch) params.set('search', debouncedSearch);
    params.set('limit', '500');
    const q = params.toString() ? `?${params}` : '';
    api.get(`/logs${q}`)
      .then((r) => setLogs(r.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [filter, debouncedSearch, tick]);

  useEffect(() => {
    return onSocket('log:activity', (entry) => {
      setLogs((prev) => [entry, ...prev].slice(0, 500));
    });
  }, []);

  useEffect(() => {
    topRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs.length]);

  return (
    <div className="page">
      <div className="toolbar">
        <span className="page-title">Audit Log</span>
        <select className="input toolbar-select" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All</option>
          <option value="vm">VM</option>
          <option value="job">Job</option>
          <option value="power">Power</option>
          <option value="wmi">WMI</option>
          <option value="provision">Provision</option>
          <option value="console">Console</option>
          <option value="monitor">Monitor</option>
          <option value="system">System</option>
        </select>
        <div className="toolbar-right">
          <button className="btn btn-outline" onClick={load}><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      <div className="log-panel">
        <div className="log-panel-header">
          <span>Real-time audit events</span>
          <span className="log-count">{logs.length} entries</span>
        </div>
        <div className="log-list">
          <div ref={topRef} />
          {loading ? (
            <div className="empty"><Loader2 className="spin" size={18} /> Loading…</div>
          ) : logs.length === 0 ? (
            <div className="empty">No audit entries yet — actions performed in the portal will appear here</div>
          ) : logs.map((log) => (
            <div key={log._id || `${log.timestamp}-${log.message}`} className="log-row data-row audit-row">
              <span className="log-time">{new Date(log.timestamp).toLocaleString()}</span>
              <span className="log-cat">{log.action || log.category}</span>
              <span className={levelClass[log.level] || ''}>
                <span className="audit-meta">
                  {log.actor && <span className="audit-tag">{log.actor}</span>}
                  {log.status && <span className="audit-tag">{log.status}</span>}
                  {log.durationMs != null && <span className="audit-tag">{log.durationMs}ms</span>}
                  {log.vmName && <span className="audit-tag">{log.vmName}</span>}
                </span>
                {log.message}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
