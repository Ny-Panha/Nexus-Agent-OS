import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  ArrowUp,
  Square,
  ChevronDown,
  Check,
  HelpCircle,
  Camera,
  FolderOpen,
  Sparkles,
  LogIn,
} from 'lucide-react';
import type {
  AppSettings,
  ChatMessage,
  EffortLevel,
  ProviderAccountStatus,
  ProviderType,
  SafetyMode,
  TargetMode,
  WorkflowPreset,
} from '../../shared/types';
import { t } from '../lib/i18n';
import { ContextRingPopover } from './ContextRingPopover';

type ActivePopover = 'provider' | 'model' | 'effort' | 'permission' | 'attach' | null;

const EFFORT_OPTIONS: Array<{ id: EffortLevel; label: string; desc: string }> = [
  { id: 'low', label: 'Low', desc: 'Fast, light thinking' },
  { id: 'medium', label: 'Medium', desc: 'Balanced' },
  { id: 'high', label: 'High', desc: 'Thinks longer' },
  { id: 'xhigh', label: 'Extra high', desc: 'Thinks a lot longer' },
  { id: 'max', label: 'Max', desc: 'Longest thinking, slowest' },
];

const PERMISSION_OPTIONS: Array<{ id: SafetyMode; label: string; desc: string }> = [
  { id: 'full_auto', label: 'Dangerous', desc: 'Runs tools without asking' },
  { id: 'smart', label: 'Workspace', desc: 'Asks you for risky tools, in the chat' },
  { id: 'read_only', label: 'Read only', desc: 'Plans only, runs nothing' },
];

interface ComposerBarProps {
  settings: AppSettings;
  providers: ProviderAccountStatus[];
  presets: WorkflowPreset[];
  messages: ChatMessage[];
  targetMode: TargetMode;
  isRunning: boolean;
  onSend: (prompt: string) => void;
  onStop: () => void;
  onSelectProvider: (provider: ProviderType) => void;
  onSelectModel: (provider: ProviderType, modelId: string) => void;
  onSelectEffort: (effort: EffortLevel) => void;
  onSelectPermission: (mode: SafetyMode) => void;
  onSelectTarget: (target: TargetMode) => void;
  onRunPreset: (preset: WorkflowPreset) => void;
  onTriggerLogin: (provider: ProviderType) => void;
  onQuickScreenshot: () => void;
  onOpenCommandPalette: () => void;
}

