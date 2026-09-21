import { useEffect, useState, useRef, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  RefreshCw, Plus, Upload, Search, Trash2, Power, Loader2,
} from 'lucide-react';
import api from './api';
import { onSocket } from './socket';
import { useToast } from './components/Toast';
import { useSearch } from './context/SearchContext';
import { useRefresh } from './context/RefreshContext';
import EndpointLightbox, { LocalUsersCell, PowerBadge } from './components/EndpointLightbox';

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function displayIp(ip) {
  const v = String(ip || '').trim();
  return IPV4.test(v) ? v : '—';
}

function isRemoved(vm) {
  return vm.agentStatus === 'removed' || vm.version === 'removed';
}

function healthLabel(vm) {
  if (vm.excluded) return 'excluded';
  if (vm.status === 'in_progress') return 'busy';
  if (vm.connectivityState === 'online' || vm.status === 'online') return 'healthy';
  if (vm.connectivityState) return vm.connectivityState;
  return vm.status || 'unknown';
}

function HealthBadge({ vm }) {
  const h = healthLabel(vm);
  const cls = h === 'healthy' ? 'badge-online' : h === 'busy' ? 'badge-progress' : 'badge-offline';
  return <span className={`badge ${cls}`}>{h}</span>;
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
    if (!form.name.trim()) { toast('Hostname is required', 'error'); return; }
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
          <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} /></label>
        <label className="field"><span>IP Address (optional)</span>
          <input className="input" value={form.ip} onChange={(e) => set('ip', e.target.value)} /></label>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={form.excluded} onChange={(e) => set('excluded', e.target.checked)} />
          <span>Excluded from jobs</span>
        </label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

