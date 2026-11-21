import { useEffect, useRef, useState } from 'react';
import {
  PanelLeft,
  PanelRight,
  Columns2,
  Plus,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Pin,
  Loader2,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import {
  AGENT_ROSTER,
  type AgentHandoff,
  type AgentId,
  type AppSettings,
  type ChatMessage,
  type EffortLevel,
  type PendingApproval,
  type PlanStep,
  type ProviderAccountStatus,
  type ProviderType,
  type SafetyMode,
  type TargetMode,
  type ToolCallTrace,
  type WorkflowPreset,
} from '../../shared/types';
import { AgentPill, RiskBadge } from './AgentBadge';
import { ComposerBar } from './ComposerBar';
import { InlineApprovalCard, NeedsAttentionCard } from './NeedsAttentionCard';
import { t } from '../lib/i18n';

interface ChatPanelProps {
  sessionTitle: string;
  messages: ChatMessage[];
  pinnedIds: string[];
  targetMode: TargetMode;
  settings: AppSettings;
  providers: ProviderAccountStatus[];
  presets: WorkflowPreset[];
  isRunning: boolean;
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  splitView: boolean;
  liveNotes: Array<{ agent: AgentId; text: string }>;
  liveStreamText: string;
  livePlan: PlanStep[];
  liveHandoffs: AgentHandoff[];
  liveTraces: ToolCallTrace[];
  pendingApprovals: PendingApproval[];
  onToggleSidebar: () => void;
  onToggleInspector: () => void;
  onToggleSplitView: () => void;
  onNewSession: () => void;
  onChangeTarget: (t: TargetMode) => void;
  onSend: (prompt: string) => void;
  onStop: () => void;
  onRunPreset: (preset: WorkflowPreset) => void;
  onSelectProvider: (provider: ProviderType) => void;
  onSelectModel: (provider: ProviderType, modelId: string) => void;
  onSelectEffort: (effort: EffortLevel) => void;
  onSelectPermission: (mode: SafetyMode) => void;
  onDecideApproval: (approvalId: string, approved: boolean, rememberForSession?: boolean) => void;
  onTriggerLogin: (provider: ProviderType) => Promise<void>;
  onRefreshProviders: () => Promise<void>;
  onTogglePin: (messageId: string) => void;
  onQuickScreenshot: () => void;
  onOpenCommandPalette: () => void;
  onOpenSettings: (section?: string) => void;
}

function FormattedProse({ text, sizeClass }: { text: string; sizeClass: string }) {
  const segments = text.split(/(```[\s\S]*?```)/g);
  return (
    <div className={`space-y-2.5 leading-relaxed text-[var(--text-primary)] break-words ${sizeClass}`}>
      {segments.map((seg, idx) => {
        if (seg.startsWith('```') && seg.endsWith('```')) {
          const inner = seg.slice(3, -3).replace(/^[a-zA-Z0-9_-]+\n/, '');
          return (
            <pre
              key={idx}
              className="rounded-xl bg-black/35 border border-white/[0.08] p-3 text-[12px] font-mono text-[var(--text-primary)] overflow-x-auto"
            >
              <code>{inner}</code>
            </pre>
          );
        }
        return (
          <div key={idx} className="whitespace-pre-wrap">
            {seg.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, pIdx) => {
              if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
                return (
                  <code
                    key={pIdx}
                    className="px-1.5 py-0.5 rounded bg-white/[0.08] font-mono text-[12px]"
                    style={{ color: 'var(--accent)' }}
                  >
                    {part.slice(1, -1)}
                  </code>
                );
              }
              if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
                return (
                  <strong key={pIdx} className="font-semibold text-[var(--text-primary)]">
                    {part.slice(2, -2)}
                  </strong>
                );
              }
              return <span key={pIdx}>{part}</span>;
            })}
          </div>
        );
      })}
    </div>
  );
}

