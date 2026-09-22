import { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { RefreshCw, Loader2 } from 'lucide-react';
import api from './api';
import { getSocket, onSocket } from './socket';
import { useToast } from './components/Toast';
import { patchJob } from './utils/jobSockets';

function Badge({ status }) {
  const m = { completed: 'badge-online', failed: 'badge-offline', running: 'badge-progress', pending: 'badge-excluded', cancelled: 'badge-excluded' };
  return <span className={`badge ${m[status] || 'badge-excluded'}`}>{status}</span>;
}

const STEP_LABELS = [
  'Detect agent',
  'Stop service',
  'MSI uninstall',
  'Registry cleanup',
  'Directory cleanup',
  'Verify removal',
];

export default function JobPage() {
  const { id } = useParams();
  const [job, setJob] = useState(null);
  const [logs, setLogs] = useState([]);
  const [vmSteps, setVmSteps] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const endRef = useRef(null);
  const toast = useToast();

  const load = () => {
    setLoading(true);
    setLoadError(null);
    Promise.all([api.get(`/jobs/${id}`), api.get(`/jobs/${id}/logs`)])
      .then(([j, l]) => { setJob(j.data); setLogs(l.logs || []); })
      .catch((e) => {
        setLoadError(e.message);
        toast(e.message, 'error');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    getSocket().emit('join:job', id);

    const applyJob = (data) => {
      if (String(data.jobId) !== id) return;
      setJob((prev) => patchJob(prev, data));
    };

    const off1 = onSocket('job:progress', applyJob);
    const off2 = onSocket('job:started', applyJob);
    const off3 = onSocket('job:completed', (d) => {
      if (String(d.jobId) !== id) return;
      const status = d.job?.status || 'completed';
      setJob((prev) => patchJob(prev, { ...d, status, progress: 100 }));
      setVmSteps({});
      toast('Job finished', 'info');
      load();
    });
    const off4 = onSocket('job:cancelled', (d) => {
      if (String(d.jobId) !== id) return;
      setJob((prev) => patchJob(prev, { ...d, status: 'cancelled' }));
      setVmSteps({});
      toast('Job cancelled', 'info');
    });
    const off5 = onSocket('log:new', (d) => {
      if (String(d.jobId) !== id) return;
      setLogs((prev) => [...prev, d.entry].slice(-500));
    });
    const off6 = onSocket('job:vm-step', (d) => {
      if (String(d.jobId) !== id) return;
      setVmSteps((prev) => ({
        ...prev,
        [d.vm]: {
          step: d.step,
          total: d.total,
          label: d.label,
          percent: d.percent ?? Math.round(((d.step - 1) / d.total) * 100),
        },
      }));
    });
    const off7 = onSocket('deployment:endpoint', (d) => {
      if (String(d.jobId) !== id) return;
      setJob((prev) => {
        if (!prev?.endpointResults) return prev;
        const endpointResults = prev.endpointResults.map((row) => (
          String(row.endpointId) === String(d.endpointId) ? { ...row, ...d } : row
        ));
        return { ...prev, endpointResults };
      });
    });

    return () => { off1(); off2(); off3(); off4(); off5(); off6(); off7(); };
  }, [id, toast]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  if (loading && !job) {
    return (
      <div className="page">
        <div className="toolbar">
          <Link to="/jobs" className="link back-link">← Jobs</Link>
          <span className="page-title"><Loader2 className="spin" size={16} strokeWidth={1.5} /> Loading job…</span>
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="page">
        <div className="toolbar">
          <Link to="/jobs" className="link back-link">← Jobs</Link>
          <span className="page-title">Job not found</span>
          <div className="toolbar-right">
            <button className="btn btn-outline" onClick={load}><RefreshCw size={14} /> Retry</button>
          </div>
        </div>
        <div className="empty">{loadError || 'This job does not exist or could not be loaded.'}</div>
      </div>
    );
  }

  const logColor = (l) => ({ error: 'log-msg-error', warning: 'log-msg-warning', success: 'log-msg-success' }[l] || '');
  const running = ['pending', 'running'].includes(job.status);
  const activeSteps = Object.entries(vmSteps);
  const progress = job.progress || 0;

  const retryFailed = async () => {
    try {
      const r = await api.post(`/deployments/${id}/retry-failed`, {});
      const jobId = r.data?._id || r.job?._id;
      toast('Retry job started', 'success');
      if (jobId) window.location.href = `/jobs/${jobId}`;
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const exportReport = () => {
    const rows = job.endpointResults || [];
    const header = ['Endpoint', 'IP', 'Agent', 'Version', 'Status', 'Step', 'DurationMs', 'Message'];
    const lines = [header.join('\t'), ...rows.map((r) => [
      r.name, r.ip, r.agentName, r.agentVersion, r.status, r.step, r.durationMs, (r.message || '').replace(/\t/g, ' '),
    ].join('\t'))];
    const blob = new Blob([lines.join('\n')], { type: 'text/tab-separated-values' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `job-${id}-report.tsv`;
    a.click();
  };

  const cancel = async () => {
    if (!confirm('Cancel this job?')) return;
    try {
      await api.post(`/jobs/${id}/cancel`, {});
      setJob((prev) => ({ ...prev, status: 'cancelled' }));
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
          {job.endpointResults?.some((r) => r.status === 'failed') && (
            <button className="btn btn-outline btn-sm" onClick={retryFailed}>Retry failed</button>
          )}
          {job.endpointResults?.length > 0 && (
            <button className="btn btn-outline btn-sm" onClick={exportReport}>Export report</button>
          )}
          {running && <button className="btn btn-danger btn-sm" onClick={cancel}>Cancel</button>}
        </div>
      </div>

      <div className="page-panel page-panel-scroll">
        {running && (
          <div className="alert alert-danger live-banner">
            <Loader2 className="spin" size={14} />
            <span>Uninstalling agents via WMI — live progress updates</span>
          </div>
        )}

        <div className="progress-block">
          <div className="progress-header">
            <span>Progress</span>
            <span className="progress-pct">{progress}%</span>
          </div>
          <div className="progress-track">
            <div
              className={`progress-fill ${running ? 'progress-fill-live' : ''}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {running && activeSteps.length > 0 && (
          <div className="vm-step-panel">
            <div className="panel-section-title">Active VMs</div>
            {activeSteps.map(([vm, s]) => (
              <div key={vm} className="vm-step-row">
                <div className="vm-step-header">
                  <span className="vm-step-host">{vm}</span>
                  <span className="vm-step-label">Step {s.step}/{s.total}: {s.label || STEP_LABELS[s.step - 1] || 'Working'}</span>
                </div>
                <div className="progress-track progress-track-sm">
                  <div className="progress-fill progress-fill-live" style={{ width: `${s.percent || 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {job.endpointResults?.length > 0 && (
          <div className="deploy-results-wrap">
            <div className="panel-section-title">Endpoint progress</div>
            <table className="agent-table deploy-results-table">
              <thead>
                <tr>
                  <th>Endpoint</th>
                  <th>IP</th>
                  <th>Agent</th>
                  <th>Version</th>
                  <th>Status</th>
                  <th>Step</th>
                  <th>Duration</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {job.endpointResults.map((row) => (
                  <tr key={String(row.endpointId)} className="data-row">
                    <td>{row.name}</td>
                    <td className="mono">{row.ip || '—'}</td>
                    <td>{row.agentName || '—'}</td>
                    <td className="mono">{row.agentVersion || '—'}</td>
                    <td><Badge status={row.status === 'done' ? 'completed' : row.status} /></td>
                    <td>{row.step || '—'}</td>
                    <td>{row.durationMs != null ? `${row.durationMs}ms` : '—'}</td>
                    <td className="col-msg">{row.message || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

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
          <div className="card stat-card">
            <div className="stat-label">Total</div>
            <div className="stat-value">{job.statistics?.total || 0}</div>
          </div>
        </div>

        <div className="panel-section-title">Job Log</div>
        <div className="job-log">
          {logs.length === 0 ? <span className="muted">Waiting…</span> : logs.map((log, i) => (
            <div key={i} className={`job-log-line ${logColor(log.level)}`}>
              <span className="log-time-inline">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
              {log.vm ? <span className="log-vm-tag">[{log.vm}]</span> : null}
              {' '}{log.message}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      </div>
    </div>
  );
}
