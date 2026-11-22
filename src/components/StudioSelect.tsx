import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface StudioSelectOption {
  value: string;
  label: string;
  sublabel?: string;
  dot?: 'emerald' | 'amber' | 'rose' | 'none';
}

interface StudioSelectProps {
  value: string;
  options: StudioSelectOption[];
  placeholder?: string;
  openUp?: boolean;
  align?: 'left' | 'right';
  onChange: (value: string) => void;
}

export function StudioSelect({
  value,
  options,
  placeholder = 'Select...',
  openUp = false,
  align = 'left',
  onChange,
}: StudioSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);

  const dotClass = (dot?: StudioSelectOption['dot']) =>
    dot === 'emerald'
      ? 'bg-emerald-400'
      : dot === 'amber'
        ? 'bg-amber-400'
        : dot === 'rose'
          ? 'bg-rose-400'
          : '';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full h-8 px-2.5 rounded-lg bg-black/30 border text-xs text-left flex items-center justify-between gap-2 transition-colors cursor-pointer ${
          open
            ? 'border-[var(--accent)] bg-white/[0.06]'
            : 'border-white/[0.1] hover:border-white/[0.2] hover:bg-white/[0.04]'
        }`}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          {current?.dot && current.dot !== 'none' && (
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass(current.dot)}`} />
          )}
          <span className="truncate text-[var(--text-primary)]">
            {current?.label || value || placeholder}
          </span>
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-[var(--text-muted)] shrink-0 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div
          className={`absolute min-w-full w-max max-w-[280px] max-h-56 overflow-y-auto rounded-xl border shadow-2xl p-1 z-50 space-y-0.5 ${
            align === 'right' ? 'right-0' : 'left-0'
          } ${
            openUp ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          }`}
          style={{
            backgroundColor: 'var(--bg-elevated)',
            borderColor: 'var(--border-strong)',
          }}
        >
          {options.map((opt) => {
            const selected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`w-full px-2.5 py-1.5 rounded-lg text-left flex items-center justify-between gap-2.5 transition-colors cursor-pointer ${
                  selected ? 'bg-white/[0.09]' : 'hover:bg-white/[0.05]'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    {opt.dot && opt.dot !== 'none' && (
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass(opt.dot)}`} />
                    )}
                    <span
                      className="text-xs font-medium truncate"
                      style={{ color: selected ? 'var(--accent)' : 'var(--text-primary)' }}
                    >
                      {opt.label}
                    </span>
                  </div>
                  {opt.sublabel && (
                    <div className="text-[10px] text-[var(--text-muted)] truncate mt-0.5">
                      {opt.sublabel}
                    </div>
                  )}
                </div>
                {selected && (
                  <Check className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
