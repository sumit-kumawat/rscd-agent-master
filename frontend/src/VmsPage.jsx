import { useEffect, useState, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  RefreshCw, Plus, Upload, Search, Trash2, Pencil, Unplug, Activity, Loader2, ShieldCheck, ShieldAlert,
} from 'lucide-react';
import api from './api';
import { onSocket } from './socket';
import { useToast } from './components/Toast';
import { useSearch } from './context/SearchContext';
import { useRefresh } from './context/RefreshContext';
import RowActionsMenu from './components/RowActionsMenu';

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function displayIp(ip) {
  const v = String(ip || '').trim();
  return IPV4.test(v) ? v : '—';
}

function isRemoved(vm) {
  return vm.agentStatus === 'removed' || vm.version === 'removed';
}

const CONNECTIVITY_LABELS = {
  online: 'online',
  auth_failed: 'auth failed',
  timeout: 'timeout',
  unreachable: 'unreachable',
  relay_unavailable: 'relay down',
  wmi_unavailable: 'wmi unavailable',
  permission_denied: 'denied',
  dns_failed: 'dns failed',
  offline: 'offline',
  unknown: 'unknown',
};

function connectivityLabel(vm) {
  if (vm.excluded) return 'excluded';
  if (vm.connectivityState && CONNECTIVITY_LABELS[vm.connectivityState]) {
    return CONNECTIVITY_LABELS[vm.connectivityState];
  }
  return vm.status === 'online' ? 'online' : 'offline';
}

const emptyForm = () => ({
  name: '', ip: '', fqdn: '', installRoot: '', site: '', excluded: false,
  wmiDomain: '', wmiUsername: '', wmiPassword: '',
});

