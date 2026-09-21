import { AlertTriangle, Trash2, X } from 'lucide-react';

export default function BulkUninstallDialog({ endpoints, onConfirm, onClose, loading }) {
  const count = endpoints?.length || 0;
  const single = count === 1;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal bulk-uninstall-modal" onClick={(e) => e.stopPropagation()} role="dialog">
        <header className="bulk-uninstall-header">
          <div>
            <h3>Uninstall RSCD Agent</h3>
            <p className="bulk-uninstall-sub">
              {single ? 'Single endpoint' : `Bulk operation — ${count} endpoints`}
            </p>
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={onClose} aria-label="Close">
            <X size={16} strokeWidth={1.5} />
          </button>
        </header>
        <div className="alert alert-danger bulk-uninstall-warn">
          <AlertTriangle size={16} strokeWidth={1.5} />
          <span>
            This will stop the RSCD service, uninstall BMC/BladeLogic products, remove registry keys
            and installation directories. This action cannot be undone.
          </span>
        </div>
        <div className="bulk-uninstall-list">
          <div className="bulk-uninstall-list-title">Affected endpoints</div>
          <ul>
            {endpoints?.map((vm) => (
              <li key={vm._id}>
                <strong>{vm.name}</strong>
                <span className="mono">{vm.ip || vm.fqdn || '—'}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="bulk-uninstall-actions">
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={loading}>Cancel</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={loading || !count}>
            <Trash2 size={16} strokeWidth={1.5} />
            {loading ? 'Starting…' : `Uninstall ${count} agent${count === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
