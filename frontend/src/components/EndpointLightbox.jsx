import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X, Loader2, RefreshCw, ExternalLink, Power, Trash2, Monitor,
  LayoutDashboard, Cpu, Users, Package, Shield, ScrollText, ClipboardList,
  Server, HardDrive, Wifi, Clock, Tag, CircleDot, CheckCircle2, XCircle, AlertCircle,
} from 'lucide-react';
import api from '../api';
import { onSocket } from '../socket';
import { useToast } from './Toast';
import { resolvePowerState } from '../utils/endpointDisplay';
import { buildCachedTabData, mergeTabData } from '../utils/lightboxCache';
import { useApiQuery } from '../hooks/useApiQuery';
import { launchRemoteDesktop } from '../utils/launchRemoteDesktop';
import { TabErrorBoundary } from './ErrorBoundary';
import { GridSkeleton, TableSkeleton, ListSkeleton } from './ui/TabSkeletons';
import Portal from './Portal';
import RemoteDesktopModal from './RemoteDesktopModal';

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'system', label: 'System', icon: Cpu },
  { id: 'local-users', label: 'Local Users', icon: Users },
  { id: 'software', label: 'Software', icon: Package },
  { id: 'rscd', label: 'RSCD / Agents', icon: Shield },
  { id: 'power', label: 'Power', icon: Power },
  { id: 'logs', label: 'Logs', icon: ScrollText },
  { id: 'console', label: 'Console', icon: Monitor },
  { id: 'audit', label: 'Audit', icon: ClipboardList },
];

const POWER_ACTIONS = [
  { id: 'power_off_graceful', label: 'Power Off (graceful)' },
  { id: 'power_off_force', label: 'Power Off (force)' },
  { id: 'restart_graceful', label: 'Restart (graceful)' },
  { id: 'restart_force', label: 'Restart (force)' },
  { id: 'reset', label: 'Reset' },
  { id: 'graceful_shutdown', label: 'Graceful Shutdown' },
];

function InfoCard({ icon: Icon, label, value, children }) {
  return (
    <div className="lb-info-card">
      <div className="lb-info-icon"><Icon size={18} strokeWidth={1.5} /></div>
      <div className="lb-info-body">
        <div className="lb-info-label">{label}</div>
        <div className="lb-info-value">{children ?? (value ?? '—')}</div>
      </div>
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    healthy: { cls: 'badge-online', icon: CheckCircle2 },
    online: { cls: 'badge-online', icon: CheckCircle2 },
    active: { cls: 'badge-online', icon: CheckCircle2 },
    on: { cls: 'badge-online', icon: CircleDot },
    off: { cls: 'badge-offline', icon: CircleDot },
    removed: { cls: 'badge-excluded', icon: XCircle },
    inactive: { cls: 'badge-offline', icon: AlertCircle },
    unknown: { cls: 'badge-excluded', icon: AlertCircle },
  };
  const key = String(status || 'unknown').toLowerCase();
  const cfg = map[key] || { cls: 'badge-excluded', icon: AlertCircle };
  const Icon = cfg.icon;
  return (
    <span className={`badge ${cfg.cls} lb-status-pill`}>
      <Icon size={12} strokeWidth={1.5} /> {status}
    </span>
  );
}

function Empty({ icon: Icon = AlertCircle, text }) {
  return (
    <div className="lightbox-empty">
      <Icon size={28} strokeWidth={1.5} className="lb-empty-icon" />
      <p>{text}</p>
    </div>
  );
}

function TabOverview({ data }) {
  if (!data) return <Empty text="No overview data available." />;
  return (
    <div className="lb-card-grid">
      <InfoCard icon={Server} label="Hostname" value={data.hostname} />
      <InfoCard icon={Wifi} label="IP Address" value={data.ip || '—'} />
      <InfoCard icon={Monitor} label="Operating System" value={data.os} />
      <InfoCard icon={Tag} label="OS Version" value={data.osVersion || '—'} />
      <InfoCard icon={HardDrive} label="Model" value={data.model || '—'} />
      <InfoCard icon={Tag} label="Service Tag" value={data.serviceTag || '—'} />
      <InfoCard icon={Clock} label="Last Seen" value={data.lastSeen ? new Date(data.lastSeen).toLocaleString() : '—'} />
      <InfoCard icon={Clock} label="Last Boot" value={data.lastBoot ? new Date(data.lastBoot).toLocaleString() : '—'} />
      <InfoCard icon={CircleDot} label="Connectivity" value={<StatusPill status={data.connectivity || data.health} />} />
      <InfoCard icon={Power} label="Power State" value={<StatusPill status={data.powerState} />} />
      <InfoCard icon={Shield} label="Agent Version" value={data.agentVersion || '—'} />
    </div>
  );
}

