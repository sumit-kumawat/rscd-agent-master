import { useEffect, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';

export default function RowActionsMenu({ items, open, onOpenChange }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = open !== undefined;
  const isOpen = controlled ? open : internalOpen;
  const setIsOpen = controlled ? onOpenChange : setInternalOpen;
  const ref = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const close = (e) => {
      if (!ref.current?.contains(e.target)) setIsOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [isOpen, setIsOpen]);

  return (
    <div className="row-menu" ref={ref}>
      <button
        type="button"
        className={`row-menu-trigger ${isOpen ? 'active' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        aria-label="Row actions"
        aria-expanded={isOpen}
      >
        <MoreVertical size={18} />
      </button>
      {isOpen && (
        <div className="row-menu-dropdown" onClick={(e) => e.stopPropagation()}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`row-menu-item ${item.danger ? 'danger' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setIsOpen(false);
                item.onClick();
              }}
              disabled={item.disabled}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
