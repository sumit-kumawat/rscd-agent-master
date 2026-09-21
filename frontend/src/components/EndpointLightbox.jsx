import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Loader2, RefreshCw, ExternalLink, Power, MoreVertical } from 'lucide-react';
import api from '../api';
import { onSocket } from '../socket';
import { useToast } from './Toast';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'system', label: 'System' },
  { id: 'local-users', label: 'Local Users' },
  { id: 'software', label: 'Installed Software' },
  { id: 'rscd', label: 'RSCD / Agents' },
  { id: 'power', label: 'Power' },
  { id: 'logs', label: 'Logs' },
  { id: 'console', label: 'Console' },
  { id: 'audit', label: 'Audit' },
];

const POWER_ACTIONS = [
  { id: 'power_on', label: 'Power On' },
  { id: 'power_off_graceful', label: 'Power Off (graceful)' },
  { id: 'power_off_force', label: 'Power Off (force)' },
  { id: 'restart_graceful', label: 'Restart (graceful)' },
  { id: 'restart_force', label: 'Restart (force)' },
  { id: 'reset', label: 'Reset' },
  { id: 'power_cycle', label: 'Power Cycle' },
  { id: 'graceful_shutdown', label: 'Graceful Shutdown' },
  { id: 'wake_on_lan', label: 'Wake-on-LAN' },
];

function Skeleton() {
  return <div className="lightbox-skeleton"><Loader2 className="spin" size={20} /> Loading…</div>;
}

function Empty({ text }) {
  return <div className="lightbox-empty">{text}</div>;
}

function Field({ label, value }) {
  return (
    <div className="lightbox-field">
      <div className="lightbox-field-label">{label}</div>
      <div className="lightbox-field-value">{value ?? '—'}</div>
    </div>
  );
}

function TabOverview({ data }) {
  if (!data) return <Skeleton />;
  return (
    <div className="lightbox-grid">
      <Field label="Hostname" value={data.hostname} />
      <Field label="IP Address" value={data.ip || '—'} />
      <Field label="Operating System" value={data.os} />
      <Field label="OS Version" value={data.osVersion || '—'} />
      <Field label="Model" value={data.model || '—'} />
      <Field label="Service Tag" value={data.serviceTag || '—'} />
      <Field label="Last Seen" value={data.lastSeen ? new Date(data.lastSeen).toLocaleString() : '—'} />
      <Field label="Last Boot" value={data.lastBoot ? new Date(data.lastBoot).toLocaleString() : '—'} />
      <Field label="Health" value={data.health} />
      <Field label="Power State" value={data.powerState} />
    </div>
  );
}

function TabSystem({ data }) {
  if (!data) return <Skeleton />;
  if (!data.cpu && !data.ramGb) return <Empty text="System information unavailable — endpoint may be offline." />;
  return (
    <div className="lightbox-section">
      <Field label="CPU" value={data.cpu} />
      <Field label="CPU Cores" value={data.cores} />
      <Field label="RAM" value={data.ramGb ? `${data.ramGb} GB` : '—'} />
      <div className="lightbox-field">
        <div className="lightbox-field-label">Storage</div>
        {data.disks?.length ? data.disks.map((d, i) => <div key={i} className="lightbox-field-value">{d}</div>) : <div className="lightbox-field-value">—</div>}
      </div>
      <div className="lightbox-field">
        <div className="lightbox-field-label">Network Interfaces</div>
        {data.networkInterfaces?.length ? data.networkInterfaces.map((n, i) => <div key={i} className="lightbox-field-value">{n}</div>) : <div className="lightbox-field-value">—</div>}
      </div>
    </div>
  );
}