function TabSystem({ data, refreshing, stale }) {
  const hasDetail = data?.cpu || data?.ramGb || data?.disks?.length;
  return (
    <div className="lb-section">
      {stale && !hasDetail && (
        <div className="lb-refresh-hint lb-refresh-muted">Showing inventory snapshot — host offline or WMI unreachable.</div>
      )}
      {refreshing && (
        <div className="lb-refresh-hint"><Loader2 className="spin" size={14} strokeWidth={1.5} /> Refreshing live system data…</div>
      )}
      <div className="lb-card-grid">
        <InfoCard icon={Cpu} label="CPU" value={data?.cpu || '—'} />
        <InfoCard icon={Cpu} label="CPU Cores" value={data?.cores || '—'} />
        <InfoCard icon={Server} label="RAM" value={data?.ramGb ? `${data.ramGb} GB` : '—'} />
        <InfoCard icon={HardDrive} label="Model" value={data?.model || '—'} />
        <InfoCard icon={Tag} label="OS Version" value={data?.osVersion || '—'} />
      </div>
      <div className="lb-detail-block">
        <div className="lb-detail-title"><HardDrive size={16} strokeWidth={1.5} /> Storage</div>
        {data?.disks?.length
          ? data.disks.map((d, i) => <div key={i} className="lb-detail-line">{d}</div>)
          : <div className="lb-detail-muted">No disk data — endpoint may be offline</div>}
      </div>
      <div className="lb-detail-block">
        <div className="lb-detail-title"><Wifi size={16} strokeWidth={1.5} /> Network Interfaces</div>
        {data?.networkInterfaces?.length
          ? data.networkInterfaces.map((n, i) => <div key={i} className="lb-detail-line">{n}</div>)
          : <div className="lb-detail-muted">No network data available</div>}
      </div>
    </div>
  );
}

function TabLocalUsers({ data, refreshing }) {
  const users = data?.users || [];
  return (
    <div className="lb-section">
      <div className="lb-summary-row">
        <InfoCard icon={Users} label="Provisioned" value={`${data?.present ?? 0} / ${data?.required ?? 3}`} />
        {data?.checkedAt && (
          <InfoCard icon={Clock} label="Last Checked" value={new Date(data.checkedAt).toLocaleString()} />
        )}
      </div>
      {refreshing && (
        <div className="lb-refresh-hint"><Loader2 className="spin" size={14} strokeWidth={1.5} /> Refreshing local users…</div>
      )}
      {users.length ? (
        <table className="lightbox-table">
          <thead><tr><th>User</th><th>Status</th><th>Enabled</th><th>Groups</th><th>Last Login</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.name}>
                <td>{u.name}</td>
                <td><StatusPill status={u.present ? 'active' : 'inactive'} /></td>
                <td>{u.present ? (u.enabled ? 'Yes' : 'No') : '—'}</td>
                <td>{u.groups?.length ? u.groups.join(', ') : '—'}</td>
                <td>{u.lastLogin ? new Date(u.lastLogin).toLocaleString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty icon={Users} text="No local user details yet — use Sync now or Refresh to probe this host." />
      )}
    </div>
  );
}

