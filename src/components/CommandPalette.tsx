import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  MessageSquare,
  Bot,
  Workflow,
  Settings,
  Plus,
  Sparkles,
  Camera,
  Columns2,
} from 'lucide-react';
import {
  AGENT_ROSTER,
  type ChatSession,
  type ProviderAccountStatus,
  type ProviderType,
  type TargetMode,
  type WorkflowPreset,
} from '../../shared/types';

interface CommandItem {
  id: string;
  group: string;
  title: string;
  subtitle?: string;
  icon: typeof Search;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  sessions: ChatSession[];
  presets: WorkflowPreset[];
  providers: ProviderAccountStatus[];
  onClose: () => void;
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  onSelectTarget: (t: TargetMode) => void;
  onSwitchProvider: (p: ProviderType) => void;
  onRunPreset: (p: WorkflowPreset) => void;
  onToggleSplitView: () => void;
  onQuickScreenshot: () => void;
  onOpenSettings: (section?: string) => void;
}

export function CommandPalette({
  open,
  sessions,
  presets,
  providers,
  onClose,
  onNewSession,
  onSelectSession,
  onSelectTarget,
  onSwitchProvider,
  onRunPreset,
  onToggleSplitView,
  onQuickScreenshot,
  onOpenSettings,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const items = useMemo<CommandItem[]>(() => {
    const list: CommandItem[] = [
      {
        id: 'act-new',
        group: 'Quick Actions',
        title: 'New Mission / Start fresh chat',
        icon: Plus,
        run: () => onNewSession(),
      },
      {
        id: 'act-split',
        group: 'Quick Actions',
        title: 'Toggle Split View',
        subtitle: 'Show Chat + Live Mesh/Monitor side-by-side',
        icon: Columns2,
        run: () => onToggleSplitView(),
      },
      {
        id: 'act-shot',
        group: 'Quick Actions',
        title: 'Capture Desktop Screenshot',
        icon: Camera,
        run: () => onQuickScreenshot(),
      },
      {
        id: 'act-accounts',
        group: 'Quick Actions',
        title: 'Manage AI Accounts (Sign in without API key)',
        icon: Settings,
        run: () => onOpenSettings('accounts'),
      },
    ];

    for (const p of providers) {
      list.push({
        id: `prov-${p.id}`,
        group: 'AI Providers',
        title: `Switch to ${p.name}`,
        subtitle: p.signedIn ? `${p.models.length} models ready` : p.subtitle,
        icon: Sparkles,
        run: () => onSwitchProvider(p.id),
      });
    }

    for (const a of AGENT_ROSTER) {
      list.push({
        id: `agent-${a.id}`,
        group: 'Agents',
        title: a.name,
        subtitle: a.khmerRole,
        icon: Bot,
        run: () => onSelectTarget(a.id === 'orchestrator' ? 'auto' : a.id),
      });
    }

    for (const preset of presets) {
      list.push({
        id: `wf-${preset.id}`,
        group: 'Workflows',
        title: preset.name,
        subtitle: preset.khmerLabel || preset.description,
        icon: Workflow,
        run: () => onRunPreset(preset),
      });
    }

    for (const s of sessions.slice(0, 12)) {
      list.push({
        id: `ses-${s.id}`,
        group: 'Missions',
        title: s.title,
        subtitle: `${s.messages.length} messages`,
        icon: MessageSquare,
        run: () => onSelectSession(s.id),
      });
    }

    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        (i.subtitle || '').toLowerCase().includes(q) ||
        i.group.toLowerCase().includes(q),
    );
  }, [
    providers,
    presets,
    sessions,
    query,
    onNewSession,
    onToggleSplitView,
    onQuickScreenshot,
    onOpenSettings,
    onSwitchProvider,
    onSelectTarget,
    onRunPreset,
    onSelectSession,
  ]);

  if (!open) return null;

  const clampedIdx = Math.min(activeIdx, Math.max(items.length - 1, 0));

  const runSelected = (item?: CommandItem) => {
    if (!item) return;
    item.run();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[12vh] px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[560px] rounded-2xl border shadow-2xl overflow-hidden"
        style={{
          backgroundColor: 'var(--bg-panel)',
          borderColor: 'var(--border-strong)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="px-4 py-3 border-b flex items-center gap-2.5"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <Search className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIdx((i) => Math.min(i + 1, items.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIdx((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                runSelected(items[clampedIdx]);
              }
            }}
            placeholder="Search chats, switch provider, jump to agent or workflow..."
            className="flex-1 bg-transparent outline-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          />
          <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-white/[0.06] text-[var(--text-muted)]">
            ESC
          </kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto py-1.5">
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-[var(--text-muted)]">
              No matching chats, agents, or workflows.
            </div>
          ) : (
            items.map((item, idx) => {
              const Icon = item.icon;
              const prevGroup = idx > 0 ? items[idx - 1].group : null;
              const selected = idx === clampedIdx;
              return (
                <div key={item.id}>
                  {item.group !== prevGroup && (
                    <div className="px-4 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      {item.group}
                    </div>
                  )}
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => runSelected(item)}
                    className={`w-full px-4 py-2 flex items-center gap-3 text-left transition-colors cursor-pointer ${
                      selected ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
                    }`}
                  >
                    <Icon
                      className="w-3.5 h-3.5 shrink-0"
                      style={{ color: selected ? 'var(--accent)' : 'var(--text-muted)' }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-[var(--text-primary)] truncate">
                        {item.title}
                      </div>
                      {item.subtitle && (
                        <div className="text-[11px] text-[var(--text-muted)] truncate">
                          {item.subtitle}
                        </div>
                      )}
                    </div>
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
