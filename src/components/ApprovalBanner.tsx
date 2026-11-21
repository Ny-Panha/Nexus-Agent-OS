import { ShieldAlert, Check, X, CheckCheck } from 'lucide-react';
import type { PendingApproval } from '../../shared/types';
import { AgentPill, RiskBadge } from './AgentBadge';

interface ApprovalBannerProps {
  approvals: PendingApproval[];
  onDecide: (approvalId: string, approved: boolean, rememberForSession?: boolean) => void;
}

export function ApprovalBanner({ approvals, onDecide }: ApprovalBannerProps) {
  if (approvals.length === 0) return null;

  return (
    <div className="px-5 py-3 bg-rose-950/35 border-b border-rose-500/35 space-y-2.5">
      {approvals.map((item) => (
        <div
          key={item.id}
          className="rounded-xl bg-[#131826] border border-rose-500/40 p-3.5 shadow-lg shadow-rose-950/30"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
              <span className="text-xs font-semibold text-rose-200">
                Permission Required / សុំការអនុញ្ញាតមុនដំណើរការ
              </span>
              <AgentPill agent={item.agent} compact />
              <RiskBadge risk={item.risk} />
            </div>
            <code className="text-[11px] px-2 py-0.5 rounded bg-black/40 border border-white/10 text-cyan-300">
              {item.toolName}
            </code>
          </div>

          <p className="text-xs text-slate-300 mb-2">{item.reason}</p>

          <pre className="text-[11px] font-mono bg-[#0A0D14] border border-white/[0.08] rounded-lg p-2.5 text-slate-300 overflow-x-auto max-h-32 mb-3">
            {JSON.stringify(item.args, null, 2)}
          </pre>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onDecide(item.id, true, false)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 text-emerald-200 text-xs font-medium cursor-pointer transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Allow Once / អនុញ្ញាត</span>
            </button>

            {item.risk !== 'danger' && (
              <button
                type="button"
                onClick={() => onDecide(item.id, true, true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/35 text-cyan-200 text-xs font-medium cursor-pointer transition-colors"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>Allow Tool (This Session)</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onDecide(item.id, false, false)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/35 text-rose-200 text-xs font-medium cursor-pointer transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              <span>Deny / បដិសេធ</span>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
