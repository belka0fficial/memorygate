import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export default function TextField({ label, className = '', type = 'text', ...props }) {
  const [visible, setVisible] = useState(false);
  const isPassword = type === 'password';
  const resolvedType = isPassword ? (visible ? 'text' : 'password') : type;

  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>}
      <div className="relative">
        <input
          type={resolvedType}
          className={`w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text
                      placeholder:text-muted/70 outline-none transition-colors focus-visible:border-accent
                      disabled:opacity-50 ${isPassword ? 'pr-10' : ''} ${className}`}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted transition-colors hover:bg-white/[0.06] hover:text-text"
            aria-label={visible ? 'Hide password' : 'Show password'}
          >
            {visible ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        )}
      </div>
    </label>
  );
}

export function TextArea({ label, className = '', ...props }) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>}
      <textarea
        className={`w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text
                    placeholder:text-muted/70 outline-none transition-colors focus-visible:border-accent
                    disabled:opacity-50 ${className}`}
        {...props}
      />
    </label>
  );
}
