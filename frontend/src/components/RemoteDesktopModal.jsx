import { X } from 'lucide-react';
import Portal from './Portal';

export default function RemoteDesktopModal({ session, onClose }) {
  if (!session?.embedPath) return null;
  const title = session.vmName || session.host || 'Remote Desktop';

  return (
    <Portal>
      <div className="rdp-modal-backdrop" onClick={onClose}>
        <div className="rdp-modal" onClick={(e) => e.stopPropagation()}>
          <header className="rdp-modal-header">
            <span className="rdp-modal-title">{title}</span>
            <button type="button" className="rdp-modal-close" onClick={onClose} aria-label="Close remote desktop">
              <X size={18} strokeWidth={1.5} />
            </button>
          </header>
          <iframe
            className="rdp-modal-frame"
            title={`Remote desktop — ${title}`}
            src={session.embedPath}
            allow="clipboard-read; clipboard-write"
          />
        </div>
      </div>
    </Portal>
  );
}
