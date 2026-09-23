import {
  memo, useEffect, useState, useRef, useCallback,
} from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  RefreshCw, Plus, Upload, Search, Trash2, Rocket,
} from 'lucide-react';
import DeployWizard from './components/DeployWizard';
import api from './api';
import { onSocket } from './socket';
import { useToast } from './components/Toast';
import { useSearch } from './context/SearchContext';
import { useRefresh } from './context/RefreshContext';
import EndpointLightbox from './components/EndpointLightbox';
import { useLayoutFilter } from './Layout';
import { useLiveData } from './hooks/useLiveData';
import BulkUninstallDialog from './components/BulkUninstallDialog';
import Portal from './components/Portal';
import { useSync } from './context/SyncContext';
import {
  crowdStrikeActiveLabel, displayIp, displayOs, powerIsUp, rscdActiveLabel,
} from './utils/assetsDisplay';
import { isEndpointReady, readyLabel } from './utils/readiness';

function patchVmList(list, payload) {
  if (!payload?.vmId || !Array.isArray(list)) return list;
  const idx = list.findIndex((v) => String(v._id) === String(payload.vmId));
  if (idx === -1) return list;
  const next = [...list];
  next[idx] = {
    ...next[idx],
    status: payload.status ?? next[idx].status,
    connectivityState: payload.connectivityState ?? next[idx].connectivityState,
    agentStatus: payload.agentStatus ?? next[idx].agentStatus,
    ip: payload.ip ?? next[idx].ip,
    version: payload.version ?? next[idx].version,
    rscdStatus: payload.rscdStatus ?? next[idx].rscdStatus,
    crowdStrikeStatus: payload.crowdStrikeStatus ?? next[idx].crowdStrikeStatus,
    powerState: payload.powerState ?? next[idx].powerState,
    osVersion: payload.osVersion ?? next[idx].osVersion,
  };
  return next;
}

const emptyForm = () => ({
  name: '', ip: '', fqdn: '', installRoot: '', site: '', excluded: false,
  wmiDomain: '', wmiUsername: '', wmiPassword: '',
});

function VmModal({ vm, onClose, onSaved }) {
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
        await api.post('/vms', payload);
        toast('Endpoint added', 'success');
      } else {
        await api.put(`/vms/${vm._id}`, payload);
        toast('Endpoint updated', 'success');
      }
      onSaved();
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
          <h3 style={{ margin: '0 0 14px', fontSize: 16 }}>{isNew ? 'Add endpoint' : 'Edit endpoint'}</h3>
          <label className="field"><span>Hostname</span>
            <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} /></label>
          <label className="field"><span>IP (optional)</span>
            <input className="input" value={form.ip} onChange={(e) => set('ip', e.target.value)} /></label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

function PowerDot({ up }) {
  return (
    <span
      className={`power-dot ${up ? 'power-dot-up' : 'power-dot-down'}`}
      title={up ? 'Up' : 'Down'}
      aria-label={up ? 'Power up' : 'Power down'}
    />
  );
}

const AssetRow = memo(function AssetRow({ vm, selected, isActive, onOpen, onToggleSelect }) {
  const rscd = rscdActiveLabel(vm);
  const cs = crowdStrikeActiveLabel(vm);
  const ready = isEndpointReady(vm);
  const readyText = readyLabel(vm);
  return (
    <tr
      className={`data-row ${isActive ? 'row-menu-active' : ''}`}
      onClick={() => onOpen(vm)}
    >
      <td className="col-check" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          disabled={!!vm.excluded}
          onChange={() => onToggleSelect(vm._id)}
        />
      </td>
      <td className="col-host">{vm.name}</td>
      <td className="col-ip mono">{displayIp(vm.ip)}</td>
      <td>{displayOs(vm)}</td>
      <td className={rscd === 'Active' ? 'cell-active' : 'cell-inactive'}>{rscd}</td>
      <td className={cs === 'Active' ? 'cell-active' : 'cell-inactive'}>{cs}</td>
      <td className={ready === true ? 'cell-active' : (ready === false ? 'cell-inactive' : 'cell-muted')}>{readyText}</td>
      <td className="col-power"><PowerDot up={powerIsUp(vm)} /></td>
    </tr>
  );
});