export default function VmsPage() {
  const location = useLocation();
  const [vms, setVms] = useState([]);
  const { search } = useSearch();
  const { tick } = useRefresh();
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [connFilter, setConnFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState([]);
  const [modal, setModal] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const [lightboxTab, setLightboxTab] = useState('overview');
  const [bulkPowerAction, setBulkPowerAction] = useState('');
  const [bulkPassword, setBulkPassword] = useState('');
  const fileRef = useRef(null);
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
      const v = await api.get(`/vms?${params}`);
      setVms(v.data || []);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, connFilter, toast]);

  useEffect(() => { load(); }, [load, tick]);

  const openLightbox = (vm, tab = 'overview') => {
    setLightboxTab(tab);
    setLightbox(vm);
  };

  useEffect(() => {
    const openId = location.state?.openVmId;
    if (!openId || !vms.length) return;
    const vm = vms.find((v) => String(v._id) === String(openId));
    if (vm) openLightbox(vm);
  }, [location.state?.openVmId, vms]);

  const closeLightbox = () => {
    setLightbox(null);
    setLightboxTab('overview');
  };

  useEffect(() => onSocket('vm:status', (d) => {
    if (!d?.vmId) return;
    setVms((prev) => prev.map((vm) => String(vm._id) === String(d.vmId)
      ? {
        ...vm,
        status: d.status,
        connectivityState: d.connectivityState,
        authStatus: d.authStatus,
        agentStatus: d.agentStatus,
        ip: d.ip,
        version: d.version,
        lastCheck: d.lastCheck,
        powerState: d.powerState || vm.powerState,
        lastSeenAt: d.lastSeenAt || vm.lastSeenAt,
        localUsers: d.localUsers || vm.localUsers,
      }
      : vm));
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
      toast(`Imported ${r.created} new`, 'info');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
    e.target.value = '';
  };

  const bulkPower = async () => {
    if (!bulkPowerAction || !bulkPassword || !selected.length) return;
    if (!confirm(`Run ${bulkPowerAction} on ${selected.length} endpoint(s)?`)) return;
    try {
      const r = await api.post('/vms/bulk-power', { ids: selected, action: bulkPowerAction, password: bulkPassword });
      const ok = r.results?.filter((x) => x.ok).length || 0;
      toast(`Power action sent to ${ok}/${selected.length} endpoints`, ok ? 'success' : 'warning');
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const lastSeen = (vm) => {
    const d = vm.lastSeenAt || vm.lastCheck;
    return d ? new Date(d).toLocaleString() : '—';
  };

  return (
    <div className="page">
      <div className="toolbar">
        <span className="page-title">Endpoints</span>
        <select className="input toolbar-select" value={connFilter} onChange={(e) => setConnFilter(e.target.value)}>
          <option value="">All health</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
          <option value="excluded">Excluded</option>
        </select>
        {selected.length > 0 && (
          <>
            <select className="input toolbar-select" value={bulkPowerAction} onChange={(e) => setBulkPowerAction(e.target.value)}>
              <option value="">Bulk power action…</option>
              <option value="power_off_graceful">Power Off (graceful)</option>
              <option value="power_off_force">Power Off (force)</option>
              <option value="restart_graceful">Restart (graceful)</option>
              <option value="graceful_shutdown">Graceful Shutdown</option>
            </select>
            <input className="input" type="password" placeholder="RDSROOT password" value={bulkPassword} onChange={(e) => setBulkPassword(e.target.value)} style={{ maxWidth: 160 }} />
            <button className="btn btn-outline btn-sm" disabled={!bulkPowerAction || !bulkPassword} onClick={bulkPower}>
              <Power size={14} /> Apply ({selected.length})
            </button>
          </>
        )}
        <div className="toolbar-right">
          <input ref={fileRef} type="file" accept=".txt,.xlsx,.xls" hidden onChange={importFile} />
          <button className="btn btn-outline" onClick={() => setModal('new')}><Plus size={14} /> Add</button>
          <button className="btn btn-outline" onClick={() => fileRef.current?.click()}><Upload size={14} /> Import</button>
          <button className="btn btn-outline" onClick={async () => { await api.post('/vms/check-all', {}); toast('Check started', 'info'); }}><Search size={14} /> Check All</button>
          <button className="btn btn-outline" onClick={load}><RefreshCw size={14} /> Refresh</button>
          <Link to="/jobs/new" className="btn btn-primary">New Job</Link>
        </div>
      </div>

      <div className="table-wrap">
        <table className="agent-table endpoints-table">
          <thead>
            <tr>
              <th className="col-check">
                <input type="checkbox" checked={selected.length === vms.length && vms.length > 0}
                  onChange={() => setSelected(selected.length === vms.length ? [] : vms.map((v) => v._id))} />
              </th>
              <th>Hostname</th>
              <th>IP</th>
              <th>OS</th>
              <th>Health</th>
              <th>Power</th>
              <th>Local Users</th>
              <th>Last Seen</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="empty"><Loader2 className="spin" size={18} /> Loading…</td></tr>
            ) : vms.length === 0 ? (
              <tr><td colSpan={9} className="empty">No endpoints — add or import hosts to get started</td></tr>
            ) : vms.map((vm) => (
              <tr
                key={vm._id}
                className={`data-row ${lightbox?._id === vm._id ? 'row-menu-active' : ''}`}
                onClick={() => openLightbox(vm)}
              >
                <td className="col-check" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.includes(vm._id)} disabled={isRemoved(vm)}
                    onChange={() => setSelected((s) => s.includes(vm._id) ? s.filter((x) => x !== vm._id) : [...s, vm._id])} />
                </td>
                <td className="col-host">{vm.name}</td>
                <td className="col-ip mono">{displayIp(vm.ip)}</td>
                <td>{vm.osVersion || vm.os || 'Windows'}</td>
                <td className="col-status"><HealthBadge vm={vm} /></td>
                <td className="col-status"><PowerBadge state={vm.powerState} /></td>
                <td className="col-local-users" onClick={(e) => e.stopPropagation()}>
                  <LocalUsersCell vm={vm} onOpen={openLightbox} />
                </td>
                <td className="col-date">{lastSeen(vm)}</td>
                <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="btn btn-outline btn-sm" onClick={() => openLightbox(vm)}>Open</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <VmModal
          vm={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => load()}
          onChecking={() => {}}
        />
      )}

      {lightbox && (
        <EndpointLightbox
          vm={lightbox}
          initialTab={lightboxTab}
          onClose={closeLightbox}
          onVmUpdated={load}
        />
      )}
    </div>
  );
}
