import { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import api from './api';
import { getSocket, onSocket } from './socket';
import { useToast } from './components/Toast';

function Badge({ status }) {
  const m = { completed: 'badge-online', failed: 'badge-offline', running: 'badge-progress', pending: 'badge-excluded', cancelled: 'badge-excluded' };
  return <span className={`badge ${m[status] || 'badge-excluded'}`}>{status}</span>;
}

export default function JobPage() {
  const { id } = useParams();
  const [job, setJob] = useState(null);
  const [logs, setLogs] = useState([]);
  const endRef = useRef(null);
  const toast = useToast();

  const load = () => {
    Promise.all([api.get(`/jobs/${id}`), api.get(`/jobs/${id}/logs`)])
      .then(([j, l]) => { setJob(j.data); setLogs(l.logs || []); })
      .catch((e) => toast(e.message, 'error'));
  };

  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    getSocket().emit('join:job', id);
    const off1 = onSocket('job:progress', (d) => { if (String(d.jobId) === id) load(); });
    const off2 = onSocket('job:completed', (d) => { if (String(d.jobId) === id) { load(); toast('Job finished', 'info'); } });
    const off3 = onSocket('log:new', (d) => {
      if (String(d.jobId) !== id) return;
      setLogs((prev) => [...prev, d.entry].slice(-500));
    });
    return () => { off1(); off2(); off3(); };
  }, [id, toast]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  if (!job) {
    return (
      <div className="page">
        <div className="toolbar">
          <Link to="/jobs" className="link back-link">← Jobs</Link>
          <span className="page-title">Loading…</span>
        </div>
      </div>
    );
  }

  const logColor = (l) => ({ error: 'log-msg-error', warning: 'log-msg-warning', success: 'log-msg-success' }[l] || '');
  const running = ['pending', 'running'].includes(job.status);

  const cancel = async () => {
    if (!confirm('Cancel this job?')) return;
    try {
      await api.post(`/jobs/${id}/cancel`, {});
      load();
      toast('Job cancelled', 'info');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div className="page">
      <div className="toolbar">
        <Link to="/jobs" className="link back-link">← Jobs</Link>
        <span className="page-title">{job.name}</span>
        <Badge status={job.status} />
        <div className="toolbar-right">
          <button className="btn btn-outline" onClick={load}><RefreshCw size={14} /> Refresh</button>
          {running && <button className="btn btn-danger btn-sm" onClick={cancel}>Cancel</button>}
        </div>
      </div>

      <div className="page-panel page-panel-scroll">
        {running && <div className="alert alert-danger">Uninstalling agents via WMI…</div>}

        <div className="progress-block">
          <div className="progress-header">
            <span>Progress</span>
            <span>{job.progress || 0}%</span>
          </div>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${job.progress || 0}%` }} /></div>
        </div>

        <div className="card-grid">
          <div className="card stat-card">
            <div className="stat-label">Success</div>
            <div className="stat-value stat-success">{job.statistics?.success || 0}</div>
          </div>
          <div className="card stat-card">
            <div className="stat-label">Failed</div>
            <div className="stat-value stat-danger">{job.statistics?.failed || 0}</div>
          </div>
          <div className="card stat-card">
            <div className="stat-label">Skipped</div>
            <div className="stat-value">{job.statistics?.skipped || 0}</div>
          </div>
        </div>

        <div className="panel-section-title">Job Log</div>
        <div className="job-log">
          {logs.length === 0 ? <span className="muted">Waiting…</span> : logs.map((log, i) => (
            <div key={i} className={`job-log-line ${logColor(log.level)}`}>
              <span className="log-time-inline">[{new Date(log.timestamp).toLocaleTimeString()}]</span> {log.message}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      </div>
    </div>
  );
}
