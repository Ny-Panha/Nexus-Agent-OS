import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../../shared/types';

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

interface ContextRingPopoverProps {
  messages: ChatMessage[];
  defaultContextWindow?: number;
}

export function ContextRingPopover({
  messages,
  defaultContextWindow = 1_000_000,
}: ContextRingPopoverProps) {
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

  const usageMessages = messages.filter((m) => m.usage);
  const lastUsage = usageMessages[usageMessages.length - 1]?.usage;
  const contextWindow = lastUsage?.contextWindow || defaultContextWindow;

  const totalInput = usageMessages.reduce((s, m) => s + (m.usage?.inputTokens || 0), 0);
  const totalCached = usageMessages.reduce((s, m) => s + (m.usage?.cachedInputTokens || 0), 0);
  const totalOutput = usageMessages.reduce((s, m) => s + (m.usage?.outputTokens || 0), 0);

  const inMind = lastUsage
    ? lastUsage.inputTokens + lastUsage.outputTokens
    : Math.ceil(messages.reduce((s, m) => s + m.content.length, 0) / 4);
  const roomLeft = Math.max(0, contextWindow - inMind);
  const pct = Math.min(100, Math.round((inMind / Math.max(contextWindow, 1)) * 100));

  const radius = 6.5;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - pct / 100);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] text-[var(--text-secondary)] hover:bg-white/[0.06] transition-colors cursor-pointer tabular-nums"
        title="Context & Token Usage"
      >
        <svg width="16" height="16" viewBox="0 0 18 18" className="-rotate-90">
          <circle
            cx="9"
            cy="9"
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.14)"
            strokeWidth="2"
          />
          <circle
            cx="9"
            cy="9"
            r={radius}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
          />
        </svg>
        <span>{formatCompact(inMind)}</span>
      </button>

      {open && (
        <div
          className="absolute right-0 bottom-full mb-2 w-[310px] rounded-2xl border shadow-2xl p-4 z-40 space-y-3.5"
          style={{
            backgroundColor: 'var(--bg-elevated)',
            borderColor: 'var(--border-strong)',
          }}
        >
          <div>
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="font-semibold text-[var(--text-primary)]">Context in this chat</span>
              <span className="text-[11px] text-[var(--text-secondary)] tabular-nums">
                {formatCompact(inMind)} / {formatCompact(contextWindow)} · {pct}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.max(pct, inMind > 0 ? 2 : 0)}%`,
                  backgroundColor: 'var(--accent)',
                }}
              />
            </div>
          </div>

          <div className="space-y-1.5 text-xs tabular-nums">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Right now in the window
            </div>
            <div className="flex justify-between text-[var(--text-secondary)]">
              <span>In the agent&apos;s mind</span>
              <span className="font-semibold text-[var(--text-primary)]">{formatCompact(inMind)}</span>
            </div>
            <div className="flex justify-between text-[var(--text-secondary)]">
              <span>Room left</span>
              <span className="font-semibold text-[var(--text-primary)]">{formatCompact(roomLeft)}</span>
            </div>
          </div>

          <div className="space-y-1.5 text-xs tabular-nums pt-2 border-t border-white/[0.07]">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Last reply
            </div>
            <div className="flex justify-between text-[var(--text-secondary)]">
              <span>Fresh input</span>
              <span className="font-semibold text-[var(--text-primary)]">
                {formatCompact(lastUsage?.inputTokens || 0)}
              </span>
            </div>
            <div className="flex justify-between text-[var(--text-secondary)]">
              <span>Reused from cache</span>
              <span className="font-semibold text-[var(--text-primary)]">
                {formatCompact(lastUsage?.cachedInputTokens || 0)}
              </span>
            </div>
            <div className="flex justify-between text-[var(--text-secondary)]">
              <span>Written to cache</span>
              <span className="font-semibold text-[var(--text-primary)]">
                {formatCompact(lastUsage?.cacheWriteTokens || 0)}
              </span>
            </div>
            <div className="flex justify-between text-[var(--text-secondary)]">
              <span>The agent&apos;s output</span>
              <span className="font-semibold text-[var(--text-primary)]">
                {formatCompact(lastUsage?.outputTokens || 0)}
              </span>
            </div>
          </div>

          <div className="space-y-1.5 text-xs tabular-nums pt-2 border-t border-white/[0.07]">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              This whole chat
            </div>
            <div className="flex justify-between text-[var(--text-secondary)]">
              <span>Total input</span>
              <span className="font-semibold text-[var(--text-primary)]">{formatCompact(totalInput)}</span>
            </div>
            <div className="flex justify-between text-[var(--text-secondary)]">
              <span>Total from cache</span>
              <span className="font-semibold text-[var(--text-primary)]">{formatCompact(totalCached)}</span>
            </div>
            <div className="flex justify-between text-[var(--text-secondary)]">
              <span>Total output</span>
              <span className="font-semibold text-[var(--text-primary)]">{formatCompact(totalOutput)}</span>
            </div>
          </div>

          <p className="text-[10px] leading-relaxed text-[var(--text-muted)] pt-1 border-t border-white/[0.06]">
            {lastUsage?.estimated
              ? 'Estimated token counts shown for local/fallback engine turns.'
              : 'Totals reported directly by the active AI engine.'}
          </p>
        </div>
      )}
    </div>
  );
}
