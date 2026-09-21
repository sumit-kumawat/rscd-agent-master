import {
  memo, useEffect, useState, useRef, useCallback,
} from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  RefreshCw, Plus, Upload, Search, Trash2, Power,
} from 'lucide-react';
import api from './api';
import { onSocket } from './socket';
import { useToast } from './components/Toast';
import { useSearch } from './context/SearchContext';
import { useRefresh } from './context/RefreshContext';
import EndpointLightbox, { PowerBadge, RscdAgentBadge } from './components/EndpointLightbox';
import { useLayoutFilter } from './Layout';
import { useApiQuery } from './hooks/useApiQuery';
import BulkUninstallDialog from './components/BulkUninstallDialog';
import Portal from './components/Portal';
import { TableSkeleton } from './components/ui/TabSkeletons';

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function displayIp(ip) {
  const v = String(ip || '').trim();
  return IPV4.test(v) ? v : '—';
}

function isRemoved(vm) {
  return vm.agentStatus === 'removed' || vm.version === 'removed';
}

function patchVmList(list, payload) {
  if (!payload?.vmId || !Array.isArray(list)) return list;
  const idx = list.findIndex((v) => String(v._id) === String(payload.vmId));
  if (idx === -1) return list;
  const next = [...list];
  next[idx] = {
    ...next[idx],
    status: payload.status ?? next[idx].status,
    connectivity: payload.connectivity ?? next[idx].connectivity,
    connectivityState: payload.connectivityState ?? next[idx].connectivityState,
    authStatus: payload.authStatus ?? next[idx].authStatus,
    agentStatus: payload.agentStatus ?? next[idx].agentStatus,
    ip: payload.ip ?? next[idx].ip,
    version: payload.version ?? next[idx].version,
    lastCheck: payload.lastCheck ?? next[idx].lastCheck,
    powerState: payload.powerState ?? next[idx].powerState,
  };
  return next;
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
    <Portal>
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
    </Portal>
  );
}

const VmRow = memo(function VmRow({
  vm, selected, isActive, onOpen, onToggleSelect,
}) {
  return (
    <tr
      className={`data-row ${isActive ? 'row-menu-active' : ''}`}
      onClick={() => onOpen(vm)}
    >
      <td className="col-check" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          disabled={isRemoved(vm)}
          onChange={() => onToggleSelect(vm._id)}
        />
      </td>
      <td className="col-host">{vm.name}</td>
      <td className="col-ip mono">{displayIp(vm.ip)}</td>
      <td>{vm.osVersion || vm.os || 'Windows'}</td>
      <td className="col-status"><RscdAgentBadge vm={vm} /></td>
      <td className="col-status"><PowerBadge vm={vm} /></td>
    </tr>
  );
});

