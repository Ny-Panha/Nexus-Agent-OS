import { useState } from 'react';
import {
  Plus,
  Settings,
  Trash2,
  Bell,
  Workflow,
  FolderOpen,
  Columns2,
  ChevronDown,
  ChevronRight,
  Camera,
  Terminal,
  Globe,
  Bot,
  MessageSquare,
  Palette,
  Sparkles,
} from 'lucide-react';
import {
  AGENT_ROSTER,
  type AgentId,
  type AgentRunState,
  type AppSettings,
  type ChatSession,
  type ProviderAccountStatus,
  type TargetMode,
} from '../../shared/types';
import { AGENT_STYLES, AgentIcon } from './AgentBadge';
import { t } from '../lib/i18n';

interface SidebarProps {
  settings: AppSettings;
  providers: ProviderAccountStatus[];
  agentStates: Record<AgentId, { state: AgentRunState; detail?: string }>;
  sessions: ChatSession[];
  activeSessionId: string | null;
  targetMode: TargetMode;
  needsYouCount: number;
  splitView: boolean;
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onSelectTarget: (target: TargetMode) => void;
  onClickNeedsYou: () => void;
  onToggleSplitView: () => void;
  onQuickScreenshot: () => void;
  onOpenWorkspaceFolder: () => void;
  onOpenSettings: (section?: string) => void;
  onCycleTheme: () => void;
  onToggleGlass: () => void;
}