function TabSoftware({ data, refreshing }) {
  const programs = data?.programs || [];
  return (
    <div className="lb-section">
      {refreshing && (
        <div className="lb-refresh-hint"><Loader2 className="spin" size={14} strokeWidth={1.5} /> Refreshing installed software…</div>
      )}
      {programs.length ? (
        <table className="lightbox-table">
          <thead><tr><th>Program</th><th>Version</th></tr></thead>
          <tbody>
            {programs.map((p) => (
              <tr key={`${p.name}-${p.version}`}><td>{p.name}</td><td>{p.version || '—'}</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty icon={Package} text="No installed software listed — endpoint may be offline or not yet synced." />
      )}
    </div>
  );
}

function TabRscd({ vm, data, onUninstall, uninstalling, uninstallJobId, uninstallProgress }) {
  const removed = data?.agentStatus === 'removed' || vm?.version === 'removed';
  const active = data?.agentStatus === 'active' || vm?.status === 'online' || vm?.rscdStatus === 'installed';
  return (
    <div className="lb-section">
      <div className="lb-card-grid">
        <InfoCard icon={Shield} label="Agent Status" value={<StatusPill status={removed ? 'removed' : (active ? 'active' : 'inactive')} />} />
        <InfoCard icon={Tag} label="Agent Version" value={data?.agentVersion || '—'} />
        <InfoCard icon={Server} label="Service" value={data?.serviceInstalled ? 'Installed' : 'Not installed'} />
        <InfoCard icon={CircleDot} label="Service State" value={data?.serviceStatus || '—'} />
      </div>
      <div className="lb-detail-block">
        <div className="lb-detail-title"><Package size={16} strokeWidth={1.5} /> Install Paths</div>
        {data?.installPaths?.length
          ? data.installPaths.map((p, i) => <div key={i} className="lb-detail-line mono">{p}</div>)
          : <div className="lb-detail-muted">No install path recorded</div>}
      </div>
      {data?.productCodes?.length > 0 && (
        <div className="lb-detail-block">
          <div className="lb-detail-title"><Tag size={16} strokeWidth={1.5} /> Product Codes</div>
          <div className="lb-detail-line mono">{data.productCodes.join(', ')}</div>
        </div>
      )}
      <div className="lb-action-bar">
        <button
          type="button"
          className="btn btn-danger"
          disabled={vm.excluded || uninstalling}
          onClick={onUninstall}
        >
          {uninstalling ? <Loader2 className="spin" size={16} strokeWidth={1.5} /> : <Trash2 size={16} strokeWidth={1.5} />}
          {uninstalling ? 'Uninstalling…' : 'Uninstall RSCD Agent'}
        </button>
        {removed && <span className="lb-detail-muted">DB shows removed — you can still run cleanup/uninstall again.</span>}
        {vm.excluded && <span className="lb-detail-muted">Excluded endpoints cannot be uninstalled.</span>}
      </div>
      {uninstallJobId && (
        <div className="lb-uninstall-progress">
          <div className="lb-detail-title"><Trash2 size={16} strokeWidth={1.5} /> Uninstall Progress</div>
          <div className="progress-bar-wrap">
            <div className="progress-bar-fill" style={{ width: `${uninstallProgress}%` }} />
          </div>
          <div className="lb-detail-muted">{uninstallProgress}% — view full log in Jobs</div>
        </div>
      )}
    </div>
  );
}

function TabPower({ vm, data, onPower, powerPending }) {
  const [password, setPassword] = useState('');
  const [confirmAction, setConfirmAction] = useState(null);
  const state = data?.state || resolvePowerState(vm);
  const confirm = () => {
    if (!password) return;
    onPower(confirmAction, password);
    setConfirmAction(null);
    setPassword('');
  };
  return (
    <div className="lb-section">
      <InfoCard icon={Power} label="Current Power State" value={<StatusPill status={state} />} />
      <InfoCard icon={Users} label="Operations Account" value="RDSROOT (fixed)" />
      <label className="field">
        <span>Operations Password (required)</span>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter operations password" autoComplete="off" />
      </label>
      <div className="power-actions-grid">
        {POWER_ACTIONS.map((a) => (
          <button key={a.id} type="button" className="btn btn-outline btn-sm" disabled={!!powerPending || !password} onClick={() => setConfirmAction(a.id)}>
            {powerPending === a.id ? <Loader2 className="spin" size={14} strokeWidth={1.5} /> : <Power size={14} strokeWidth={1.5} />}
            {a.label}
          </button>
        ))}
      </div>
      {confirmAction && (
        <div className="lightbox-confirm">
          <p>Confirm <strong>{POWER_ACTIONS.find((a) => a.id === confirmAction)?.label}</strong> on <strong>{vm.name}</strong>?</p>
          <div className="lightbox-confirm-actions">
            <button type="button" className="btn btn-danger btn-sm" onClick={confirm}>Confirm</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setConfirmAction(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function TabLogs({ data, liveLogs }) {
  const logs = [...(liveLogs || []), ...(Array.isArray(data) ? data : [])];
  if (!logs.length) return <Empty icon={ScrollText} text="No log entries for this endpoint yet." />;
  return (
    <div className="lightbox-log-stream">
      {logs.slice(0, 300).map((log, i) => (
        <div key={log._id || i} className={`job-log-line log-msg-${log.level || 'info'}`}>
          <span className="log-time-inline">[{new Date(log.timestamp).toLocaleString()}]</span>
          {log.action ? <span className="log-vm-tag">[{log.action}]</span> : null}
          {log.status ? <span className="log-vm-tag">({log.status})</span> : null}
          {log.durationMs != null ? <span className="muted"> {log.durationMs}ms</span> : null}
          {' '}{log.message}
        </div>
      ))}
    </div>
  );
}

function TabConsole({ data }) {
  if (!data?.supported) return <Empty icon={Monitor} text="Console launch is not available for this endpoint." />;
  return (
    <div className="lb-section">
      <InfoCard icon={Monitor} label="Protocol" value={data.protocol?.toUpperCase()} />
      <InfoCard icon={ExternalLink} label="Instructions" value={data.instructions} />
      {data.url && (
        <a className="btn btn-primary" href={data.url} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={14} strokeWidth={1.5} /> Launch Remote Desktop
        </a>
      )}
    </div>
  );
}

export function PowerBadge({ vm, state }) {
  const s = state || resolvePowerState(vm) || 'unknown';
  const cls = { on: 'badge-online', off: 'badge-offline', unknown: 'badge-excluded' }[s] || 'badge-excluded';
  return <span className={`badge ${cls}`}>{s}</span>;
}

export function RscdAgentBadge({ vm }) {
  const label = vm?.excluded ? 'excluded' : (vm?.status === 'in_progress' ? 'checking' : (
    vm?.agentStatus === 'active' && vm?.version !== 'removed' ? 'active' : 'inactive'
  ));
  const cls = label === 'active' ? 'badge-online' : label === 'checking' ? 'badge-progress' : label === 'excluded' ? 'badge-excluded' : 'badge-offline';
  return <span className={`badge ${cls}`}>{label}</span>;
}

export default function EndpointLightbox({ vm, initialTab = 'overview', onClose, onVmUpdated }) {
  const [tab, setTab] = useState(initialTab);
  const [liveLogs, setLiveLogs] = useState([]);
  const [powerPending, setPowerPending] = useState(null);
  const [uninstalling, setUninstalling] = useState(false);
  const [uninstallJobId, setUninstallJobId] = useState(null);
  const [uninstallProgress, setUninstallProgress] = useState(0);
  const [rdpSession, setRdpSession] = useState(null);
  const dialogRef = useRef(null);
  const toast = useToast();
  const nav = useNavigate();
  const cachedData = useMemo(() => buildCachedTabData(vm, tab), [vm, tab]);
  const vmOnline = vm?.status === 'online' || vm?.connectivityState === 'online';

  const tabQuery = useApiQuery(
    async ({ timeout, signal }) => {
      const r = await api.get(`/vms/${vm._id}/detail/${tab}`, { timeout, signal });
      return r.data;
    },
    [vm?._id, tab],
    {
      timeout: 25000,
      retries: 1,
      enabled: !!vm?._id,
      initialData: cachedData,
    },
  );

  useEffect(() => {
    document.body.classList.add('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, []);

  useEffect(() => {
    if (!vm?._id) return;
    setTab(initialTab);
    setLiveLogs([]);
    setUninstallJobId(null);
    setUninstallProgress(0);
    setUninstalling(false);
  }, [vm?._id, initialTab]);

  useEffect(() => {
    if (!vm?._id) return;
    const off = onSocket('audit:vm-log', (d) => {
      if (String(d.vmId) === String(vm._id)) {
        setLiveLogs((prev) => [d.entry, ...prev].slice(0, 200));
      }
    });
    return off;
  }, [vm?._id]);

  useEffect(() => {
    if (!uninstallJobId) return;
    const jobId = String(uninstallJobId);
    const onProgress = (d) => {
      if (String(d.jobId) !== jobId) return;
      setUninstallProgress(d.progress ?? 0);
    };
    const onDone = (d) => {
      if (String(d.jobId) !== jobId) return;
      setUninstalling(false);
      setUninstallProgress(100);
      toast(d.job?.status === 'failed' ? 'Uninstall failed — see job log' : 'Uninstall completed', d.job?.status === 'failed' ? 'error' : 'success');
      onVmUpdated?.();
      tabQuery.reload();
    };
    const off1 = onSocket('job:progress', onProgress);
    const off2 = onSocket('job:completed', onDone);
    const off3 = onSocket('job:started', onProgress);
    return () => { off1(); off2(); off3(); };
  }, [uninstallJobId, toast, onVmUpdated, tabQuery.reload]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handlePower = async (action, password) => {
    setPowerPending(action);
    try {
      await api.post(`/vms/${vm._id}/power`, { action, password });
      toast(`Power action sent: ${action}`, 'success');
      tabQuery.reload();
      onVmUpdated?.();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setPowerPending(null);
    }
  };

  const handleUninstall = async () => {
    if (!confirm(`Permanently uninstall the RSCD agent on ${vm.name}?\n\nThis will stop services, remove from Programs & Features, clean registry and directories.`)) return;
    setUninstalling(true);
    setUninstallProgress(0);
    try {
      const r = await api.post('/endpoints/bulk-uninstall-rscd', {
        endpointIds: [vm._id],
        name: `Uninstall — ${vm.name}`,
      });
      const job = r.data || r.job;
      const jobId = job?._id || job?.id;
      if (jobId) {
        setUninstallJobId(jobId);
        toast('Uninstall job started', 'info');
      } else {
        setUninstalling(false);
        toast('Uninstall started', 'info');
      }
    } catch (e) {
      setUninstalling(false);
      toast(e.message, 'error');
    }
  };

  if (!vm) return null;

  const displayData = mergeTabData(vm, tab, tabQuery.data) ?? cachedData;
  const refreshing = tabQuery.isLoading && tabQuery.data != null && vmOnline;

  const renderTab = () => {
    if (tabQuery.isError && !displayData) {
      return (
        <TabErrorBoundary error={tabQuery.error} onRetry={tabQuery.reload} />
      );
    }

    const skeleton = tabQuery.isLoading && !displayData;
    if (skeleton) {
      if (['local-users', 'software', 'audit', 'logs'].includes(tab)) return <TableSkeleton />;
      if (tab === 'system') return <GridSkeleton rows={4} />;
      return <GridSkeleton />;
    }

    switch (tab) {
      case 'overview': return <TabOverview data={displayData} />;
      case 'system': return <TabSystem data={displayData} refreshing={refreshing} stale={displayData?.source === 'inventory' || displayData?.offline} />;
      case 'local-users': return <TabLocalUsers data={displayData} refreshing={refreshing} />;
      case 'software': return <TabSoftware data={displayData} refreshing={refreshing} />;
      case 'rscd': return (
        <TabRscd
          vm={vm}
          data={displayData}
          onUninstall={handleUninstall}
          uninstalling={uninstalling}
          uninstallJobId={uninstallJobId}
          uninstallProgress={uninstallProgress}
        />
      );
      case 'power': return <TabPower vm={vm} data={displayData} onPower={handlePower} powerPending={powerPending} />;
      case 'logs': return skeleton ? <ListSkeleton /> : <TabLogs data={displayData} liveLogs={liveLogs} />;
      case 'audit': return skeleton ? <ListSkeleton /> : <TabLogs data={displayData} liveLogs={liveLogs} />;
      case 'console': return <TabConsole data={displayData} />;
      default: return <Empty text="Unknown tab" />;
    }
  };

  return (
    <Portal>
    <div className="lightbox-backdrop" onClick={onClose} role="presentation">
      <div
        className="lightbox"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lightbox-title"
        onClick={(e) => e.stopPropagation()}
        ref={dialogRef}
        tabIndex={-1}
      >
        <header className="lightbox-header">
          <div>
            <h2 id="lightbox-title" className="lightbox-title">{vm.name}</h2>
            <p className="lightbox-sub">{vm.fqdn || vm.ip || 'Windows endpoint'}</p>
          </div>
          <div className="lightbox-header-actions">
            {refreshing && <Loader2 className="spin" size={14} strokeWidth={1.5} aria-label="Refreshing" />}
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => launchRemoteDesktop(vm._id, toast, {
                vmName: vm.name,
                onEmbed: (session) => setRdpSession(session),
              })}
            >
              <Monitor size={14} strokeWidth={1.5} /> Remote Desktop
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => tabQuery.reload(true)}><RefreshCw size={14} strokeWidth={1.5} /> Refresh</button>
            {uninstallJobId && (
              <button type="button" className="btn btn-outline btn-sm" onClick={() => nav(`/jobs/${uninstallJobId}`)}>View Job</button>
            )}
            <button type="button" className="btn btn-outline btn-sm" onClick={onClose} aria-label="Close"><X size={16} strokeWidth={1.5} /></button>
          </div>
        </header>
        <nav className="lightbox-tabs" role="tablist">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`lightbox-tab ${tab === t.id ? 'active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                <Icon size={15} strokeWidth={1.5} />
                {t.label}
              </button>
            );
          })}
        </nav>
        <div className="lightbox-body" role="tabpanel">
          {renderTab()}
        </div>
      </div>
    </div>
    {rdpSession && (
      <RemoteDesktopModal session={rdpSession} onClose={() => setRdpSession(null)} />
    )}
    </Portal>
  );
}