export function ComposerBar({
  settings,
  providers,
  presets,
  messages,
  targetMode,
  isRunning,
  onSend,
  onStop,
  onSelectProvider,
  onSelectModel,
  onSelectEffort,
  onSelectPermission,
  onSelectTarget,
  onRunPreset,
  onTriggerLogin,
  onQuickScreenshot,
  onOpenCommandPalette,
}: ComposerBarProps) {
  const copy = t(settings.language);
  const [input, setInput] = useState('');
  const [popover, setPopover] = useState<ActivePopover>(null);
  const [modelFilter, setModelFilter] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!popover) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setPopover(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopover(null);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [popover]);

  const activeProvider = providers.find((p) => p.id === settings.provider) || providers[0];
  const rawModelId =
    settings.selectedModels?.[settings.provider] || activeProvider?.defaultModel || '';
  const strippedModelId = rawModelId.replace(/-(low|medium|high|xhigh|max)$/i, '');
  const currentModelOption =
    activeProvider?.models.find((m) => m.id === rawModelId) ||
    activeProvider?.models.find((m) => m.id === strippedModelId);
  const currentModelId = currentModelOption?.id || rawModelId;
  const currentModelLabel =
    currentModelOption?.label ||
    (currentModelId && currentModelId !== 'default' ? currentModelId : 'Choose...');

  const currentEffort = EFFORT_OPTIONS.find((e) => e.id === settings.effort) || EFFORT_OPTIONS[1];
  const currentPermission =
    PERMISSION_OPTIONS.find((p) => p.id === settings.safetyMode) || PERMISSION_OPTIONS[1];

  const slashSuggestions = useMemo(() => {
    if (!input.startsWith('/')) return [];
    const q = input.slice(1).trim().toLowerCase();
    const base = [
      { id: 'cmd-auto', cmd: '/auto', desc: 'Route to Nexus Orchestrator team', run: () => onSelectTarget('auto') },
      { id: 'cmd-file', cmd: '/file', desc: 'Talk directly to File Agent', run: () => onSelectTarget('file') },
      { id: 'cmd-system', cmd: '/system', desc: 'Talk directly to System Agent', run: () => onSelectTarget('system') },
      { id: 'cmd-browser', cmd: '/browser', desc: 'Talk directly to Browser Agent', run: () => onSelectTarget('browser') },
      { id: 'cmd-shot', cmd: '/screenshot', desc: 'Capture desktop screenshot now', run: () => onQuickScreenshot() },
      ...presets.map((p) => ({
        id: `cmd-wf-${p.id}`,
        cmd: `/${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        desc: p.khmerLabel || p.name,
        run: () => onRunPreset(p),
      })),
    ];
    if (!q) return base.slice(0, 7);
    return base.filter((b) => b.cmd.includes(q) || b.desc.toLowerCase().includes(q)).slice(0, 7);
  }, [input, presets, onSelectTarget, onQuickScreenshot, onRunPreset]);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || isRunning) return;
    if (trimmed.startsWith('/') && slashSuggestions.length > 0 && trimmed === slashSuggestions[0].cmd) {
      slashSuggestions[0].run();
      setInput('');
      return;
    }
    setInput('');
    onSend(trimmed);
  };

  const filteredModels = (activeProvider?.models || []).filter(
    (m) =>
      !modelFilter.trim() ||
      m.label.toLowerCase().includes(modelFilter.toLowerCase()) ||
      m.id.toLowerCase().includes(modelFilter.toLowerCase()),
  );

  return (
    <div ref={wrapRef} className="px-4 pb-3 pt-2 shrink-0">
      <div className="max-w-3xl mx-auto relative">
        {/* Slash Command Menu */}
        {slashSuggestions.length > 0 && (
          <div
            className="absolute left-0 right-0 bottom-full mb-2 rounded-xl border shadow-2xl overflow-hidden z-40 py-1"
            style={{
              backgroundColor: 'var(--bg-elevated)',
              borderColor: 'var(--border-strong)',
            }}
          >
            {slashSuggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  s.run();
                  setInput('');
                }}
                className="w-full px-3.5 py-2 flex items-center justify-between gap-3 text-left hover:bg-white/[0.06] cursor-pointer"
              >
                <span className="text-xs font-mono font-medium" style={{ color: 'var(--accent)' }}>
                  {s.cmd}
                </span>
                <span className="text-[11px] text-[var(--text-muted)] truncate">{s.desc}</span>
              </button>
            ))}
          </div>
        )}

        {/* Rounded Main Input Container */}
        <div
          className="flex items-end gap-2 rounded-2xl border px-3 py-2 transition-colors focus-within:border-[var(--border-strong)]"
          style={{
            backgroundColor: 'var(--bg-elevated)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          {/* Attach (+) button */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setPopover((p) => (p === 'attach' ? null : 'attach'))}
              title="Attach context or action"
              className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:bg-white/[0.07] hover:text-[var(--text-primary)] transition-colors cursor-pointer shrink-0"
            >
              <Plus className="w-4 h-4" />
            </button>

            {popover === 'attach' && (
              <div
                className="absolute left-0 bottom-full mb-2 w-56 rounded-xl border shadow-2xl p-1.5 z-40 space-y-0.5"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  borderColor: 'var(--border-strong)',
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setInput((prev) =>
                      prev
                        ? `${prev} [${settings.defaultWorkspace}]`
                        : `Inspect folder ${settings.defaultWorkspace} and `,
                    );
                    setPopover(null);
                  }}
                  className="w-full px-2.5 py-2 rounded-lg text-xs text-left flex items-center gap-2 text-[var(--text-primary)] hover:bg-white/[0.07] cursor-pointer"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-[var(--accent)]" />
                  <span>Reference Workspace</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onQuickScreenshot();
                    setPopover(null);
                  }}
                  className="w-full px-2.5 py-2 rounded-lg text-xs text-left flex items-center gap-2 text-[var(--text-primary)] hover:bg-white/[0.07] cursor-pointer"
                >
                  <Camera className="w-3.5 h-3.5 text-[var(--accent)]" />
                  <span>Capture Laptop Screen</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setInput('/');
                    setPopover(null);
                  }}
                  className="w-full px-2.5 py-2 rounded-lg text-xs text-left flex items-center gap-2 text-[var(--text-primary)] hover:bg-white/[0.07] cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[var(--accent)]" />
                  <span>Insert / Command</span>
                </button>
              </div>
            )}
          </div>

          <textarea
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder={
              targetMode === 'auto'
                ? copy.composerPlaceholder(activeProvider?.shortName || 'Nexus')
                : `Message @${targetMode} via ${activeProvider?.shortName || 'Nexus'}...`
            }
            className="flex-1 bg-transparent resize-none outline-none text-[13.5px] leading-6 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] py-1 max-h-36"
          />

          {isRunning ? (
            <button
              type="button"
              onClick={onStop}
              title="Stop run"
              className="w-8 h-8 rounded-full bg-rose-500 hover:bg-rose-400 text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!input.trim()}
              title="Send message"
              className="w-8 h-8 rounded-full flex items-center justify-center transition-opacity cursor-pointer shrink-0 disabled:opacity-35"
              style={{
                backgroundColor: 'var(--accent)',
                color: 'var(--accent-fg)',
              }}
            >
              <ArrowUp className="w-4 h-4 stroke-[2.4]" />
            </button>
          )}
        </div>

        {/* Bottom Control Strip (One Home for Provider, Model, Effort, Permission, Context) */}
        <div className="mt-2 px-1 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={onOpenCommandPalette}
            className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors cursor-pointer"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>{copy.typeSlashHint}</span>
          </button>

          <div className="flex items-center gap-1 flex-wrap">
            {/* 1. Provider Picker */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setPopover((p) => (p === 'provider' ? null : 'provider'))}
                className={`h-7 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border transition-colors cursor-pointer ${
                  popover === 'provider'
                    ? 'border-[var(--accent)] text-[var(--text-primary)] bg-white/[0.06]'
                    : 'border-transparent text-[var(--text-primary)] hover:bg-white/[0.06]'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    activeProvider?.signedIn ? 'bg-emerald-400' : 'bg-rose-400'
                  }`}
                />
                <span>{activeProvider?.shortName || 'Gemini'}</span>
                <ChevronDown className="w-3 h-3 text-[var(--text-muted)]" />
              </button>

              {popover === 'provider' && (
                <div
                  className="absolute right-0 bottom-full mb-2 w-[320px] rounded-2xl border shadow-2xl p-1.5 z-40 space-y-0.5"
                  style={{
                    backgroundColor: 'var(--bg-elevated)',
                    borderColor: 'var(--border-strong)',
                  }}
                >
                  {providers.map((p) => {
                    const selected = p.id === settings.provider;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          onSelectProvider(p.id);
                          setPopover(null);
                        }}
                        className={`w-full px-3 py-2.5 rounded-xl text-left flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                          selected ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className="text-xs font-semibold"
                              style={{ color: selected ? 'var(--accent)' : 'var(--text-primary)' }}
                            >
                              {p.name}
                            </span>
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                p.signedIn ? 'bg-emerald-400' : 'bg-rose-400'
                              }`}
                            />
                          </div>
                          <div className="text-[11px] text-[var(--text-muted)] truncate mt-0.5">
                            {p.subtitle}
                          </div>
                        </div>
                        {selected && (
                          <Check className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 2. Model Picker (Dynamic per Signed-in Account) */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setModelFilter('');
                  setPopover((p) => (p === 'model' ? null : 'model'));
                }}
                className={`h-7 px-2.5 rounded-lg text-xs inline-flex items-center gap-1 border max-w-[170px] transition-colors cursor-pointer ${
                  popover === 'model'
                    ? 'border-[var(--accent)] text-[var(--text-primary)] bg-white/[0.06]'
                    : 'border-transparent text-[var(--text-secondary)] hover:bg-white/[0.06] hover:text-[var(--text-primary)]'
                }`}
              >
                <span className="truncate">{currentModelLabel}</span>
                <ChevronDown className="w-3 h-3 text-[var(--text-muted)] shrink-0" />
              </button>

              {popover === 'model' && (
                <div
                  className="absolute right-0 bottom-full mb-2 w-[300px] rounded-2xl border shadow-2xl p-2 z-40"
                  style={{
                    backgroundColor: 'var(--bg-elevated)',
                    borderColor: 'var(--border-strong)',
                  }}
                >
                  {!activeProvider?.signedIn ? (
                    <div className="p-2.5 space-y-2.5">
                      <div className="text-xs font-medium text-[var(--text-primary)]">
                        {activeProvider?.name} is not signed in
                      </div>
                      <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                        Sign in with your account to automatically load available models.
                      </p>
                      {activeProvider && (
                        <button
                          type="button"
                          onClick={() => {
                            onTriggerLogin(activeProvider.id);
                            setPopover(null);
                          }}
                          className="w-full h-8 rounded-lg text-xs font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer"
                          style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
                        >
                          <LogIn className="w-3.5 h-3.5" />
                          <span>{activeProvider.loginActionLabel || 'Sign in'}</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      {activeProvider.models.length > 6 && (
                        <input
                          type="text"
                          value={modelFilter}
                          onChange={(e) => setModelFilter(e.target.value)}
                          placeholder="Filter models..."
                          className="w-full mb-1.5 px-2.5 py-1.5 rounded-lg bg-black/25 border border-white/[0.08] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
                        />
                      )}
                      <div className="max-h-64 overflow-y-auto space-y-0.5">
                        {filteredModels.length === 0 ? (
                          <div className="px-2.5 py-4 text-center text-xs text-[var(--text-muted)]">
                            No models available yet.
                          </div>
                        ) : (
                          filteredModels.map((m) => {
                            const selected = m.id === currentModelId;
                            return (
                              <button
                                key={m.id}
                                type="button"
                                onClick={() => {
                                  onSelectModel(activeProvider.id, m.id);
                                  setPopover(null);
                                }}
                                className={`w-full px-2.5 py-2 rounded-lg text-left flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                                  selected ? 'bg-white/[0.08]' : 'hover:bg-white/[0.05]'
                                }`}
                              >
                                <div className="min-w-0">
                                  <div
                                    className="text-xs font-medium truncate"
                                    style={{
                                      color: selected ? 'var(--accent)' : 'var(--text-primary)',
                                    }}
                                  >
                                    {m.label}
                                  </div>
                                  {m.description && (
                                    <div className="text-[10px] text-[var(--text-muted)] truncate">
                                      {m.description}
                                    </div>
                                  )}
                                </div>
                                {selected && (
                                  <Check className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
                                )}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* 3. Effort Picker */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setPopover((p) => (p === 'effort' ? null : 'effort'))}
                className={`h-7 px-2.5 rounded-lg text-xs inline-flex items-center gap-1 border transition-colors cursor-pointer ${
                  popover === 'effort'
                    ? 'border-[var(--accent)] text-[var(--text-primary)] bg-white/[0.06]'
                    : 'border-transparent text-[var(--text-secondary)] hover:bg-white/[0.06] hover:text-[var(--text-primary)]'
                }`}
              >
                <span>{currentEffort.label}</span>
                <ChevronDown className="w-3 h-3 text-[var(--text-muted)]" />
              </button>

              {popover === 'effort' && (
                <div
                  className="absolute right-0 bottom-full mb-2 w-[230px] rounded-2xl border shadow-2xl p-1.5 z-40 space-y-0.5"
                  style={{
                    backgroundColor: 'var(--bg-elevated)',
                    borderColor: 'var(--border-strong)',
                  }}
                >
                  {EFFORT_OPTIONS.map((opt) => {
                    const selected = opt.id === settings.effort;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          onSelectEffort(opt.id);
                          setPopover(null);
                        }}
                        className={`w-full px-3 py-2 rounded-xl text-left flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                          selected ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
                        }`}
                      >
                        <div>
                          <div
                            className="text-xs font-semibold"
                            style={{ color: selected ? 'var(--accent)' : 'var(--text-primary)' }}
                          >
                            {opt.label}
                          </div>
                          <div className="text-[11px] text-[var(--text-muted)]">{opt.desc}</div>
                        </div>
                        {selected && (
                          <Check className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 4. Permission Picker */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setPopover((p) => (p === 'permission' ? null : 'permission'))}
                className={`h-7 px-2.5 rounded-lg text-xs inline-flex items-center gap-1 border transition-colors cursor-pointer ${
                  popover === 'permission'
                    ? 'border-[var(--accent)] text-[var(--text-primary)] bg-white/[0.06]'
                    : 'border-transparent text-[var(--text-secondary)] hover:bg-white/[0.06] hover:text-[var(--text-primary)]'
                }`}
              >
                <span
                  className={settings.safetyMode === 'full_auto' ? 'text-rose-300 font-medium' : ''}
                >
                  {currentPermission.label}
                </span>
                <ChevronDown className="w-3 h-3 text-[var(--text-muted)]" />
              </button>

              {popover === 'permission' && (
                <div
                  className="absolute right-0 bottom-full mb-2 w-[265px] rounded-2xl border shadow-2xl p-1.5 z-40 space-y-0.5"
                  style={{
                    backgroundColor: 'var(--bg-elevated)',
                    borderColor: 'var(--border-strong)',
                  }}
                >
                  {PERMISSION_OPTIONS.map((opt) => {
                    const selected =
                      opt.id === settings.safetyMode ||
                      (opt.id === 'smart' && settings.safetyMode === 'safe');
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          onSelectPermission(opt.id);
                          setPopover(null);
                        }}
                        className={`w-full px-3 py-2.5 rounded-xl text-left flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                          selected ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
                        }`}
                      >
                        <div>
                          <div
                            className="text-xs font-semibold"
                            style={{ color: selected ? 'var(--accent)' : 'var(--text-primary)' }}
                          >
                            {opt.label}
                          </div>
                          <div className="text-[11px] text-[var(--text-muted)]">{opt.desc}</div>
                        </div>
                        {selected && (
                          <Check className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 5. Context / Token Usage Ring */}
            <ContextRingPopover
              messages={messages}
              defaultContextWindow={currentModelOption?.contextWindow || 1_000_000}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