function TabLocalUsers({ data }) {
  if (!data) return <Skeleton />;
  if (!data.users?.length) return <Empty text="No local user data — endpoint unreachable or not yet probed." />;
  return (
    <table className="lightbox-table">
      <thead><tr><th>User</th><th>Status</th><th>Enabled</th><th>Groups</th><th>Last Login</th></tr></thead>
      <tbody>
        {data.users.map((u) => (
          <tr key={u.name}>
            <td>{u.name}</td>
            <td><span className={`badge ${u.present ? 'badge-online' : 'badge-offline'}`}>{u.present ? 'present' : 'missing'}</span></td>
            <td>{u.present ? (u.enabled ? 'Yes' : 'No') : '—'}</td>
            <td>{u.groups?.length ? u.groups.join(', ') : '—'}</td>
            <td>{u.lastLogin ? new Date(u.lastLogin).toLocaleString() : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TabSoftware({ data }) {
  if (!data) return <Skeleton />;
  if (!data.programs?.length) return <Empty text="No installed software found or endpoint unreachable." />;
  return (
    <table className="lightbox-table">
      <thead><tr><th>Program</th><th>Version</th></tr></thead>
      <tbody>
        {data.programs.map((p) => (
          <tr key={`${p.name}-${p.version}`}><td>{p.name}</td><td>{p.version || '—'}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

function TabRscd({ data }) {
  if (!data) return <Skeleton />;
  return (
    <div className="lightbox-section">
      <Field label="Service Installed" value={data.serviceInstalled ? 'Yes' : 'No'} />
      <Field label="Service Status" value={data.serviceStatus || '—'} />
      <Field label="Agent Status" value={data.agentStatus || '—'} />
      <Field label="Agent Version" value={data.agentVersion || '—'} />
      <div className="lightbox-field">
        <div className="lightbox-field-label">Product Codes</div>
        <div className="lightbox-field-value">{data.productCodes?.length ? data.productCodes.join(', ') : '—'}</div>
      </div>
      <div className="lightbox-field">
        <div className="lightbox-field-label">Programs</div>
        {data.programs?.length ? data.programs.map((p, i) => <div key={i} className="lightbox-field-value">{p}</div>) : <div className="lightbox-field-value">—</div>}
      </div>
      <div className="lightbox-field">
        <div className="lightbox-field-label">Install Paths</div>
        {data.installPaths?.length ? data.installPaths.map((p, i) => <div key={i} className="lightbox-field-value">{p}</div>) : <div className="lightbox-field-value">—</div>}
      </div>
    </div>
  );
}

function TabPower({ vm, data, onPower, powerPending }) {
  const [password, setPassword] = useState('');
  const [confirmAction, setConfirmAction] = useState(null);
  if (!data) return <Skeleton />;
  const run = (action) => {
    setConfirmAction(action);
  };
  const confirm = () => {
    if (!password) return;
    onPower(confirmAction, password);
    setConfirmAction(null);
    setPassword('');
  };
  return (
    <div className="lightbox-section">
      <Field label="Current Power State" value={data.state || vm.powerState || 'unknown'} />
      <Field label="Operations Account" value="RDSROOT (fixed)" />
      <label className="field">
        <span>Operations Password (required)</span>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter operations password" autoComplete="off" />
      </label>
      <div className="power-actions-grid">
        {POWER_ACTIONS.map((a) => (
          <button key={a.id} className="btn btn-outline btn-sm" disabled={!!powerPending || !password} onClick={() => run(a.id)}>
            {powerPending === a.id ? <Loader2 className="spin" size={14} /> : <Power size={14} />}
            {a.label}
          </button>
        ))}
      </div>
      {confirmAction && (
        <div className="lightbox-confirm">
          <p>Confirm <strong>{POWER_ACTIONS.find((a) => a.id === confirmAction)?.label}</strong> on <strong>{vm.name}</strong>?</p>
          <div className="lightbox-confirm-actions">
            <button className="btn btn-danger btn-sm" onClick={confirm}>Confirm</button>
            <button className="btn btn-outline btn-sm" onClick={() => setConfirmAction(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function TabLogs({ data, liveLogs }) {
  const logs = [...(liveLogs || []), ...(data || [])];
  if (!logs.length) return <Empty text="No log entries for this endpoint yet." />;
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
  if (!data) return <Skeleton />;
  if (!data.supported) return <Empty text="Console launch is not available for this endpoint." />;
  return (
    <div className="lightbox-section">
      <Field label="Protocol" value={data.protocol?.toUpperCase()} />
      <Field label="Instructions" value={data.instructions} />
      {data.url && (
        <a className="btn btn-primary" href={data.url} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={14} /> Launch Remote Desktop
        </a>
      )}
    </div>
  );
}

export function LocalUsersCell({ vm, onOpen }) {
  const lu = vm.localUsers || {};
  const required = lu.required || 3;
  const present = lu.present ?? 0;
  const unreachable = ['offline', 'unreachable', 'timeout', 'unknown'].includes(vm.connectivityState || vm.status);
  const tone = unreachable && present === 0 ? 'red' : present >= required ? 'green' : present > 0 ? 'amber' : 'red';
  const users = lu.users || [];
  const presentNames = users.filter((u) => u.present).map((u) => u.name);
  const missingNames = users.filter((u) => !u.present).map((u) => u.name);
  const tooltip = users.length
    ? `Present: ${presentNames.join(', ') || 'none'}\nMissing: ${missingNames.join(', ') || 'none'}`
    : 'Not yet probed — open endpoint for details';

  return (
    <div className="local-users-cell" onClick={(e) => { e.stopPropagation(); onOpen(vm, 'local-users'); }}>
      <span className={`local-users-count local-users-${tone}`} title={tooltip}>
        {unreachable && present === 0 ? '—' : `${present} / ${required}`}
      </span>
      <button type="button" className="row-menu-trigger lightbox-open-btn" aria-label="Open endpoint" onClick={(e) => { e.stopPropagation(); onOpen(vm); }}>
        <MoreVertical size={16} />
      </button>
    </div>
  );
}

export function PowerBadge({ state }) {
  const s = state || 'unknown';
  const cls = { on: 'badge-online', off: 'badge-offline', unknown: 'badge-excluded' }[s] || 'badge-excluded';
  return <span className={`badge ${cls}`}>{s}</span>;
}

export default function EndpointLightbox({ vm, initialTab = 'overview', onClose, onVmUpdated }) {
  const [tab, setTab] = useState(initialTab);
  const [tabData, setTabData] = useState({});
  const [tabLoading, setTabLoading] = useState({});
  const [liveLogs, setLiveLogs] = useState([]);
  const [powerPending, setPowerPending] = useState(null);
  const dialogRef = useRef(null);
  const toast = useToast();

  const loadTab = useCallback(async (tabId) => {
    if (!vm?._id) return;
    setTabLoading((t) => ({ ...t, [tabId]: true }));
    try {
      const r = await api.get(`/vms/${vm._id}/detail/${tabId}`);
      setTabData((d) => ({ ...d, [tabId]: r.data }));
    } catch (e) {
      toast(e.message, 'error');
      setTabData((d) => ({ ...d, [tabId]: null }));
    } finally {
      setTabLoading((t) => ({ ...t, [tabId]: false }));
    }
  }, [vm?._id, toast]);

  useEffect(() => {
    if (!vm) return;
    setTab(initialTab);
    setTabData({});
    setLiveLogs([]);
    loadTab(initialTab);
  }, [vm?._id, initialTab]);

  useEffect(() => {
    if (!vm) return;
    loadTab(tab);
  }, [tab, vm?._id]);

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
      loadTab('power');
      onVmUpdated?.();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setPowerPending(null);
    }
  };

  if (!vm) return null;

  const renderTab = () => {
    if (tabLoading[tab]) return <Skeleton />;
    const data = tabData[tab];
    switch (tab) {
      case 'overview': return <TabOverview data={data} />;
      case 'system': return <TabSystem data={data} />;
      case 'local-users': return <TabLocalUsers data={data} />;
      case 'software': return <TabSoftware data={data} />;
      case 'rscd': return <TabRscd data={data} />;
      case 'power': return <TabPower vm={vm} data={data} onPower={handlePower} powerPending={powerPending} />;
      case 'logs': return <TabLogs data={data} liveLogs={liveLogs} />;
      case 'audit': return <TabLogs data={data} liveLogs={liveLogs} />;
      case 'console': return <TabConsole data={data} />;
      default: return <Empty text="Unknown tab" />;
    }
  };

  return (
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
            <button className="btn btn-outline btn-sm" onClick={() => loadTab(tab)}><RefreshCw size={14} /> Refresh tab</button>
            <button className="btn btn-outline btn-sm" onClick={onClose} aria-label="Close"><X size={16} /></button>
          </div>
        </header>
        <nav className="lightbox-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`lightbox-tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="lightbox-body" role="tabpanel">
          {renderTab()}
        </div>
      </div>
    </div>
  );
}
