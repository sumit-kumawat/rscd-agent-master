import { useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import api from './api';
import { onSocket } from './socket';
import { useSearch } from './context/SearchContext';
import { useRefresh } from './context/RefreshContext';
import { useLiveData } from './hooks/useLiveData';

const COLS = [
  { key: 'timestamp', label: 'Timestamp', width: 160 },
  { key: 'actor', label: 'Actor', width: 100 },
  { key: 'action', label: 'Action', width: 140 },
  { key: 'vmName', label: 'Endpoint', width: 120 },
  { key: 'step', label: 'Step', width: 100 },
  { key: 'status', label: 'Status', width: 90 },
  { key: 'durationMs', label: 'Duration', width: 80 },
  { key: 'message', label: 'Message', width: 320 },
];

function cellValue(log, key) {
  if (key === 'timestamp') return log.timestamp ? new Date(log.timestamp).toLocaleString() : '';
  if (key === 'action') return log.action || log.category || '';
  if (key === 'step') return log.meta?.step || log.step || '';
  if (key === 'durationMs') return log.durationMs != null ? `${log.durationMs}ms` : '';
  return log[key] ?? '';
}

function rowToTsv(log) {
  return COLS.map((c) => cellValue(log, c.key)).join('\t');
}

function exportCsv(logs) {
  const header = COLS.map((c) => c.label).join(',');
  const rows = logs.map((log) => COLS.map((c) => {
    const v = String(cellValue(log, c.key)).replace(/"/g, '""');
    return `"${v}"`;
  }).join(','));
  const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `audit-log-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function LogsPage() {
  const [category, setCategory] = useState('');
  const [sortKey, setSortKey] = useState('timestamp');
  const [sortDir, setSortDir] = useState('desc');
  const [selectedRow, setSelectedRow] = useState(null);
  const { search } = useSearch();
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const { tick } = useRefresh();

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(t);
  }, [search]);

  const { data: logsRaw, reload, patchData } = useLiveData(
    async () => {
      const params = new URLSearchParams();
      if (category) params.set('category', category);
      if (debouncedSearch) params.set('search', debouncedSearch);
      params.set('limit', '1000');
      const r = await api.get(`/logs?${params}`);
      return r.data || [];
    },
    [category, debouncedSearch, tick],
  );

  const logs = Array.isArray(logsRaw) ? logsRaw : [];

  useEffect(() => onSocket('log:activity', (entry) => {
    patchData((prev) => [entry, ...(prev || [])].slice(0, 1000));
  }), [patchData]);

  const sorted = useMemo(() => {
    const copy = [...logs];
    copy.sort((a, b) => {
      const av = cellValue(a, sortKey);
      const bv = cellValue(b, sortKey);
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return copy;
  }, [logs, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const copyRow = async (log) => {
    try {
      await navigator.clipboard.writeText(rowToTsv(log));
    } catch { /* ignore */ }
  };

  return (
    <div className="page">
      <div className="toolbar">
        <span className="page-title">Audit Log</span>
        <select className="input toolbar-select" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          <option value="vm">VM</option>
          <option value="job">Job</option>
          <option value="power">Power</option>
          <option value="wmi">WMI</option>
          <option value="import">Import</option>
          <option value="system">System</option>
        </select>
        <div className="toolbar-right">
          <button type="button" className="btn btn-outline" onClick={() => exportCsv(sorted)}>
            <Download size={14} /> Export CSV
          </button>
          <button type="button" className="btn btn-outline" onClick={() => reload()}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      <div className="spreadsheet-wrap">
        <table className="spreadsheet-table">
          <thead>
            <tr>
              {COLS.map((col) => (
                <th
                  key={col.key}
                  style={{ minWidth: col.width }}
                  className="spreadsheet-th"
                  onClick={() => toggleSort(col.key)}
                >
                  {col.label}
                  {sortKey === col.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={COLS.length} className="empty">No audit entries yet</td></tr>
            ) : sorted.map((log) => (
              <tr
                key={log._id || `${log.timestamp}-${log.message}`}
                className={`spreadsheet-row data-row${selectedRow === log._id ? ' spreadsheet-row-selected' : ''}`}
                onClick={() => {
                  setSelectedRow(log._id);
                  copyRow(log);
                }}
              >
                {COLS.map((col) => (
                  <td key={col.key} className={col.key === 'timestamp' ? 'spreadsheet-sticky' : ''}>
                    {cellValue(log, col.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