function CollapsibleSteps({ traces, language }: { traces: ToolCallTrace[]; language: AppSettings['language'] }) {
  const copy = t(language);
  const [open, setOpen] = useState(false);
  if (!traces.length) return null;

  const headline = traces[traces.length - 1]?.toolName || 'Executed tools';

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <span className="font-semibold tabular-nums">
          {traces.length} {traces.length === 1 ? copy.step : copy.steps}
        </span>
        <span className="text-[var(--text-muted)] truncate max-w-[320px]">{headline}</span>
      </button>

      {open && (
        <div className="mt-2 rounded-xl border border-white/[0.08] bg-black/20 divide-y divide-white/[0.06] overflow-hidden">
          {traces.map((tr) => (
            <div key={tr.id} className="px-3 py-2 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <AgentPill agent={tr.agent} compact />
                  <code className="text-[11px] font-mono truncate" style={{ color: 'var(--accent)' }}>
                    {tr.toolName}
                  </code>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <RiskBadge risk={tr.risk} />
                  <span
                    className={`text-[10px] ${
                      tr.status === 'completed'
                        ? 'text-emerald-400'
                        : tr.status === 'denied' || tr.status === 'error'
                          ? 'text-rose-400'
                          : 'text-amber-300'
                    }`}
                  >
                    {tr.status}
                  </span>
                </div>
              </div>
              {tr.output && (
                <pre className="text-[11px] font-mono text-[var(--text-muted)] bg-black/30 rounded-lg p-2 max-h-32 overflow-auto whitespace-pre-wrap">
                  {tr.output.slice(0, 1200)}
                </pre>
              )}
              {tr.error && <div className="text-[11px] text-rose-300">{tr.error}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatTokenShort(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function ChatPanel({
  sessionTitle,
  messages,
  pinnedIds,
  targetMode,
  settings,
  providers,
  presets,
  isRunning,
  sidebarOpen,
  inspectorOpen,
  splitView,
  liveNotes,
  liveStreamText,
  liveHandoffs,
  liveTraces,
  pendingApprovals,
  onToggleSidebar,
  onToggleInspector,
  onToggleSplitView,
  onNewSession,
  onChangeTarget,
  onSend,
  onStop,
  onRunPreset,
  onSelectProvider,
  onSelectModel,
  onSelectEffort,
  onSelectPermission,
  onDecideApproval,
  onTriggerLogin,
  onRefreshProviders,
  onTogglePin,
  onQuickScreenshot,
  onOpenCommandPalette,
  onOpenSettings,
}: ChatPanelProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isRunning) {
      setElapsedSec(0);
      return;
    }
    const start = Date.now();
    const id = window.setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - start) / 1000));
    }, 500);
    return () => window.clearInterval(id);
  }, [isRunning]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, liveTraces, liveHandoffs, liveNotes, liveStreamText, pendingApprovals]);

  const activeAgentMeta =
    AGENT_ROSTER.find((a) => a.id === (targetMode === 'auto' ? 'orchestrator' : targetMode)) ||
    AGENT_ROSTER[0];

  const textSizeClass =
    settings.textSize === 'small'
      ? 'text-[13px]'
      : settings.textSize === 'large'
        ? 'text-[15.5px]'
        : 'text-[14px]';

  const handleCopy = (id: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1500);
  };

  return (
    <main className="flex-1 min-w-0 h-full rounded-xl border nexus-panel flex flex-col overflow-hidden">
      {/* Slim Panel Header */}
      <header className="h-[46px] shrink-0 px-3.5 border-b border-white/[0.07] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onToggleSidebar}
            title={sidebarOpen ? 'Hide Sidebar' : 'Show Sidebar'}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:bg-white/[0.06] hover:text-[var(--text-primary)] cursor-pointer shrink-0"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0 flex items-center gap-2">
            <h1 className="text-[13.5px] font-semibold text-[var(--text-primary)] truncate">
              {activeAgentMeta.name}
            </h1>
            {messages.length > 0 && (
              <span className="hidden md:inline text-xs text-[var(--text-muted)] truncate max-w-[260px]">
                · {sessionTitle}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onNewSession}
            title="New chat mission"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:bg-white/[0.06] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onToggleSplitView}
            title="Toggle Split View"
            className={`w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer transition-colors ${
              splitView
                ? 'bg-white/[0.09] text-[var(--accent)]'
                : 'text-[var(--text-muted)] hover:bg-white/[0.06] hover:text-[var(--text-primary)]'
            }`}
          >
            <Columns2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onToggleInspector}
            title={inspectorOpen ? 'Hide Inspector' : 'Show Inspector'}
            className={`w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer transition-colors ${
              inspectorOpen
                ? 'bg-white/[0.09] text-[var(--text-primary)]'
                : 'text-[var(--text-muted)] hover:bg-white/[0.06] hover:text-[var(--text-primary)]'
            }`}
          >
            <PanelRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Scrollable Clean Message Stream */}
      <div className="flex-1 overflow-y-auto px-5 py-6">
        {messages.length === 0 && !isRunning && pendingApprovals.length === 0 ? (
          <div className="max-w-2xl mx-auto pt-8 space-y-6">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--accent)' }}>
                <Sparkles className="w-3.5 h-3.5" />
                <span>{activeAgentMeta.name}</span>
              </div>
              <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
                {settings.language === 'km'
                  ? `សួស្តី ${settings.userName || 'Nha'}! ថ្ងៃនេះចង់ធ្វើការងារអ្វីដែរ?`
                  : `Ready when you are, ${settings.userName || 'Nha'}`}
              </h2>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                {settings.language === 'km'
                  ? 'រើសគណនី AI (Gemini, Codex, Claude ឬ Local AI) នៅខាងក្រោមប្រអប់ chat ហើយបញ្ជាការងារផ្ទាល់ដោយមិនបាច់ប្រើ API key។'
                  : 'Switch between your signed-in Gemini, Codex, Claude, or offline Local AI accounts right in the composer below—no API keys needed.'}
              </p>
            </div>

            {/* Clean flat workflow rows (No nested rainbow cards!) */}
            <div className="rounded-xl border border-white/[0.08] divide-y divide-white/[0.06] overflow-hidden">
              {presets.slice(0, 4).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onRunPreset(preset)}
                  className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-white/[0.04] transition-colors cursor-pointer group"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">
                      {preset.name}
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] truncate mt-0.5">
                      {preset.khmerLabel || preset.description}
                    </div>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-[var(--text-muted)] group-hover:text-[var(--accent)] shrink-0 transition-transform group-hover:translate-x-0.5" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-5">
            {messages.map((msg) => {
              // 1. Provider Handoff Divider
              if (msg.kind === 'handoff_divider') {
                return (
                  <div
                    key={msg.id}
                    className="py-2 flex items-center justify-center text-center text-[11px] text-[var(--text-muted)]"
                  >
                    <span>
                      {msg.content} · {new Date(msg.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </div>
                );
              }

              // 2. Inline Needs Attention Card
              if (msg.kind === 'needs_attention') {
                return (
                  <div key={msg.id}>
                    <NeedsAttentionCard
                      language={settings.language}
                      message={msg.content}
                      action={msg.actionCta}
                      onTriggerLogin={onTriggerLogin}
                      onRefreshProviders={onRefreshProviders}
                      onOpenAccountsSettings={() => onOpenSettings('accounts')}
                    />
                  </div>
                );
              }

              // 3. User Message Pill (Right Aligned, Clean)
              if (msg.role === 'user') {
                return (
                  <div key={msg.id} className="flex justify-end">
                    <div
                      className={`max-w-[78%] rounded-2xl px-4 py-2.5 bg-white/[0.09] text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap break-words ${textSizeClass}`}
                    >
                      {msg.content}
                    </div>
                  </div>
                );
              }

              // 4. Clean Borderless Assistant Message (Rex Desk Style)
              const isPinned = pinnedIds.includes(msg.id);
              return (
                <article key={msg.id} className="group space-y-2">
                  {msg.toolTraces && msg.toolTraces.length > 0 && (
                    <CollapsibleSteps traces={msg.toolTraces} language={settings.language} />
                  )}

                  {msg.error ? (
                    <div className="rounded-xl border border-rose-500/40 bg-rose-950/15 p-3.5 text-xs text-rose-200">
                      {msg.content}
                    </div>
                  ) : (
                    <FormattedProse text={msg.content} sizeClass={textSizeClass} />
                  )}

                  {/* Inline Screenshots */}
                  {msg.screenshots && msg.screenshots.length > 0 && (
                    <div className="pt-1 space-y-2">
                      {msg.screenshots.map((shot, idx) => (
                        <div
                          key={idx}
                          className="rounded-xl overflow-hidden border border-white/[0.1] bg-black"
                        >
                          <img src={shot.dataUrl} alt={shot.label} className="w-full h-auto block" />
                          {shot.filePath && (
                            <div className="px-3 py-1.5 text-[10px] font-mono text-[var(--text-muted)] bg-black/50 truncate">
                              {shot.filePath}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Subtle Token Footnote & Quiet Actions */}
                  <div className="flex items-center gap-3 pt-0.5 text-[11px] text-[var(--text-muted)] tabular-nums">
                    {msg.usage && (
                      <span>
                        {formatTokenShort(msg.usage.inputTokens)} in · {formatTokenShort(msg.usage.outputTokens)} out tokens
                      </span>
                    )}
                    {msg.model && <span className="opacity-75">· {msg.model}</span>}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => handleCopy(msg.id, msg.content)}
                        title="Copy reply"
                        className="p-1 rounded hover:bg-white/[0.08] hover:text-[var(--text-primary)] cursor-pointer"
                      >
                        {copiedId === msg.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => onTogglePin(msg.id)}
                        title={isPinned ? 'Unpin' : 'Pin to Inspector'}
                        className={`p-1 rounded hover:bg-white/[0.08] cursor-pointer ${
                          isPinned ? 'text-[var(--accent)] opacity-100' : 'hover:text-[var(--text-primary)]'
                        }`}
                      >
                        <Pin className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}

            {/* Inline Pending Tool Approvals */}
            {pendingApprovals.map((app) => (
              <InlineApprovalCard
                key={app.id}
                language={settings.language}
                approval={app}
                onDecide={onDecideApproval}
              />
            ))}

            {/* Quiet Live Run Indicator + Live Streamed Text */}
            {isRunning && (
              <div className="space-y-2.5 py-1">
                <div className="inline-flex items-center gap-2 text-xs text-[var(--text-secondary)] tabular-nums">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--accent)' }} />
                  <span>
                    {liveTraces.length > 0
                      ? `${liveTraces.length} step${liveTraces.length > 1 ? 's' : ''} · ${liveTraces[liveTraces.length - 1].toolName}`
                      : liveStreamText
                        ? 'Streaming reply...'
                        : 'Thinking...'}
                  </span>
                  {elapsedSec > 0 && (
                    <span className="text-[11px] text-[var(--text-muted)]">{elapsedSec}s</span>
                  )}
                </div>

                {liveStreamText && (
                  <div className="pl-5">
                    <FormattedProse text={liveStreamText} sizeClass={textSizeClass} />
                  </div>
                )}

                {liveNotes.length > 0 && !liveStreamText && (
                  <p className="text-xs text-[var(--text-muted)] pl-5 leading-relaxed">
                    {liveNotes[liveNotes.length - 1].text}
                  </p>
                )}

                {liveHandoffs.length > 0 && (
                  <div className="pl-5 space-y-1">
                    {liveHandoffs.map((h) => (
                      <div key={h.id} className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                        <AgentPill agent={h.to} compact />
                        <span className="truncate">{h.task}</span>
                        <span style={{ color: 'var(--accent)' }}>{h.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div ref={endRef} />
          </div>
        )}
      </div>

      {/* Unified Bottom Composer */}
      <ComposerBar
        settings={settings}
        providers={providers}
        presets={presets}
        messages={messages}
        targetMode={targetMode}
        isRunning={isRunning}
        onSend={onSend}
        onStop={onStop}
        onSelectProvider={onSelectProvider}
        onSelectModel={onSelectModel}
        onSelectEffort={onSelectEffort}
        onSelectPermission={onSelectPermission}
        onSelectTarget={onChangeTarget}
        onRunPreset={onRunPreset}
        onTriggerLogin={(p) => void onTriggerLogin(p)}
        onQuickScreenshot={onQuickScreenshot}
        onOpenCommandPalette={onOpenCommandPalette}
      />
    </main>
  );
}
