import { useState } from 'react';
import { RefreshCw, Check, CheckCheck, X, ShieldAlert, Loader2 } from 'lucide-react';
import type { NeedsAttentionAction, PendingApproval, ProviderType, UiLanguage } from '../../shared/types';
import { AgentPill, RiskBadge } from './AgentBadge';
import { t } from '../lib/i18n';

interface NeedsAttentionCardProps {
  language: UiLanguage;
  message: string;
  action?: NeedsAttentionAction;
  onTriggerLogin: (provider: ProviderType) => Promise<void>;
  onRefreshProviders: () => Promise<void>;
  onOpenAccountsSettings: () => void;
}

export function NeedsAttentionCard({
  language,
  message,
  action,
  onTriggerLogin,
  onRefreshProviders,
  onOpenAccountsSettings,
}: NeedsAttentionCardProps) {
  const copy = t(language);
  const [busy, setBusy] = useState(false);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  const handlePrimary = async () => {
    if (!action) {
      onOpenAccountsSettings();
      return;
    }
    if (action.type === 'open_settings' || action.type === 'install_cli') {
      onOpenAccountsSettings();
      return;
    }
    setBusy(true);
    setStatusNote(null);
    try {
      await onTriggerLogin(action.provider);
      setStatusNote(
        action.provider === 'ollama'
          ? 'Local AI started. You can send your message again.'
          : 'Official sign-in window opened. Complete sign-in in your browser, then click Refresh status.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-rose-500/45 bg-rose-950/15 p-4 space-y-3">
      <div className="text-xs font-semibold text-rose-200">{copy.needsAttention}</div>
      <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">{message}</p>

      {statusNote && (
        <div className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-lg px-3 py-2">
          {statusNote}
        </div>
      )}

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => void handlePrimary()}
          disabled={busy}
          className="w-full h-9 rounded-lg font-medium text-xs inline-flex items-center justify-center gap-2 transition-opacity cursor-pointer hover:opacity-95 disabled:opacity-50"
          style={{
            backgroundColor: 'var(--accent)',
            color: 'var(--accent-fg)',
          }}
        >
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          <span>{action?.label || copy.signInAgain}</span>
        </button>

        {action && (action.type === 'login' || action.type === 'start_ollama') && (
          <div className="flex items-center justify-between pt-0.5 text-[11px] text-[var(--text-muted)]">
            <button
              type="button"
              onClick={() => void onRefreshProviders()}
              className="inline-flex items-center gap-1.5 hover:text-[var(--text-primary)] cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>{copy.checkStatus}</span>
            </button>
            <button
              type="button"
              onClick={onOpenAccountsSettings}
              className="hover:text-[var(--text-primary)] cursor-pointer"
            >
              {copy.openSettings}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface InlineApprovalCardProps {
  language: UiLanguage;
  approval: PendingApproval;
  onDecide: (approvalId: string, approved: boolean, rememberForSession?: boolean) => void;
}

export function InlineApprovalCard({ language, approval, onDecide }: InlineApprovalCardProps) {
  const copy = t(language);
  return (
    <div className="rounded-xl border border-rose-500/45 bg-rose-950/15 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
          <span className="text-xs font-semibold text-rose-200">{copy.needsAttention}</span>
          <AgentPill agent={approval.agent} compact />
          <RiskBadge risk={approval.risk} />
        </div>
        <code className="text-[11px] px-2 py-0.5 rounded bg-black/35 border border-white/10 text-[var(--accent)]">
          {approval.toolName}
        </code>
      </div>

      <p className="text-xs text-[var(--text-secondary)]">{approval.reason}</p>

      <pre className="text-[11px] font-mono bg-black/35 border border-white/[0.08] rounded-lg p-2.5 text-[var(--text-secondary)] overflow-x-auto max-h-28">
        {JSON.stringify(approval.args, null, 2)}
      </pre>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onDecide(approval.id, true, false)}
          className="h-8 px-3.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer transition-opacity hover:opacity-95"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          <Check className="w-3.5 h-3.5" />
          <span>{copy.allowOnce}</span>
        </button>

        {approval.risk !== 'danger' && (
          <button
            type="button"
            onClick={() => onDecide(approval.id, true, true)}
            className="h-8 px-3 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.1] text-xs text-[var(--text-primary)] inline-flex items-center gap-1.5 cursor-pointer"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            <span>{copy.allowSession}</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => onDecide(approval.id, false, false)}
          className="h-8 px-3 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/35 text-xs text-rose-200 inline-flex items-center gap-1.5 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
          <span>{copy.deny}</span>
        </button>
      </div>
    </div>
  );
}