export default function VmsPage() {
  const location = useLocation();
  const nav = useNavigate();
  const headerFilter = useLayoutFilter();
  const { search } = useSearch();
  const { tick } = useRefresh();
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [connFilter, setConnFilter] = useState('');
  const [selected, setSelected] = useState([]);
  const [modal, setModal] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const [lightboxTab, setLightboxTab] = useState('overview');
  const [bulkPowerAction, setBulkPowerAction] = useState('');
  const [bulkPassword, setBulkPassword] = useState('');
  const [bulkUninstallOpen, setBulkUninstallOpen] = useState(false);
  const [bulkUninstallLoading, setBulkUninstallLoading] = useState(false);
  const fileRef = useRef(null);
  const toast = useToast();

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const {
    data: vms = [],
    isLoading,
    isError,
    error,
    reload,
    silentReload,
    patchData,
  } = useApiQuery(
    async ({ timeout, signal }) => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('search', debouncedSearch);
      const statusFilter = connFilter || headerFilter;
      if (statusFilter) params.set('status', statusFilter);
      const v = await api.get(`/vms?${params}`, { timeout, signal });
      return v.data || [];
    },
    [debouncedSearch, connFilter, headerFilter],
    { initialData: [] },
  );

  const loading = isLoading && !vms.length;

  useEffect(() => {
    silentReload();
  }, [tick, silentReload]);

  const openLightbox = useCallback((vm, tab = 'overview') => {
    setLightboxTab(tab);
    setLightbox(vm);
  }, []);

  useEffect(() => {
    const openId = location.state?.openVmId;
    if (!openId || !vms.length) return;
    const vm = vms.find((v) => String(v._id) === String(openId));
    if (vm) openLightbox(vm);
  }, [location.state?.openVmId, vms, openLightbox]);

  const closeLightbox = useCallback(() => {
    setLightbox(null);
    setLightboxTab('overview');
  }, []);

  useEffect(() => onSocket('vm:status', (payload) => {
    patchData((list) => patchVmList(list, payload));
    setLightbox((lb) => {
      if (!lb || String(lb._id) !== String(payload.vmId)) return lb;
      return { ...lb, ...payload, _id: lb._id };
    });
  }), [patchData]);

  useEffect(() => onSocket('vms:deleted', () => reload(true)), [reload]);

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
      reload(true);
    } catch (err) {
      toast(err.message, 'error');
    }
    e.target.value = '';
  };

  const selectedVms = vms.filter((vm) => selected.includes(vm._id));
  const canBulkUninstall = selectedVms.some((vm) => !isRemoved(vm) && !vm.excluded);

  const bulkUninstall = async () => {
    const targets = selectedVms.filter((vm) => !isRemoved(vm) && !vm.excluded);
    if (!targets.length) return;
    setBulkUninstallLoading(true);
    try {
      const r = await api.post('/endpoints/bulk-uninstall-rscd', { endpointIds: targets.map((v) => v._id) });
      const job = r.data || r.job;
      toast(`Uninstall job started for ${targets.length} endpoint(s)`, 'info');
      setBulkUninstallOpen(false);
      setSelected([]);
      if (job?._id) nav(`/jobs/${job._id}`);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBulkUninstallLoading(false);
    }
  };

  const bulkPower = async () => {
    if (!bulkPowerAction || !bulkPassword || !selected.length) return;
    if (!confirm(`Run ${bulkPowerAction} on ${selected.length} endpoint(s)?`)) return;
    try {
      const r = await api.post('/vms/bulk-power', { ids: selected, action: bulkPowerAction, password: bulkPassword });
      const ok = r.results?.filter((x) => x.ok).length || 0;
      toast(`Power action sent to ${ok}/${selected.length} endpoints`, ok ? 'success' : 'warning');
      silentReload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const toggleSelect = useCallback((id) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }, []);

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
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={!canBulkUninstall}
              onClick={() => setBulkUninstallOpen(true)}
            >
              <Trash2 size={14} strokeWidth={1.5} /> Uninstall RSCD ({selected.length})
            </button>
          </>
        )}
        <div className="toolbar-right">
          <input ref={fileRef} type="file" accept=".txt,.xlsx,.xls" hidden onChange={importFile} />
          <button className="btn btn-outline" onClick={() => setModal('new')}><Plus size={14} /> Add</button>
          <button className="btn btn-outline" onClick={() => fileRef.current?.click()}><Upload size={14} /> Import</button>
          <button className="btn btn-outline" onClick={async () => { await api.post('/vms/check-all', {}); toast('Check started', 'info'); }}><Search size={14} /> Check All</button>
          <button className="btn btn-outline" onClick={() => reload(true)}><RefreshCw size={14} /> Refresh</button>
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
              <th>RSCD Agents</th>
              <th>Power</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6}><TableSkeleton rows={6} cols={5} /></td></tr>
            ) : isError ? (
              <tr><td colSpan={6} className="empty">{error} — <button className="btn btn-outline btn-sm" onClick={() => reload(false)}>Retry</button></td></tr>
            ) : vms.length === 0 ? (
              <tr><td colSpan={6} className="empty">No endpoints — add or import hosts to get started</td></tr>
            ) : vms.map((vm) => (
              <VmRow
                key={vm._id}
                vm={vm}
                selected={selected.includes(vm._id)}
                isActive={lightbox?._id === vm._id}
                onOpen={openLightbox}
                onToggleSelect={toggleSelect}
              />
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <VmModal
          vm={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => reload(true)}
          onChecking={() => {}}
        />
      )}

      {bulkUninstallOpen && (
        <Portal>
          <BulkUninstallDialog
            endpoints={selectedVms.filter((vm) => !isRemoved(vm) && !vm.excluded)}
            onConfirm={bulkUninstall}
            onClose={() => setBulkUninstallOpen(false)}
            loading={bulkUninstallLoading}
          />
        </Portal>
      )}

      {lightbox && (
        <EndpointLightbox
          vm={lightbox}
          initialTab={lightboxTab}
          onClose={closeLightbox}
          onVmUpdated={() => silentReload()}
        />
      )}
    </div>
  );
}
