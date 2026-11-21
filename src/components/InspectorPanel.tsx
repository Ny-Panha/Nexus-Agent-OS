import { useMemo, useState } from 'react';
import {
  User,
  GitBranch,
  TerminalSquare,
  Monitor,
  X,
  RefreshCw,
  Camera,
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
  ArrowRight,
  HardDrive,
  Cpu,
  Clock,
  ChevronRight,
  ChevronDown,
  Bot,
  FileText,
  ExternalLink,
  Pin,
} from 'lucide-react';
import {
  AGENT_ROSTER,
  type AgentHandoff,
  type AgentId,
  type AgentRunState,
  type AuditLogEntry,
  type ChatSession,
  type PlanStep,
  type ProviderAccountStatus,
  type SystemTelemetry,
  type TargetMode,
  type ToolCallTrace,
  type UiLanguage,
} from '../../shared/types';
import { AGENT_STYLES, AgentIcon, AgentPill, RiskBadge } from './AgentBadge';
import { t } from '../lib/i18n';

export type InspectorTab = 'profile' | 'mesh' | 'logs' | 'laptop';

interface InspectorPanelProps {
  language: UiLanguage;
  targetMode: TargetMode;
  activeSession: ChatSession | null;
  activeProvider?: ProviderAccountStatus;
  agentStates: Record<AgentId, { state: AgentRunState; detail?: string }>;
  livePlan: PlanStep[];
  liveHandoffs: AgentHandoff[];
  liveTraces: ToolCallTrace[];
  auditLogs: AuditLogEntry[];
  telemetry: SystemTelemetry | null;
  telemetryLoading: boolean;
  initialTab?: InspectorTab;
  tab?: InspectorTab;
  onTabChange?: (tab: InspectorTab) => void;
  closable?: boolean;
  onClose?: () => void;
  onRefreshTelemetry: () => void;
  onQuickScreenshot: () => Promise<string | null>;
}