function VmModal({ vm, onClose, onSaved, onChecking }) {
  const isNew = !vm;
  const toast = useToast();
  const [form, setForm] = useState(vm ? {
    name: vm.name || '', ip: displayIp(vm.ip) === '—' ? '' : vm.ip,
    fqdn: vm.fqdn || '', installRoot: vm.installRoot || '',
    site: vm.site || '', excluded: !!vm.excluded,
    wmiDomain: vm.wmiDomain || '', wmiUsername: vm.wmiUsername || '', wmiPassword: '',
  } : emptyForm());
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name.trim()) {
      toast('Hostname is required', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form, ip: form.ip.trim() };
      if (!payload.wmiPassword) delete payload.wmiPassword;
      if (isNew) {
        const r = await api.post('/vms', payload);
        toast('VM added — checking status…', 'info');
        onSaved(r.data, true);
        if (r.data?._id) onChecking?.(r.data._id);
      } else {
        await api.put(`/vms/${vm._id}`, payload);
        toast('VM updated', 'success');
        onSaved();
      }
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 14px', fontSize: 16 }}>{isNew ? 'Add VM' : 'Edit VM'}</h3>
        <label className="field"><span>Hostname / FQDN</span>
          <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="ome or ome.corp.helixops.ai" /></label>
        <label className="field"><span>IP Address (optional — discovered via WMI on Check)</span>
          <input className="input" value={form.ip} onChange={(e) => set('ip', e.target.value)} placeholder="Auto-discovered" /></label>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={form.excluded} onChange={(e) => set('excluded', e.target.checked)} />
          <span>Excluded from jobs</span>
        </label>
        <details style={{ marginBottom: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--muted)' }}>WMI credentials (optional override)</summary>
          <label className="field" style={{ marginTop: 10 }}><span>Domain</span>
            <input className="input" value={form.wmiDomain} onChange={(e) => set('wmiDomain', e.target.value)} placeholder="e.g. BMC or CORP" /></label>
          <label className="field"><span>Username</span>
            <input className="input" value={form.wmiUsername} onChange={(e) => set('wmiUsername', e.target.value)} placeholder="e.g. rdsroot (blank = first RSCD_OS_USERS entry)" /></label>
          <label className="field"><span>Password</span>
            <input className="input" type="password" value={form.wmiPassword} onChange={(e) => set('wmiPassword', e.target.value)} placeholder={vm?.wmiUsername ? '••••••••' : ''} /></label>
        </details>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

function ConnBadge({ vm, isChecking }) {
  if (isChecking) {
    return (
      <span className="badge badge-checking" title="Checking status…">
        <Loader2 className="spin" size={12} />
        <span>Checking…</span>
      </span>
    );
  }
  const label = connectivityLabel(vm);
  const state = vm.connectivityState || (vm.status === 'online' ? 'online' : 'offline');
  const cls = {
    online: 'badge-online',
    offline: 'badge-offline',
    excluded: 'badge-excluded',
    auth_failed: 'badge-offline',
    timeout: 'badge-offline',
    unreachable: 'badge-offline',
    relay_unavailable: 'badge-offline',
    wmi_unavailable: 'badge-offline',
    permission_denied: 'badge-offline',
    dns_failed: 'badge-offline',
    unknown: 'badge-offline',
  }[state] || 'badge-offline';
  return <span className={`badge ${cls}`} title={vm.lastProbeError || ''}>{label}</span>;
}

function AuthBadge({ vm }) {
  const auth = vm.authStatus || (
    vm.status === 'online'
      ? 'allowed'
      : (vm.connectivityState === 'auth_failed' || vm.connectivityState === 'permission_denied' ? 'denied' : 'unknown')
  );
  if (auth === 'allowed') {
    return (
      <span className="badge badge-auth-allowed" title="WMI Windows authentication allowed">
        <ShieldCheck size={12} />
        <span>Allowed</span>
      </span>
    );
  }
  if (auth === 'denied') {
    return (
      <span className="badge badge-auth-denied" title="WMI Windows authentication denied or logon failed">
        <ShieldAlert size={12} />
        <span>Denied</span>
      </span>
    );
  }
  return (
    <span className="badge badge-auth-unknown" title="Authentication status unknown until checked">
      <span>—</span>
    </span>
  );
}

function AgentBadge({ vm }) {
  const removed = isRemoved(vm);
  return (
    <span className={`badge ${removed ? 'badge-agent-removed' : 'badge-agent-active'}`}>
      {removed ? 'Removed' : 'Active'}
    </span>
  );
}

export default function VmsPage() {
  const [vms, setVms] = useState([]);
  const { search } = useSearch();
  const { tick } = useRefresh();
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [connFilter, setConnFilter] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState([]);
  const [modal, setModal] = useState(null);
  const [checking, setChecking] = useState({});
  const [uninstalling, setUninstalling] = useState({});
  const [openMenuId, setOpenMenuId] = useState(null);
  const fileRef = useRef(null);
  const nav = useNavigate();
  const toast = useToast();

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (connFilter) params.set('status', connFilter);
      if (agentFilter) params.set('agentStatus', agentFilter);
      const v = await api.get(`/vms?${params}`);
      setVms(v.data || []);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, connFilter, agentFilter, toast]);

  useEffect(() => { load(); }, [load, tick]);

  useEffect(() => onSocket('vm:status', (d) => {
    if (!d?.vmId) return;
    setChecking((c) => {
      const next = { ...c };
      delete next[d.vmId];
      return next;
    });
    setVms((prev) => {
      const exists = prev.some((vm) => String(vm._id) === String(d.vmId));
      const patch = {
        status: d.status,
        connectivityState: d.connectivityState,
        authStatus: d.authStatus,
        lastProbeError: d.lastProbeError,
        agentStatus: d.agentStatus,
        ip: d.ip,
        version: d.version,
        lastCheck: d.lastCheck,
      };
      if (!exists) {
        return [...prev, { _id: d.vmId, name: d.name || d.vmId, ...patch }].sort((a, b) => a.name.localeCompare(b.name));
      }
      return prev.map((vm) => String(vm._id) === String(d.vmId) ? { ...vm, ...patch } : vm);
    });
  }), []);

  useEffect(() => onSocket('vms:deleted', () => load()), [load]);

  const importFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const replace = confirm('Replace all VMs? OK=yes, Cancel=merge');
    try {
      let r;
      if (/\.txt$/i.test(file.name)) {
        r = await api.post('/vms/import', { hosts: await file.text(), replace });
      } else if (/\.xlsx?$/i.test(file.name)) {
        const form = new FormData();
        form.append('file', file);
        form.append('replace', String(replace));
        r = await api.upload('/vms/import-excel', form);
      } else {
        toast('Use .txt or .xlsx', 'error');
        return;
      }
      toast(`Imported ${r.created} new — checking status…`, 'info');
      load();
      if (r.checkQueued) {
        setLoading(false);
      }
    } catch (err) {
      toast(err.message, 'error');
    }
    e.target.value = '';
  };

  const deleteVm = async (vm) => {
    if (isRemoved(vm)) {
      toast('Removed agents cannot be deleted', 'error');
      return;
    }
    if (!confirm(`Delete ${vm.name}? All related jobs will be removed.`)) return;
    try {
      const r = await api.delete(`/vms/${vm._id}`);
      toast(`Deleted — ${r.deletedJobs || 0} job(s) removed`, 'success');
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const uninstallVm = async (vm) => {
    if (!confirm(`Uninstall RSCD agent on ${vm.name} via WMI?\n\nThis will stop the service, remove the agent, and clean up Program Files.`)) return;
    setUninstalling((u) => ({ ...u, [vm._id]: true }));
    try {
      const r = await api.post(`/vms/${vm._id}/uninstall`, {});
      toast('Uninstall job started — opening realtime execution monitor…', 'info');
      const jobId = (r.data || r.job)?._id;
      if (jobId) {
        nav(`/jobs/${jobId}`);
      }
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setUninstalling((u) => ({ ...u, [vm._id]: false }));
    }
  };

  const checkVm = async (vm) => {
    setChecking((c) => ({ ...c, [vm._id]: true }));
    try {
      const r = await api.post(`/vms/${vm._id}/check`, {});
      const probe = r.probe || {};
      const conn = probe.connectivityState || probe.connectivity || r.data?.connectivityState;
      const agent = probe.agentStatus || r.data?.agentStatus;
      const connLabel = CONNECTIVITY_LABELS[conn] || conn || 'unknown';
      if (probe.error) {
        const short = probe.error.length > 120 ? `${probe.error.slice(0, 120)}…` : probe.error;
        toast(`${vm.name}: ${connLabel} — ${short}`, 'error');
      } else {
        toast(`${vm.name}: ${connLabel}, agent ${agent}`, 'success');
      }
      if (r.data) {
        setVms((prev) => prev.map((v) => (v._id === r.data._id ? r.data : v)));
      } else {
        load();
      }
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setChecking((c) => ({ ...c, [vm._id]: false }));
    }
  };

  const checkAll = async () => {
    try {
      await api.post('/vms/check-all', {});
      toast('Status check started for all VMs', 'info');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div className="page">
      <div className="toolbar">
        <span className="page-title">Agent Inventory</span>
        <select className="input" value={connFilter} onChange={(e) => setConnFilter(e.target.value)} style={{ width: 140 }}>
          <option value="">All connectivity</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
          <option value="excluded">Excluded</option>
        </select>
        <select className="input" value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} style={{ width: 130 }}>
          <option value="">All agents</option>
          <option value="active">Active</option>
          <option value="removed">Removed</option>
        </select>
        {selected.length > 0 && (
          <button className="btn btn-danger btn-sm" onClick={async () => {
            const activeIds = selected.filter((id) => {
              const vm = vms.find((v) => v._id === id);
              return vm && !isRemoved(vm);
            });
            if (!activeIds.length) {
              toast('Removed agents cannot be deleted', 'error');
              return;
            }
            if (!confirm(`Delete ${activeIds.length} VM(s) and their jobs?`)) return;
            const r = await api.post('/vms/bulk-delete', { ids: activeIds });
            toast(`Deleted ${r.deleted} VM(s), ${r.deletedJobs} job(s)`, 'success');
            setSelected([]);
            load();
          }}>
            <Trash2 size={14} /> Delete ({selected.length})
          </button>
        )}
        <div className="toolbar-right">
          <input ref={fileRef} type="file" accept=".txt,.xlsx,.xls" hidden onChange={importFile} />
          <button className="btn btn-outline" onClick={() => setModal('new')}><Plus size={14} /> Add</button>
          <button className="btn btn-outline" onClick={() => fileRef.current?.click()}><Upload size={14} /> Import</button>
          <button className="btn btn-outline" onClick={checkAll}><Search size={14} /> Check All</button>
          <button className="btn btn-outline" onClick={load}><RefreshCw size={14} /> Refresh</button>
          <Link to="/jobs/new" className="btn btn-primary">New Job</Link>
        </div>
      </div>

      <div className="table-wrap">
        <table className="agent-table">
          <thead>
            <tr>
              <th className="col-check">
                <input type="checkbox" checked={selected.length === vms.length && vms.length > 0}
                  onChange={() => setSelected(selected.length === vms.length ? [] : vms.map((v) => v._id))} />
              </th>
              <th>Hostname</th>
              <th>IP</th>
              <th>Agent Status</th>
              <th>Connectivity</th>
              <th>Authentication</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="empty"><Loader2 className="spin" size={18} /> Loading…</td></tr>
            ) : vms.length === 0 ? (
              <tr><td colSpan={7} className="empty">No VMs — add or import hosts, then run Check</td></tr>
            ) : vms.map((vm) => {
              const removed = isRemoved(vm);
              const busy = checking[vm._id];
              const auth = vm.authStatus || (
                vm.status === 'online'
                  ? 'allowed'
                  : (vm.connectivityState === 'auth_failed' || vm.connectivityState === 'permission_denied' ? 'denied' : 'unknown')
              );
              const canUninstall = !removed && auth === 'allowed' && !uninstalling[vm._id];
              return (
                <tr
                  key={vm._id}
                  className={`data-row ${busy ? 'row-checking' : ''} ${openMenuId === vm._id ? 'row-menu-active' : ''}`}
                  onClick={() => setOpenMenuId(vm._id)}
                >
                  <td className="col-check" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.includes(vm._id)} disabled={removed}
                      onChange={() => setSelected((s) => s.includes(vm._id) ? s.filter((x) => x !== vm._id) : [...s, vm._id])} />
                  </td>
                  <td className="col-host">{vm.name}</td>
                  <td className="col-ip mono">{displayIp(vm.ip)}</td>
                  <td className="col-status"><AgentBadge vm={vm} /></td>
                  <td className="col-status"><ConnBadge vm={vm} isChecking={busy} /></td>
                  <td className="col-status"><AuthBadge vm={vm} /></td>
                  <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                    <RowActionsMenu
                      open={openMenuId === vm._id}
                      onOpenChange={(v) => setOpenMenuId(v ? vm._id : null)}
                      items={[
                        {
                          icon: busy ? <Loader2 className="spin" size={15} /> : <Activity size={15} />,
                          label: busy ? 'Checking…' : 'Check',
                          onClick: () => checkVm(vm),
                          disabled: busy,
                        },
                        {
                          icon: <Unplug size={15} />,
                          label: uninstalling[vm._id]
                            ? 'Uninstalling…'
                            : (canUninstall ? 'Uninstall' : (removed ? 'Uninstall (Removed)' : 'Uninstall (Requires Allowed Auth)')),
                          onClick: () => uninstallVm(vm),
                          disabled: !canUninstall,
                          danger: true,
                        },
                        {
                          icon: <Pencil size={15} />,
                          label: 'Edit',
                          onClick: () => setModal(vm),
                          disabled: removed,
                        },
                        {
                          icon: <Trash2 size={15} />,
                          label: 'Delete',
                          onClick: () => deleteVm(vm),
                          disabled: removed,
                          danger: true,
                        },
                      ]}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modal && (
        <VmModal
          vm={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={(vm, isNew) => {
            if (isNew && vm) {
              setVms((prev) => {
                if (prev.some((v) => v._id === vm._id)) return prev;
                return [...prev, vm].sort((a, b) => a.name.localeCompare(b.name));
              });
            } else {
              load();
            }
          }}
          onChecking={(id) => setChecking((c) => ({ ...c, [id]: true }))}
        />
      )}
    </div>
  );
}
