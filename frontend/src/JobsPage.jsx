import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, RefreshCw, XCircle, Loader2 } from 'lucide-react';
import api from './api';
import { onSocket } from './socket';
import { useToast } from './components/Toast';
import { useSearch } from './context/SearchContext';
import { useRefresh } from './context/RefreshContext';
import { patchJobList } from './utils/jobSockets';

function Badge({ status }) {
  const m = { completed: 'badge-online', failed: 'badge-offline', running: 'badge-progress', pending: 'badge-excluded', cancelled: 'badge-excluded' };
  return <span className={`badge ${m[status] || 'badge-excluded'}`}>{status}</span>;
}

export default function JobsPage() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const { search } = useSearch();
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const { tick } = useRefresh();
  const nav = useNavigate();
  const toast = useToast();

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = () => {
    setLoading(true);
    const q = debouncedSearch ? `?search=${encodeURIComponent(debouncedSearch)}` : '';
    api.get(`/jobs${q}`).then((r) => setJobs(r.data || [])).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [debouncedSearch, tick]);

  useEffect(() => {
    const patch = (data) => setJobs((prev) => patchJobList(prev, data));
    const off1 = onSocket('job:progress', patch);
    const off2 = onSocket('job:started', patch);
    const off3 = onSocket('job:completed', (data) => {
      patch({ ...data, status: data.job?.status || 'completed', progress: 100 });
      load();
    });
    const off4 = onSocket('job:cancelled', (data) => patch({ ...data, status: 'cancelled' }));
    return () => { off1(); off2(); off3(); off4(); };
  }, []);

  const cancelJob = async (job) => {
    if (!confirm(`Cancel job "${job.name}"?`)) return;
    try {
      await api.post(`/jobs/${job._id}/cancel`, {});
      setJobs((prev) => patchJobList(prev, { jobId: job._id, status: 'cancelled' }));
      toast('Job cancelled', 'info');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div className="page">
      <div className="toolbar">
        <span className="page-title">Jobs</span>
        <div className="toolbar-right">
          <button className="btn btn-outline" onClick={load}><RefreshCw size={14} /> Refresh</button>
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
              <th className="col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="empty"><Loader2 className="spin" size={18} /> Loading…</td></tr>
            ) : jobs.length === 0 ? (
              <tr><td colSpan={6} className="empty">No jobs yet</td></tr>
            ) : jobs.map((j) => {
              const running = ['pending', 'running'].includes(j.status);
              const progress = j.progress || 0;
              return (
                <tr
                  key={j._id}
                  className={`data-row ${running ? 'row-running' : ''}`}
                  onClick={() => nav(`/jobs/${j._id}`)}
                >
                  <td className="col-host">{j.name}</td>
                  <td className="col-status">
                    <Badge status={j.status} />
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
                    ✓{j.statistics?.success || 0} ✗{j.statistics?.failed || 0} ⊘{j.statistics?.skipped || 0}
                  </td>
                  <td className="col-date">{new Date(j.createdAt).toLocaleString()}</td>
                  <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-outline btn-sm" onClick={() => nav(`/jobs/${j._id}`)}><Eye size={14} /> View</button>
                    {running && <button className="btn btn-danger btn-sm" onClick={() => cancelJob(j)}><XCircle size={14} /></button>}
                  </td>
                </tr>
              );
            })}
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