export function Sidebar({
  settings,
  providers,
  agentStates,
  sessions,
  activeSessionId,
  targetMode,
  needsYouCount,
  splitView,
  onNewSession,
  onSelectSession,
  onDeleteSession,
  onSelectTarget,
  onClickNeedsYou,
  onToggleSplitView,
  onQuickScreenshot,
  onOpenWorkspaceFolder,
  onOpenSettings,
  onCycleTheme,
  onToggleGlass,
}: SidebarProps) {
  const copy = t(settings.language);
  const [roomsOpen, setRoomsOpen] = useState(true);
  const [agentsOpen, setAgentsOpen] = useState(true);

  const activeProvider = providers.find((p) => p.id === settings.provider) || providers[0];
  const orchState = agentStates.orchestrator?.state || 'idle';
  const orchStatusLabel =
    orchState === 'thinking' || orchState === 'running_tool'
      ? copy.working
      : orchState === 'waiting_approval'
        ? copy.waiting
        : orchState === 'error'
          ? copy.failed
          : activeProvider?.signedIn
            ? copy.ready
            : copy.asleep;

  return (
    <aside className="w-[248px] shrink-0 h-full rounded-xl border nexus-panel flex flex-col overflow-hidden select-none">
      {/* Primary Agent Hero Card */}
      <div className="p-2.5">
        <button
          type="button"
          onClick={() => onSelectTarget('auto')}
          className={`w-full px-3 py-2.5 rounded-xl border flex items-center gap-2.5 text-left transition-colors cursor-pointer ${
            targetMode === 'auto'
              ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
              : 'border-[var(--border-subtle)] hover:bg-white/[0.04]'
          }`}
        >
          <div className="relative w-8 h-8 rounded-full bg-white/[0.08] border border-white/[0.12] flex items-center justify-center shrink-0">
            <Bot className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[var(--bg-panel)] ${
                orchState === 'thinking' || orchState === 'running_tool'
                  ? 'bg-amber-400 animate-pulse'
                  : orchState === 'error'
                    ? 'bg-rose-400'
                    : activeProvider?.signedIn
                      ? 'bg-emerald-400'
                      : 'bg-slate-500'
              }`}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-[var(--text-primary)] truncate leading-tight">
              Nexus Agent
            </div>
            <div className="text-[11px] text-[var(--text-muted)] truncate mt-0.5">
              {orchStatusLabel}
            </div>
          </div>
        </button>
      </div>

      {/* Primary Nav Items */}
      <nav className="px-2 space-y-0.5">
        <button
          type="button"
          onClick={onClickNeedsYou}
          className="w-full px-2.5 py-2 rounded-lg flex items-center justify-between gap-2 text-xs text-[var(--text-secondary)] hover:bg-white/[0.05] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-2.5">
            <Bell className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            <span>{copy.needsYou}</span>
          </span>
          {needsYouCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-[10px] font-semibold tabular-nums">
              {needsYouCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => onOpenSettings('workflows')}
          className="w-full px-2.5 py-2 rounded-lg flex items-center gap-2.5 text-xs text-[var(--text-secondary)] hover:bg-white/[0.05] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
        >
          <Workflow className="w-3.5 h-3.5 text-[var(--text-muted)]" />
          <span>{copy.tasks}</span>
        </button>

        <button
          type="button"
          onClick={() => onOpenSettings('folders')}
          className="w-full px-2.5 py-2 rounded-lg flex items-center gap-2.5 text-xs text-[var(--text-secondary)] hover:bg-white/[0.05] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
        >
          <FolderOpen className="w-3.5 h-3.5 text-[var(--text-muted)]" />
          <span className="truncate">{copy.knowledge}</span>
        </button>

        <button
          type="button"
          onClick={onToggleSplitView}
          className={`w-full px-2.5 py-2 rounded-lg flex items-center justify-between gap-2 text-xs transition-colors cursor-pointer ${
            splitView
              ? 'bg-white/[0.08] text-[var(--text-primary)] font-medium'
              : 'text-[var(--text-secondary)] hover:bg-white/[0.05] hover:text-[var(--text-primary)]'
          }`}
        >
          <span className="flex items-center gap-2.5">
            <Columns2
              className="w-3.5 h-3.5"
              style={{ color: splitView ? 'var(--accent)' : 'var(--text-muted)' }}
            />
            <span>{copy.splitView}</span>
          </span>
          {splitView && (
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--accent)' }} />
          )}
        </button>
      </nav>

      {/* Scrollable Sections: Meeting Rooms (Sessions) + Agents */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4 mt-1 border-t border-white/[0.06]">
        {/* MEETING ROOMS / SESSIONS */}
        <section>
          <div className="px-1.5 mb-1.5 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setRoomsOpen((v) => !v)}
              className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer"
            >
              {roomsOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <span>{copy.meetingRooms}</span>
              <span className="px-1.5 py-0.2 rounded-full bg-white/[0.06] text-[10px] tabular-nums">
                {sessions.length}
              </span>
            </button>
            <button
              type="button"
              onClick={onNewSession}
              title={copy.newChat}
              className="p-1 rounded hover:bg-white/[0.08] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {roomsOpen && (
            <div className="space-y-0.5">
              {sessions.length === 0 ? (
                <button
                  type="button"
                  onClick={onNewSession}
                  className="w-full px-2.5 py-2 rounded-lg text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-white/[0.04] text-left cursor-pointer"
                >
                  + {copy.newChat}
                </button>
              ) : (
                sessions.slice(0, 14).map((session) => {
                  const active = session.id === activeSessionId;
                  return (
                    <div
                      key={session.id}
                      className={`group flex items-center justify-between gap-1 px-2.5 py-1.5 rounded-lg transition-colors ${
                        active
                          ? 'bg-white/[0.08] text-[var(--text-primary)]'
                          : 'text-[var(--text-secondary)] hover:bg-white/[0.04] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectSession(session.id)}
                        className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
                      >
                        <MessageSquare className="w-3 h-3 shrink-0 opacity-60" />
                        <span className="text-xs truncate">{session.title}</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteSession(session.id);
                        }}
                        aria-label="Delete session"
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-rose-500/20 hover:text-rose-300 transition-opacity cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </section>

        {/* SPECIALIST AGENTS */}
        <section>
          <div className="px-1.5 mb-1.5 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setAgentsOpen((v) => !v)}
              className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer"
            >
              {agentsOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <span>{copy.agents}</span>
              <span className="px-1.5 py-0.2 rounded-full bg-white/[0.06] text-[10px] tabular-nums">
                {AGENT_ROSTER.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onOpenSettings('agents')}
              title="Configure agents"
              className="p-1 rounded hover:bg-white/[0.08] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {agentsOpen && (
            <div className="space-y-0.5">
              {AGENT_ROSTER.map((agent) => {
                const live = agentStates[agent.id] || { state: 'idle' };
                const style = AGENT_STYLES[agent.id];
                const selected =
                  (targetMode === 'auto' && agent.id === 'orchestrator') || targetMode === agent.id;
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => onSelectTarget(agent.id === 'orchestrator' ? 'auto' : agent.id)}
                    className={`w-full px-2.5 py-1.5 rounded-lg flex items-center justify-between gap-2 text-left transition-colors cursor-pointer ${
                      selected
                        ? 'bg-white/[0.08] text-[var(--text-primary)]'
                        : 'text-[var(--text-secondary)] hover:bg-white/[0.04] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className={style.text}>
                        <AgentIcon agent={agent.id} className="w-3.5 h-3.5" />
                      </span>
                      <span className="text-xs truncate">{agent.name}</span>
                    </span>
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        live.state === 'thinking' || live.state === 'running_tool'
                          ? 'bg-amber-400 animate-pulse'
                          : live.state === 'waiting_approval' || live.state === 'error'
                            ? 'bg-rose-400'
                            : selected
                              ? 'bg-emerald-400'
                              : 'bg-white/15'
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Bottom Utility Dock (Rex Desk Studio Style) */}
      <div className="p-2.5 border-t border-white/[0.07] space-y-2">
        {/* Quick Laptop Action Icons */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onQuickScreenshot}
            title="Quick Desktop Screenshot"
            className="w-8 h-8 rounded-full flex items-center justify-center transition-opacity cursor-pointer hover:opacity-90"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            <Camera className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onSelectTarget('system')}
            title="System / PowerShell Agent"
            className="w-8 h-8 rounded-full bg-white/[0.05] hover:bg-white/[0.1] flex items-center justify-center text-[var(--text-secondary)] cursor-pointer transition-colors"
          >
            <Terminal className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onOpenWorkspaceFolder}
            title="Open Default Workspace Folder"
            className="w-8 h-8 rounded-full bg-white/[0.05] hover:bg-white/[0.1] flex items-center justify-center text-[var(--text-secondary)] cursor-pointer transition-colors"
          >
            <FolderOpen className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onSelectTarget('browser')}
            title="Browser Research Agent"
            className="w-8 h-8 rounded-full bg-white/[0.05] hover:bg-white/[0.1] flex items-center justify-center text-[var(--text-secondary)] cursor-pointer transition-colors"
          >
            <Globe className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Active Account Profile Pill */}
        <button
          type="button"
          onClick={() => onOpenSettings('accounts')}
          className="w-full px-2.5 py-2 rounded-xl border border-white/[0.08] bg-black/20 hover:bg-white/[0.05] flex items-center justify-between gap-2 text-left transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-2 min-w-0">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                activeProvider?.signedIn ? 'bg-emerald-400' : 'bg-rose-400'
              }`}
            />
            <span className="text-xs font-medium text-[var(--text-primary)] shrink-0">
              {activeProvider?.shortName || 'Gemini'}
            </span>
            <span className="text-[11px] text-[var(--text-muted)] truncate">
              {activeProvider?.activeSlotId && activeProvider.activeSlotId !== 'slot-1'
                ? `Slot ${activeProvider.activeSlotId.replace('slot-', '')}`
                : activeProvider?.id === 'gemini_agy'
                  ? 'Antigravity'
                  : activeProvider?.accountLabel
                    ? activeProvider.accountLabel.split('@')[0]
                    : 'Account 1'}
            </span>
          </span>
          <span className="text-[10px] font-mono text-[var(--text-muted)] shrink-0">v2.0</span>
        </button>

        {/* Settings | Theme | Glass */}
        <div className="grid grid-cols-3 gap-1 pt-0.5">
          <button
            type="button"
            onClick={() => onOpenSettings('general')}
            className="px-1.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center justify-center gap-1 cursor-pointer truncate"
          >
            <Settings className="w-3 h-3 shrink-0" />
            <span className="truncate">{copy.settings}</span>
          </button>
          <button
            type="button"
            onClick={onCycleTheme}
            title={`Theme: ${settings.theme} (click to cycle)`}
            className="px-1.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center justify-center gap-1 cursor-pointer truncate"
          >
            <Palette className="w-3 h-3 shrink-0" />
            <span className="truncate">{copy.theme}</span>
          </button>
          <button
            type="button"
            onClick={onToggleGlass}
            title="Toggle Glass Transparency"
            className="px-1.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center justify-center gap-1 cursor-pointer truncate"
          >
            <Sparkles className="w-3 h-3 shrink-0" />
            <span className="truncate">{copy.glass}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
