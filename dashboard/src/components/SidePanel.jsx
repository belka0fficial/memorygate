import { useEffect } from 'react';
import { X } from 'lucide-react';

export default function SidePanel({ title, onClose, children, width = 420 }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="flex h-full flex-col border-l border-border bg-surface"
        style={{ width: `min(${width}px, 100vw)` }}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-medium text-text">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted transition-colors hover:bg-white/[0.06] hover:text-text">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