export function InspectorPanel({
  language,
  targetMode,
  activeSession,
  activeProvider,
  agentStates,
  livePlan,
  liveHandoffs,
  liveTraces,
  auditLogs,
  telemetry,
  telemetryLoading,
  initialTab = 'profile',
  tab: externalTab,
  onTabChange,
  closable = true,
  onClose,
  onRefreshTelemetry,
  onQuickScreenshot,
}: InspectorPanelProps) {
  const copy = t(language);
  const [internalTab, setInternalTab] = useState<InspectorTab>(initialTab);
  const tab = externalTab !== undefined ? externalTab : internalTab;
  const setTab = (next: InspectorTab) => {
    setInternalTab(next);
    onTabChange?.(next);
  };
  const [mediaSubTab, setMediaSubTab] = useState<'media' | 'files' | 'links' | 'pinned'>('media');
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [quickShot, setQuickShot] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  const selectedAgentId: AgentId = targetMode === 'auto' ? 'orchestrator' : targetMode;
  const agentMeta = AGENT_ROSTER.find((a) => a.id === selectedAgentId) || AGENT_ROSTER[0];
  const agentLive = agentStates[selectedAgentId] || { state: 'idle' };

  const extracted = useMemo(() => {
    const msgs = activeSession?.messages || [];
    const screenshots: Array<{ label: string; dataUrl: string; filePath?: string }> = [];
    const files = new Set<string>();
    const links = new Set<string>();

    for (const m of msgs) {
      if (m.screenshots) screenshots.push(...m.screenshots);
      const urlMatches = m.content.match(/https?:\/\/[^\s)>\]]+/g) || [];
      urlMatches.forEach((u) => links.add(u));
      const winPathMatches = m.content.match(/[A-Za-z]:\\[^\s`'")\]]+/g) || [];
      winPathMatches.forEach((p) => files.add(p));
      for (const tr of m.toolTraces || []) {
        const argPath = tr.args?.path || tr.args?.filePath || tr.args?.directory;
        if (typeof argPath === 'string' && argPath.trim()) files.add(argPath.trim());
      }
    }

    const pinned = msgs.filter((m) => activeSession?.pinnedMessageIds?.includes(m.id));
    return {
      screenshots,
      files: Array.from(files).slice(0, 20),
      links: Array.from(links).slice(0, 20),
      pinned,
    };
  }, [activeSession]);

  const handleShot = async () => {
    setCapturing(true);
    try {
      const dataUrl = await onQuickScreenshot();
      if (dataUrl) setQuickShot(dataUrl);
    } finally {
      setCapturing(false);
    }
  };

  const isAgentBusy = (id: AgentId) => {
    const s = agentStates[id]?.state;
    return s === 'thinking' || s === 'running_tool' || s === 'waiting_approval';
  };

  const statusText =
    agentLive.state === 'thinking' || agentLive.state === 'running_tool'
      ? copy.working
      : agentLive.state === 'error'
        ? copy.failed
        : agentLive.state === 'waiting_approval'
          ? copy.waiting
          : activeProvider?.signedIn
            ? copy.ready
            : copy.notSignedIn;

  const statusDot =
    agentLive.state === 'error' || !activeProvider?.signedIn
      ? 'bg-rose-400'
      : agentLive.state === 'thinking' || agentLive.state === 'running_tool'
        ? 'bg-amber-400 animate-pulse'
        : 'bg-emerald-400';

  return (
    <aside className="w-[324px] shrink-0 h-full rounded-xl border nexus-panel flex flex-col overflow-hidden">
      {/* Compact Icon Tab Strip + Close */}
      <div className="h-[46px] px-2.5 border-b border-white/[0.07] flex items-center justify-between gap-1 shrink-0">
        <div className="flex items-center gap-0.5">
          {(
            [
              { id: 'profile', label: copy.profile, icon: User },
              { id: 'mesh', label: copy.mesh, icon: GitBranch },
              { id: 'logs', label: copy.logs, icon: TerminalSquare },
              { id: 'laptop', label: copy.laptop, icon: Monitor },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                title={item.label}
                className={`h-7 px-2 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                  active
                    ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'text-[var(--text-muted)] hover:bg-white/[0.05] hover:text-[var(--text-primary)]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {active && <span>{item.label}</span>}
              </button>
            );
          })}
        </div>

        {closable && onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inspector"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:bg-white/[0.06] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* TAB 1: AGENT PROFILE + MEDIA/FILES/LINKS/PINNED (Rex Desk Inspired) */}
        {tab === 'profile' && (
          <>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-white/[0.07] border border-white/[0.12] flex items-center justify-center shrink-0">
                  {selectedAgentId === 'orchestrator' ? (
                    <Bot className="w-5 h-5" style={{ color: 'var(--accent)' }} />
                  ) : (
                    <span className={AGENT_STYLES[selectedAgentId].text}>
                      <AgentIcon agent={selectedAgentId} className="w-5 h-5" />
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--text-primary)] truncate">
                    {agentMeta.name}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] mt-0.5">
                    <span className={`w-2 h-2 rounded-full ${statusDot}`} />
                    <span>{statusText}</span>
                  </div>
                </div>
              </div>

              <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                {agentMeta.description}
              </p>
            </div>

            {/* Segmented Media / Files / Links / Pinned */}
            <div className="space-y-3">
              <div className="text-xs font-medium text-[var(--text-secondary)]">
                Media, files and links
              </div>
              <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-black/25 border border-white/[0.06]">
                {(
                  [
                    { id: 'media', label: copy.media },
                    { id: 'files', label: copy.files },
                    { id: 'links', label: copy.links },
                    { id: 'pinned', label: copy.pinned },
                  ] as const
                ).map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => setMediaSubTab(sub.id)}
                    className={`py-1.5 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                      mediaSubTab === sub.id
                        ? 'bg-white/[0.1] text-[var(--text-primary)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                    }`}
                  >
                    {sub.label}
                  </button>
                ))}
              </div>

              <div className="min-h-[84px]">
                {mediaSubTab === 'media' && (
                  extracted.screenshots.length === 0 && !quickShot ? (
                    <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                      {copy.noMediaYet}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {quickShot && (
                        <img
                          src={quickShot}
                          alt="Desktop capture"
                          className="w-full rounded-lg border border-white/[0.1]"
                        />
                      )}
                      {extracted.screenshots.map((s, i) => (
                        <img
                          key={i}
                          src={s.dataUrl}
                          alt={s.label}
                          className="w-full rounded-lg border border-white/[0.1]"
                        />
                      ))}
                    </div>
                  )
                )}

                {mediaSubTab === 'files' && (
                  extracted.files.length === 0 ? (
                    <p className="text-xs text-[var(--text-muted)]">No files referenced in this chat yet.</p>
                  ) : (
                    <div className="divide-y divide-white/[0.06]">
                      {extracted.files.map((f) => (
                        <div key={f} className="py-1.5 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                          <FileText className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                          <span className="font-mono text-[11px] truncate">{f}</span>
                        </div>
                      ))}
                    </div>
                  )
                )}

                {mediaSubTab === 'links' && (
                  extracted.links.length === 0 ? (
                    <p className="text-xs text-[var(--text-muted)]">No links found in this chat yet.</p>
                  ) : (
                    <div className="divide-y divide-white/[0.06]">
                      {extracted.links.map((u) => (
                        <a
                          key={u}
                          href={u}
                          target="_blank"
                          rel="noreferrer"
                          className="py-1.5 flex items-center gap-2 text-[11px] hover:underline truncate"
                          style={{ color: 'var(--accent)' }}
                        >
                          <ExternalLink className="w-3 h-3 shrink-0" />
                          <span className="truncate">{u}</span>
                        </a>
                      ))}
                    </div>
                  )
                )}

                {mediaSubTab === 'pinned' && (
                  extracted.pinned.length === 0 ? (
                    <p className="text-xs text-[var(--text-muted)]">
                      Hover any assistant reply and click the pin icon to keep it here.
                    </p>
                  ) : (
                    <div className="divide-y divide-white/[0.06]">
                      {extracted.pinned.map((pm) => (
                        <div key={pm.id} className="py-2 flex items-start gap-2 text-xs text-[var(--text-secondary)]">
                          <Pin className="w-3 h-3 mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
                          <p className="line-clamp-3 leading-relaxed">{pm.content}</p>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>
            </div>

            {/* Expandable Tools Summary Row */}
            <div className="pt-3 border-t border-white/[0.07]">
              <button
                type="button"
                onClick={() => setToolsExpanded((v) => !v)}
                className="w-full py-1 flex items-center justify-between text-xs cursor-pointer group"
              >
                <span className="text-[var(--text-primary)] font-medium">
                  {copy.toolsAndCapabilities}{' '}
                  <span className="text-[var(--text-muted)] font-normal ml-1 tabular-nums">
                    {agentMeta.capabilities.length} skills
                  </span>
                </span>
                {toolsExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                )}
              </button>

              {toolsExpanded && (
                <div className="mt-2 divide-y divide-white/[0.05]">
                  {agentMeta.capabilities.map((cap) => (
                    <div key={cap} className="py-1.5 text-xs text-[var(--text-secondary)]">
                      {cap}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* TAB 2: LIVE AGENT MESH & PLAN */}
        {tab === 'mesh' && (
          <div className="space-y-4">
            <div className="rounded-xl bg-black/25 border border-white/[0.07] p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Live Agent Mesh
                </span>
                <span className="text-[10px] text-[var(--text-muted)]">Real-time</span>
              </div>

              <svg viewBox="0 0 310 185" className="w-full h-[175px]">
                {(
                  [
                    { id: 'file', x: 52, color: AGENT_STYLES.file.hex },
                    { id: 'system', x: 155, color: AGENT_STYLES.system.hex },
                    { id: 'browser', x: 258, color: AGENT_STYLES.browser.hex },
                  ] as const
                ).map((target) => {
                  const active =
                    isAgentBusy(target.id) ||
                    liveHandoffs.some((h) => h.to === target.id && h.status === 'running');
                  const used = liveHandoffs.some((h) => h.to === target.id);
                  return (
                    <line
                      key={target.id}
                      x1={155}
                      y1={62}
                      x2={target.x}
                      y2={122}
                      stroke={active || used ? target.color : 'rgba(255,255,255,0.14)'}
                      strokeWidth={active ? 2.4 : used ? 1.8 : 1.1}
                      strokeDasharray={active ? '5 4' : undefined}
                      className={active ? 'edge-active' : ''}
                    />
                  );
                })}

                <g transform="translate(88, 14)">
                  <rect
                    width="134"
                    height="48"
                    rx="10"
                    fill={isAgentBusy('orchestrator') ? 'rgba(96, 165, 250, 0.18)' : 'rgba(255,255,255,0.03)'}
                    stroke={isAgentBusy('orchestrator') ? '#60A5FA' : 'rgba(255,255,255,0.14)'}
                    strokeWidth={isAgentBusy('orchestrator') ? 1.8 : 1}
                  />
                  <text x="67" y="21" textAnchor="middle" fill="#E7EDF6" fontSize="11" fontWeight="600">
                    Nexus Agent
                  </text>
                  <text x="67" y="37" textAnchor="middle" fill="#94A3B8" fontSize="9.5">
                    {agentStates.orchestrator?.state || 'idle'}
                  </text>
                </g>

                {(
                  [
                    { id: 'file', x: 8, label: 'File', hex: '#22D3EE' },
                    { id: 'system', x: 111, label: 'System', hex: '#34D399' },
                    { id: 'browser', x: 214, label: 'Browser', hex: '#A78BFA' },
                  ] as const
                ).map((node) => {
                  const busy = isAgentBusy(node.id);
                  return (
                    <g key={node.id} transform={`translate(${node.x}, 122)`}>
                      <rect
                        width="88"
                        height="46"
                        rx="10"
                        fill={busy ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.025)'}
                        stroke={busy ? node.hex : 'rgba(255,255,255,0.12)'}
                        strokeWidth={busy ? 1.8 : 1}
                      />
                      <text x="44" y="20" textAnchor="middle" fill={node.hex} fontSize="10.5" fontWeight="600">
                        {node.label}
                      </text>
                      <text x="44" y="35" textAnchor="middle" fill="#94A3B8" fontSize="9">
                        {agentStates[node.id]?.state || 'idle'}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            <div className="space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Mission Plan
              </div>
              {livePlan.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">
                  Multi-agent steps appear here automatically during active tasks.
                </p>
              ) : (
                <div className="divide-y divide-white/[0.06] border-t border-b border-white/[0.06]">
                  {livePlan.map((step, i) => (
                    <div key={step.id} className="py-2 flex items-start gap-2">
                      <div className="mt-0.5 shrink-0">
                        {step.status === 'completed' ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        ) : step.status === 'in_progress' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--accent)' }} />
                        ) : step.status === 'failed' ? (
                          <XCircle className="w-3.5 h-3.5 text-rose-400" />
                        ) : (
                          <Circle className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-[var(--text-primary)] truncate">
                            {i + 1}. {step.title}
                          </span>
                          <AgentPill agent={step.agent} compact />
                        </div>
                        {step.detail && (
                          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{step.detail}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {liveHandoffs.length > 0 && (
              <div className="space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Handoffs ({liveHandoffs.length})
                </div>
                <div className="divide-y divide-white/[0.06]">
                  {liveHandoffs.map((h) => (
                    <div key={h.id} className="py-2 space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="flex items-center gap-1.5">
                          <AgentPill agent={h.from} compact />
                          <ArrowRight className="w-3 h-3 text-[var(--text-muted)]" />
                          <AgentPill agent={h.to} compact />
                        </span>
                        <span className="text-[var(--text-muted)]">{h.status}</span>
                      </div>
                      <p className="text-[11px] text-[var(--text-secondary)]">{h.task}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: ACTIVITY & AUDIT LOGS */}
        {tab === 'logs' && (
          <div className="space-y-4">
            {liveTraces.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>
                  Current Run ({liveTraces.length})
                </div>
                <div className="divide-y divide-white/[0.06] border-t border-b border-white/[0.06]">
                  {liveTraces
                    .slice()
                    .reverse()
                    .map((tr) => (
                      <div key={tr.id} className="py-2 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <code className="text-[11px] font-mono text-[var(--text-primary)] truncate">
                            {tr.toolName}
                          </code>
                          <RiskBadge risk={tr.risk} />
                        </div>
                        {tr.output && (
                          <pre className="text-[10px] font-mono text-[var(--text-muted)] bg-black/30 rounded p-2 max-h-28 overflow-auto whitespace-pre-wrap">
                            {tr.output.slice(0, 800)}
                          </pre>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Security Audit Log ({auditLogs.length})
              </div>
              {auditLogs.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">No activity recorded yet.</p>
              ) : (
                <div className="divide-y divide-white/[0.06]">
                  {auditLogs.slice(0, 35).map((log) => (
                    <div key={log.id} className="py-2 space-y-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <code className="text-[11px] font-mono text-[var(--text-primary)] truncate">
                          {log.toolName}
                        </code>
                        <span className="text-[10px] text-[var(--text-muted)] tabular-nums shrink-0">
                          {new Date(log.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)] truncate">
                        {log.decision} · {log.status} {log.durationMs ? `· ${log.durationMs}ms` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: LIVE WINDOWS LAPTOP MONITOR */}
        {tab === 'laptop' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Windows Telemetry
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleShot()}
                  disabled={capturing}
                  className="h-7 px-2.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-[11px] text-[var(--text-primary)] inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  <Camera className="w-3 h-3" />
                  <span>{capturing ? 'Capturing...' : 'Capture'}</span>
                </button>
                <button
                  type="button"
                  onClick={onRefreshTelemetry}
                  disabled={telemetryLoading}
                  className="w-7 h-7 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] flex items-center justify-center text-[var(--text-secondary)] cursor-pointer"
                  title="Refresh"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${telemetryLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {quickShot && (
              <img
                src={quickShot}
                alt="Live desktop"
                className="w-full rounded-xl border border-white/[0.1]"
              />
            )}

            {telemetry ? (
              <div className="space-y-4">
                <div className="space-y-2 pb-3 border-b border-white/[0.07]">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-[var(--text-primary)]">{telemetry.hostname}</span>
                    <span className="text-[11px] text-emerald-400">{telemetry.username}</span>
                  </div>
                  <div className="text-[11px] text-[var(--text-secondary)] flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
                    <span className="truncate">
                      {telemetry.cpuModel} ({telemetry.cpuCores}T)
                    </span>
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 shrink-0" />
                    <span className="tabular-nums">
                      Win {telemetry.osRelease} · Uptime {telemetry.uptimeHours}h
                    </span>
                  </div>
                  <div className="pt-1 tabular-nums">
                    <div className="flex justify-between text-[11px] mb-1">
                      <span className="text-[var(--text-muted)]">Memory (RAM)</span>
                      <span className="text-[var(--text-primary)] font-mono">
                        {(telemetry.totalMemoryGb - telemetry.freeMemoryGb).toFixed(1)} / {telemetry.totalMemoryGb} GB ({telemetry.usedMemoryPercent}%)
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${telemetry.usedMemoryPercent}%`,
                          backgroundColor:
                            telemetry.usedMemoryPercent > 85 ? '#FB7185' : 'var(--accent)',
                        }}
                      />
                    </div>
                  </div>
                </div>

                {telemetry.drives.length > 0 && (
                  <div className="space-y-2 pb-3 border-b border-white/[0.07] tabular-nums">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                      <HardDrive className="w-3 h-3" />
                      <span>Drives</span>
                    </div>
                    {telemetry.drives.map((d) => {
                      const pct = d.totalGb > 0 ? Math.round((d.usedGb / d.totalGb) * 100) : 0;
                      return (
                        <div key={d.name}>
                          <div className="flex justify-between text-[11px] mb-1 font-mono">
                            <span className="text-[var(--text-primary)]">{d.name}:\</span>
                            <span className="text-[var(--text-muted)]">
                              {d.freeGb} GB free / {d.totalGb} GB
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                            <div
                              className="h-full rounded-full bg-emerald-400/80"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {telemetry.topProcesses.length > 0 && (
                  <div className="space-y-1.5 tabular-nums">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      Top Memory Processes
                    </div>
                    {telemetry.topProcesses.slice(0, 7).map((p) => (
                      <div key={`${p.name}-${p.pid}`} className="flex justify-between text-[11px] font-mono">
                        <span className="text-[var(--text-secondary)] truncate pr-2">{p.name}</span>
                        <span className="text-[var(--text-muted)] shrink-0">{p.memMb} MB</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-[var(--text-muted)] py-8 text-center">Loading telemetry...</div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