export default function VmsPage() {
  const location = useLocation();
  const nav = useNavigate();
  const headerFilter = useLayoutFilter();
  const { search } = useSearch();
  const { tick } = useRefresh();
  const { syncedTick } = useSync();
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [connFilter, setConnFilter] = useState('');
  const [selected, setSelected] = useState([]);
  const [modal, setModal] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const [lightboxTab, setLightboxTab] = useState('overview');
  const [deployOpen, setDeployOpen] = useState(false);
  const [bulkUninstallOpen, setBulkUninstallOpen] = useState(false);
  const [bulkUninstallLoading, setBulkUninstallLoading] = useState(false);
  const fileRef = useRef(null);
  const toast = useToast();

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(t);
  }, [search]);

  const { data: vms, reload, patchData } = useLiveData(
    async () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('search', debouncedSearch);
      const statusFilter = connFilter || headerFilter;
      if (statusFilter) params.set('status', statusFilter);
      const r = await api.get(`/vms?${params}`);
      return r.data || [];
    },
    [debouncedSearch, connFilter, headerFilter, tick, syncedTick],
  );

  const list = Array.isArray(vms) ? vms : [];

  useEffect(() => {
    reload();
  }, [tick, syncedTick, reload]);

  const openLightbox = useCallback((vm, tab = 'overview') => {
    setLightboxTab(tab);
    setLightbox(vm);
  }, []);

  useEffect(() => {
    const openId = location.state?.openVmId;
    if (!openId || !list.length) return;
    const vm = list.find((v) => String(v._id) === String(openId));
    if (vm) openLightbox(vm);
  }, [location.state?.openVmId, list, openLightbox]);

  const closeLightbox = useCallback(() => {
    setLightbox(null);
    setLightboxTab('overview');
  }, []);

  useEffect(() => onSocket('vm:status', (payload) => {
    patchData((prev) => patchVmList(prev || [], payload));
    setLightbox((lb) => {
      if (!lb || String(lb._id) !== String(payload.vmId)) return lb;
      return { ...lb, ...payload, _id: lb._id };
    });
  }), [patchData]);

  useEffect(() => onSocket('vms:deleted', () => reload()), [reload]);
  useEffect(() => onSocket('vms:imported', () => reload()), [reload]);

  const importFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const replace = confirm('Replace all endpoints? OK = replace, Cancel = merge');
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
      toast(`Import — ${r.created ?? 0} new, ${r.updated ?? 0} updated`, 'success');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
    e.target.value = '';
  };

  const selectedVms = list.filter((vm) => selected.includes(vm._id));
  const canBulkUninstall = selectedVms.some((vm) => !vm.excluded);

  const bulkUninstall = async () => {
    const targets = selectedVms.filter((vm) => !vm.excluded);
    if (!targets.length) return;
    setBulkUninstallLoading(true);
    try {
      const r = await api.post('/endpoints/bulk-uninstall-rscd', { endpointIds: targets.map((v) => v._id) });
      const job = r.data || r.job;
      toast(`Uninstall job started (${targets.length})`, 'info');
      setBulkUninstallOpen(false);
      setSelected([]);
      if (job?._id) nav(`/jobs/${job._id}`);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBulkUninstallLoading(false);
    }
  };

  const toggleSelect = useCallback((id) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }, []);

  return (
    <div className="page">
      <div className="toolbar">
        <span className="page-title">Assets</span>
        <select className="input toolbar-select" value={connFilter} onChange={(e) => setConnFilter(e.target.value)}>
          <option value="">All health</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
          <option value="excluded">Excluded</option>
        </select>
        {selected.length > 0 && (
          <>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setDeployOpen(true)}>
              <Rocket size={14} strokeWidth={1.5} /> Deploy ({selected.length})
            </button>
            <button type="button" className="btn btn-danger btn-sm" disabled={!canBulkUninstall} onClick={() => setBulkUninstallOpen(true)}>
              <Trash2 size={14} strokeWidth={1.5} /> Uninstall RSCD
            </button>
          </>
        )}
        <div className="toolbar-right">
          <input ref={fileRef} type="file" accept=".txt,.xlsx,.xls" hidden onChange={importFile} />
          <button className="btn btn-outline" onClick={() => setModal('new')}><Plus size={14} /> Add</button>
          <button className="btn btn-outline" onClick={() => fileRef.current?.click()}><Upload size={14} /> Import</button>
          <button className="btn btn-outline" onClick={async () => { await api.post('/vms/check-all', {}); toast('Check started', 'info'); }}><Search size={14} /> Check All</button>
          <button className="btn btn-outline" onClick={() => reload()}><RefreshCw size={14} /> Refresh</button>
          <Link to="/jobs/new" className="btn btn-primary">New Job</Link>
        </div>
      </div>

      <div className="table-wrap">
        <table className="agent-table endpoints-table assets-table">
          <thead>
            <tr>
              <th className="col-check">
                <input
                  type="checkbox"
                  checked={selected.length === list.length && list.length > 0}
                  onChange={() => setSelected(selected.length === list.length ? [] : list.map((v) => v._id))}
                />
              </th>
              <th>Hostname</th>
              <th>IP</th>
              <th>Operating System</th>
              <th>RSCD</th>
              <th>CrowdStrike</th>
              <th>Ready</th>
              <th>Power</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr><td colSpan={8} className="empty">No assets — import or add endpoints</td></tr>
            ) : list.map((vm) => (
              <AssetRow
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
        <VmModal vm={modal === 'new' ? null : modal} onClose={() => setModal(null)} onSaved={reload} />
      )}

      {bulkUninstallOpen && (
        <Portal>
          <BulkUninstallDialog
            endpoints={selectedVms.filter((vm) => !vm.excluded)}
            onConfirm={bulkUninstall}
            onClose={() => setBulkUninstallOpen(false)}
            loading={bulkUninstallLoading}
          />
        </Portal>
      )}

      {deployOpen && <DeployWizard endpoints={selectedVms} onClose={() => setDeployOpen(false)} />}

      {lightbox && (
        <EndpointLightbox
          vm={lightbox}
          initialTab={lightboxTab}
          onClose={closeLightbox}
          onVmUpdated={reload}
        />
      )}
    </div>
  );
}
