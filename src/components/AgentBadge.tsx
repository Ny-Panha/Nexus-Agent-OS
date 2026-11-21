import {
  Bot,
  FolderOpen,
  Terminal,
  Globe,
  ShieldCheck,
  ShieldAlert,
  Shield,
} from 'lucide-react';
import type { AgentId, AgentRunState, ToolRisk } from '../../shared/types';

export const AGENT_STYLES: Record<
  AgentId,
  {
    label: string;
    short: string;
    text: string;
    bg: string;
    border: string;
    dot: string;
    hex: string;
  }
> = {
  orchestrator: {
    label: 'Orchestrator',
    short: 'Boss',
    text: 'text-amber-300',
    bg: 'bg-amber-500/12',
    border: 'border-amber-500/30',
    dot: 'bg-amber-400',
    hex: '#F59E0B',
  },
  file: {
    label: 'File Agent',
    short: 'File',
    text: 'text-cyan-300',
    bg: 'bg-cyan-500/12',
    border: 'border-cyan-500/30',
    dot: 'bg-cyan-400',
    hex: '#06B6D4',
  },
  system: {
    label: 'System Agent',
    short: 'System',
    text: 'text-emerald-300',
    bg: 'bg-emerald-500/12',
    border: 'border-emerald-500/30',
    dot: 'bg-emerald-400',
    hex: '#10B981',
  },
  browser: {
    label: 'Browser Agent',
    short: 'Browser',
    text: 'text-violet-300',
    bg: 'bg-violet-500/12',
    border: 'border-violet-500/30',
    dot: 'bg-violet-400',
    hex: '#8B5CF6',
  },
};

export function AgentIcon({ agent, className = 'w-4 h-4' }: { agent: AgentId; className?: string }) {
  if (agent === 'file') return <FolderOpen className={className} />;
  if (agent === 'system') return <Terminal className={className} />;
  if (agent === 'browser') return <Globe className={className} />;
  return <Bot className={className} />;
}

export function AgentPill({ agent, compact = false }: { agent: AgentId; compact?: boolean }) {
  const s = AGENT_STYLES[agent];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-medium ${s.bg} ${s.border} ${s.text}`}
    >
      <AgentIcon agent={agent} className="w-3 h-3" />
      <span>{compact ? s.short : s.label}</span>
    </span>
  );
}

export function StateBadge({ state }: { state: AgentRunState }) {
  if (state === 'thinking') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-300">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        Thinking
      </span>
    );
  }
  if (state === 'running_tool') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-cyan-300">
        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
        Running
      </span>
    );
  }
  if (state === 'waiting_approval') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-rose-300 font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
        Approval
      </span>
    );
  }
  if (state === 'done') {
    return <span className="text-[11px] text-emerald-400/90">Done</span>;
  }
  if (state === 'error') {
    return <span className="text-[11px] text-rose-400">Error</span>;
  }
  return <span className="text-[11px] text-slate-500">Idle</span>;
}

export function RiskBadge({ risk }: { risk: ToolRisk }) {
  if (risk === 'danger') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-500/15 border border-rose-500/35 text-rose-300 text-[10px] font-semibold uppercase tracking-wide">
        <ShieldAlert className="w-3 h-3" />
        Danger
      </span>
    );
  }
  if (risk === 'write') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/35 text-amber-300 text-[10px] font-semibold uppercase tracking-wide">
        <Shield className="w-3 h-3" />
        Write
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-[10px] font-semibold uppercase tracking-wide">
      <ShieldCheck className="w-3 h-3" />
      Read
    </span>
  );
}
