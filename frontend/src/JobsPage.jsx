import { memo, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { RefreshCw, Loader2 } from 'lucide-react';
import api, { unwrapList } from './api';
import { onSocket } from './socket';
import { useToast } from './components/Toast';
import { useSearch } from './context/SearchContext';
import { useRefresh } from './context/RefreshContext';
import { useApiQuery } from './hooks/useApiQuery';
import { patchJobList } from './utils/jobSockets';
import { TableSkeleton } from './components/ui/TabSkeletons';

function Badge({ status }) {
  const m = { completed: 'badge-online', failed: 'badge-offline', running: 'badge-progress', pending: 'badge-excluded', cancelled: 'badge-excluded' };
  return <span className={`badge ${m[status] || 'badge-excluded'}`}>{status}</span>;
}

const JobRow = memo(function JobRow({ job, onOpen }) {
  const running = ['pending', 'running'].includes(job.status);
  const progress = job.progress || 0;
  return (
    <tr
      className={`data-row ${running ? 'row-running' : ''}`}
      onClick={() => onOpen(job._id)}
    >
      <td className="col-host">{job.name}</td>
      <td className="col-status">
        <Badge status={job.status} />
        {running && <Loader2 className="spin row-running-icon" size={12} />}
      </td>
      <td>
        <div className="progress-inline">
          <div className="progress-track">
            <div
              className={`progress-fill ${running ? 'progress-fill-live' : ''}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="progress-label">{progress}%</span>
        </div>
      </td>
      <td className="col-results">
        ✓{job.statistics?.success || 0} ✗{job.statistics?.failed || 0} ⊘{job.statistics?.skipped || 0}
      </td>
      <td className="col-date">{new Date(job.createdAt).toLocaleString()}</td>
    </tr>
  );
});

export default function JobsPage() {
  const { search } = useSearch();
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const { tick } = useRefresh();
  const nav = useNavigate();

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const {
    data: jobsRaw,
    isLoading,
    isError,
    error,
    reload,
    patchData,
  } = useApiQuery(
    async ({ timeout, signal }) => {
      const q = debouncedSearch ? `?search=${encodeURIComponent(debouncedSearch)}` : '';
      const r = await api.get(`/jobs${q}`, { timeout, signal });
      return unwrapList(r);
    },
    [debouncedSearch, tick],
  );

  const jobs = Array.isArray(jobsRaw) ? jobsRaw : [];

  useEffect(() => {
    const patch = (data) => patchData((prev) => patchJobList(prev, data));
    const off1 = onSocket('job:progress', patch);
    const off2 = onSocket('job:started', patch);
    const off3 = onSocket('job:completed', (data) => {
      patch({ ...data, status: data.job?.status || 'completed', progress: 100 });
    });
    const off4 = onSocket('job:cancelled', (data) => patch({ ...data, status: 'cancelled' }));
    return () => { off1(); off2(); off3(); off4(); };
  }, [patchData]);

  const loading = isLoading && !jobs.length;

  return (
    <div className="page">
      <div className="toolbar">
        <span className="page-title">Jobs</span>
        <div className="toolbar-right">
          <button className="btn btn-outline" onClick={() => reload(true)}><RefreshCw size={14} /> Refresh</button>
          <Link to="/jobs/new" className="btn btn-primary">New Job</Link>
        </div>
      </div>
      <div className="table-wrap">
        <table className="agent-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Results</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5}><TableSkeleton rows={5} cols={4} /></td></tr>
            ) : isError ? (
              <tr><td colSpan={5} className="empty">{error} — <button className="btn btn-outline btn-sm" onClick={() => reload(false)}>Retry</button></td></tr>
            ) : jobs.length === 0 ? (
              <tr><td colSpan={5} className="empty">No jobs yet</td></tr>
            ) : jobs.map((j) => (
              <JobRow key={j._id} job={j} onOpen={(id) => nav(`/jobs/${id}`)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function NewJobPage() {
  const [name, setName] = useState('');
  const [below, setBelow] = useState('22.4.00');
  const [versionFilter, setVersionFilter] = useState(false);
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();
  const toast = useToast();

  const start = async () => {
    if (!confirm('Permanently uninstall RSCD agents on matching VMs via WMI?')) return;
    setLoading(true);
    try {
      const r = await api.post('/jobs', {
        name: name || (versionFilter ? `Uninstall below ${below}` : 'Uninstall all RSCD agents'),
        filter: { belowVersion: below, useBelowVersion: versionFilter },
      });
      toast('Job created', 'success');
      nav(`/jobs/${(r.data || r.job)._id}`);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="toolbar">
        <span className="page-title">New Job</span>
        <div className="toolbar-right">
          <Link to="/jobs" className="btn btn-outline">Cancel</Link>
        </div>
      </div>

      <div className="page-panel">
        <p className="page-panel-desc">
          Uninstalls BMC RSCD / BladeLogic agents on all Windows VMs via WMI.
        </p>
        <div className="card">
          <label className="field"><span>Job name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Cleanup Q1" /></label>
          <label className="field field-row">
            <input type="checkbox" checked={versionFilter} onChange={(e) => setVersionFilter(e.target.checked)} />
            <span>Only uninstall versions below threshold (optional)</span>
          </label>
          {versionFilter && (
            <label className="field"><span>Keep versions ≥</span>
              <input className="input" value={below} onChange={(e) => setBelow(e.target.value)} /></label>
          )}
          <div className="alert alert-danger">This will permanently uninstall RSCD agents via WMI on all matching hosts.</div>
          <div className="form-actions">
            <button className="btn btn-danger" disabled={loading} onClick={start}>
              {loading ? 'Starting…' : 'Start Uninstall'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
