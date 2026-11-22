import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  ArrowUp,
  Square,
  ChevronDown,
  ChevronRight,
  Check,
  HelpCircle,
  Camera,
  FolderOpen,
  Sparkles,
  LogIn,
  RotateCcw,
} from 'lucide-react';
import {
  CLI_SAFETY_SUPPORT,
  type AgentId,
  type AppSettings,
  type ChatMessage,
  type CliEngineKind,
  type EffortLevel,
  type ProviderAccountStatus,
  type ProviderType,
  type SafetyMode,
  type TargetMode,
  type WorkflowPreset,
} from '../../shared/types';
import { t } from '../lib/i18n';
import { ContextRingPopover } from './ContextRingPopover';

type ActivePopover = 'provider' | 'model' | 'effort' | 'permission' | 'attach' | null;

const EFFORT_ORDER: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

const EFFORT_META: Record<EffortLevel, { label: string; desc: string }> = {
  low: { label: 'Low', desc: 'Fast, light thinking' },
  medium: { label: 'Medium', desc: 'Balanced' },
  high: { label: 'High', desc: 'Thinks longer' },
  xhigh: { label: 'Extra High', desc: 'Thinks a lot longer' },
  max: { label: 'Max', desc: 'Maximum reasoning depth' },
};

const PERMISSION_OPTIONS: Array<{ id: SafetyMode; label: string; shortLabel: string; desc: string }> = [
  { id: 'full_auto', label: 'Dangerous', shortLabel: 'Dangerous', desc: 'Runs tools without asking' },
  { id: 'smart', label: 'Smart (Workspace)', shortLabel: 'Smart', desc: 'Workspace edits allowed; guards risky shell actions' },
  { id: 'safe', label: 'Safe', shortLabel: 'Safe', desc: 'Strict safety: asks on API/Ollama; sandbox/plan on headless CLIs' },
  { id: 'read_only', label: 'Read only', shortLabel: 'Read only', desc: 'Plans only, runs nothing' },
];

function clampEffortToSupported(requested: EffortLevel, supported: EffortLevel[]): EffortLevel {
  if (supported.includes(requested)) return requested;
  const reqIdx = EFFORT_ORDER.indexOf(requested);
  // Pick closest supported effort (preferring slightly lower if requested exceeds max, e.g. xhigh -> high)
  let best = supported[0];
  let bestDist = Infinity;
  for (const s of supported) {
    const dist = Math.abs(EFFORT_ORDER.indexOf(s) - reqIdx);
    if (dist < bestDist) {
      bestDist = dist;
      best = s;
    }
  }
  return best;
}

function shortProviderSubtitle(p: ProviderAccountStatus): string {
  if (p.id === 'codex') return p.accountLabel || 'Official ChatGPT Codex CLI';
  if (p.id === 'claude') return p.accountLabel || 'Official Claude Code CLI';
  if (p.id === 'gemini_agy') return p.accountLabel || 'Google Antigravity & Gemini CLI';
  if (p.id === 'ollama') return p.models.length > 0 ? `${p.models.length} local models ready` : 'Offline Ollama';
  return p.subtitle;
}

interface ComposerBarProps {
  settings: AppSettings;
  providers: ProviderAccountStatus[];
  presets: WorkflowPreset[];
  messages: ChatMessage[];
  targetMode: TargetMode;
  isRunning: boolean;
  onSend: (prompt: string) => void;
  onStop: () => void;
  onSelectProvider: (provider: ProviderType, slotId?: string) => void;
  onSelectModel: (provider: ProviderType, modelId: string) => void;
  onSelectEffort: (effort: EffortLevel) => void;
  onSelectPermission: (mode: SafetyMode) => void;
  onSelectTarget: (target: TargetMode) => void;
  onRunPreset: (preset: WorkflowPreset) => void;
  onTriggerLogin: (provider: ProviderType, slotId?: string) => void;
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

  const activeAgentId: AgentId = targetMode === 'auto' ? 'orchestrator' : targetMode;
  const activeRoute = settings.agentRoutes?.[activeAgentId];
  const effectiveProviderId: ProviderType = activeRoute?.provider || settings.provider;
  const activeProvider = providers.find((p) => p.id === effectiveProviderId) || providers[0];
  const activeSlot =
    activeProvider?.slots?.find(
      (s) => s.id === (activeRoute?.slotId || activeProvider.activeSlotId || 'slot-1'),
    ) || activeProvider?.slots?.[0];
  const activeModels = activeSlot ? activeSlot.models : activeProvider?.models || [];
  const activeSignedIn = activeSlot ? activeSlot.signedIn : Boolean(activeProvider?.signedIn);
  const activeEngine: CliEngineKind | 'native' =
    activeSlot?.cliEngine ||
    (effectiveProviderId === 'codex'
      ? 'codex'
      : effectiveProviderId === 'claude'
        ? 'claude'
        : effectiveProviderId === 'gemini_agy'
          ? 'agy'
          : 'native');

  const rawModelId =
    activeRoute?.model ||
    settings.selectedModels?.[effectiveProviderId] ||
    activeSlot?.defaultModel ||
    activeProvider?.defaultModel ||
    '';
  const strippedModelId = rawModelId.replace(/-(low|medium|high|xhigh|max)$/i, '');
  const currentModelOption =
    activeModels.find((m) => m.id === rawModelId) ||
    activeModels.find((m) => m.id === strippedModelId);
  const currentModelId = currentModelOption?.id || rawModelId;
  const currentModelLabel =
    currentModelOption?.label ||
    (currentModelId && currentModelId !== 'default' ? currentModelId : 'Choose model');

  const currentPermission =
    PERMISSION_OPTIONS.find((p) => p.id === settings.safetyMode) || PERMISSION_OPTIONS[1];

  // Exact real supported effort levels for the active engine + model.
  // Empty for Gemini CLI (no --effort flag), Ollama, API keys, and single-variant models (e.g. GPT-OSS 120B / Orchestrator).
  const supportedEfforts = useMemo<EffortLevel[]>(() => {
    if (!activeSignedIn) return [];
    if (activeEngine === 'gemini_cli' || activeEngine === 'native') return [];

    if (currentModelOption?.supportedEfforts && currentModelOption.supportedEfforts.length > 1) {
      return currentModelOption.supportedEfforts;
    }
    if (currentModelOption?.effortVariants) {
      const keys = (Object.keys(currentModelOption.effortVariants) as EffortLevel[]).sort(
        (a, b) => EFFORT_ORDER.indexOf(a) - EFFORT_ORDER.indexOf(b),
      );
      if (keys.length > 1) return keys;
      return [];
    }
    if (activeEngine === 'codex') {
      return ['low', 'medium', 'high', 'xhigh', 'max'];
    }
    if (activeEngine === 'claude') {
      return ['low', 'medium', 'high', 'xhigh', 'max'];
    }
    return [];
  }, [activeSignedIn, activeEngine, currentModelOption]);

  const showEffortPicker = supportedEfforts.length > 1;
  const effectiveEffort: EffortLevel = showEffortPicker
    ? clampEffortToSupported(settings.effort, supportedEfforts)
    : 'medium';
  const activeStopIndex = Math.max(0, supportedEfforts.indexOf(effectiveEffort));
  const activeStopMeta = EFFORT_META[effectiveEffort] || EFFORT_META.medium;
  const isCodexSlider = activeEngine === 'codex';

  const sliderTrackRef = useRef<HTMLDivElement | null>(null);
  const [isDraggingSlider, setIsDraggingSlider] = useState(false);

  const handleSliderSeek = (clientX: number) => {
    if (!sliderTrackRef.current || supportedEfforts.length < 2) return;
    const rect = sliderTrackRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const targetIdx = Math.round(ratio * (supportedEfforts.length - 1));
    const nextEffort = supportedEfforts[targetIdx];
    if (nextEffort && nextEffort !== settings.effort) {
      onSelectEffort(nextEffort);
    }
  };

  const handleSliderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDraggingSlider(true);
    handleSliderSeek(e.clientX);
  };

  const handleSliderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingSlider) return;
    handleSliderSeek(e.clientX);
  };

  const handleSliderPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDraggingSlider(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

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

  const filteredModels = activeModels.filter(
    (m) =>
      !modelFilter.trim() ||
      m.label.toLowerCase().includes(modelFilter.toLowerCase()) ||
      m.id.toLowerCase().includes(modelFilter.toLowerCase()),
  );

  const sliderRatio =
    supportedEfforts.length > 1 ? activeStopIndex / (supportedEfforts.length - 1) : 0;

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

        {/* Clean Single-Row Bottom Control Strip: Left = Engine/Model/Effort (popovers open right) | Right = Safety/Context/Help (popovers open left) */}
        <div className="mt-2 px-0.5 flex items-center justify-between gap-2">
          {/* Left Cluster: Provider -> Model -> Effort (only when supported) */}
          <div className="flex items-center gap-1 min-w-0">
            {/* 1. Provider & Slot Picker (left-0 so it NEVER clips off left wall) */}
            <div className="relative shrink-0">
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
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    activeSignedIn ? 'bg-emerald-400' : 'bg-rose-400'
                  }`}
                />
                <span>
                  {activeProvider?.shortName || effectiveProviderId}
                  {activeSlot && activeSlot.id !== 'slot-1' ? ` · #${activeSlot.id.replace('slot-', '')}` : ''}
                </span>
                <ChevronDown className="w-3 h-3 text-[var(--text-muted)]" />
              </button>

              {popover === 'provider' && (
                <div
                  className="absolute left-0 bottom-full mb-2 w-[288px] max-h-[340px] overflow-y-auto rounded-2xl border shadow-2xl p-1.5 z-40 space-y-0.5"
                  style={{
                    backgroundColor: 'var(--bg-elevated)',
                    borderColor: 'var(--border-strong)',
                  }}
                >
                  {providers.map((p) => {
                    const hasMultiSlots = Boolean(p.slots && p.slots.length > 1);

                    if (hasMultiSlots && p.slots) {
                      return (
                        <div key={p.id} className="pt-1 pb-0.5 space-y-0.5">
                          <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center justify-between">
                            <span>{p.name}</span>
                            <span className="font-mono text-[10px]">
                              {p.slots.filter((s) => s.signedIn).length}/{p.slots.length} active
                            </span>
                          </div>
                          {p.slots.map((slot) => {
                            const isSlotActive =
                              effectiveProviderId === p.id &&
                              (activeRoute?.slotId || activeProvider?.activeSlotId || 'slot-1') === slot.id;
                            const cleanSlotSub =
                              slot.cliEngine === 'agy'
                                ? `Antigravity · ${slot.models.length} models`
                                : slot.cliEngine === 'gemini_cli'
                                  ? slot.signedIn
                                    ? `${slot.accountLabel || 'Gemini CLI'} · ${slot.models.length} models`
                                    : 'Not signed in'
                                  : slot.accountLabel || (slot.signedIn ? `${slot.label} · Active` : 'Not signed in');
                            return (
                              <button
                                key={slot.id}
                                type="button"
                                onClick={() => {
                                  onSelectProvider(p.id, slot.id);
                                  setPopover(null);
                                }}
                                className={`w-full px-2.5 py-2 rounded-xl text-left flex items-center justify-between gap-2.5 transition-colors cursor-pointer ${
                                  isSlotActive ? 'bg-white/[0.09]' : 'hover:bg-white/[0.04]'
                                }`}
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span
                                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                        slot.signedIn ? 'bg-emerald-400' : 'bg-rose-400'
                                      }`}
                                    />
                                    <span
                                      className="text-xs font-semibold truncate"
                                      style={{ color: isSlotActive ? 'var(--accent)' : 'var(--text-primary)' }}
                                    >
                                      {slot.label}
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-[var(--text-muted)] truncate mt-0.5 pl-3">
                                    {cleanSlotSub}
                                  </div>
                                </div>
                                {isSlotActive && (
                                  <Check className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      );
                    }

                    const selected = p.id === effectiveProviderId;
                    const signedSlots = p.slots ? p.slots.filter((s) => s.signedIn).length : p.signedIn ? 1 : 0;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          onSelectProvider(p.id);
                          setPopover(null);
                        }}
                        className={`w-full px-2.5 py-2 rounded-xl text-left flex items-center justify-between gap-2.5 transition-colors cursor-pointer ${
                          selected ? 'bg-white/[0.09]' : 'hover:bg-white/[0.04]'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                signedSlots > 0 ? 'bg-emerald-400' : 'bg-rose-400'
                              }`}
                            />
                            <span
                              className="text-xs font-semibold truncate"
                              style={{ color: selected ? 'var(--accent)' : 'var(--text-primary)' }}
                            >
                              {p.name}
                            </span>
                          </div>
                          <div className="text-[11px] text-[var(--text-muted)] truncate mt-0.5 pl-3">
                            {shortProviderSubtitle(p)}
                          </div>
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

            {/* 2. Model Picker (Dynamic per Signed-in Account Slot, opens right cleanly) */}
            <div className="relative min-w-0">
              <button
                type="button"
                onClick={() => {
                  setModelFilter('');
                  setPopover((p) => (p === 'model' ? null : 'model'));
                }}
                className={`h-7 px-2.5 rounded-lg text-xs inline-flex items-center gap-1 border max-w-[165px] transition-colors cursor-pointer ${
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
                  className="absolute left-0 bottom-full mb-2 w-[280px] rounded-2xl border shadow-2xl p-1.5 z-40"
                  style={{
                    backgroundColor: 'var(--bg-elevated)',
                    borderColor: 'var(--border-strong)',
                  }}
                >
                  {!activeSignedIn ? (
                    <div className="p-2.5 space-y-2.5">
                      <div className="text-xs font-medium text-[var(--text-primary)]">
                        {activeProvider?.name} {activeSlot ? `(${activeSlot.label})` : ''} is not signed in
                      </div>
                      <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                        Sign in to this account slot to load available models.
                      </p>
                      {activeProvider && (
                        <button
                          type="button"
                          onClick={() => {
                            onTriggerLogin(activeProvider.id, activeSlot?.id);
                            setPopover(null);
                          }}
                          className="w-full h-8 rounded-lg text-xs font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer"
                          style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
                        >
                          <LogIn className="w-3.5 h-3.5" />
                          <span>{activeSlot?.loginActionLabel || activeProvider.loginActionLabel || 'Sign in'}</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="px-2.5 pt-1 pb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                        <span>Model</span>
                        <span className="font-mono">{activeModels.length}</span>
                      </div>
                      {activeModels.length > 7 && (
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
                            No models available.
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
                                  selected ? 'bg-white/[0.09]' : 'hover:bg-white/[0.05]'
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
                                    <div className="text-[10px] text-[var(--text-muted)] truncate mt-0.5">
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

            {/* 3. Effort Picker — ONLY shown when the active engine + model ACTUALLY supports multiple effort levels */}
            {showEffortPicker && (
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setPopover((p) => (p === 'effort' ? null : 'effort'))}
                  className={`h-7 px-2.5 rounded-lg text-xs inline-flex items-center gap-1 border transition-colors cursor-pointer ${
                    popover === 'effort'
                      ? 'border-[var(--accent)] text-[var(--text-primary)] bg-white/[0.06]'
                      : 'border-transparent text-[var(--text-secondary)] hover:bg-white/[0.06] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <span>{activeStopMeta.label}</span>
                  <ChevronDown className="w-3 h-3 text-[var(--text-muted)]" />
                </button>

                {/* Codex / ChatGPT Style: Discrete Blue Slider (NO fake lightning icon!) */}
                {popover === 'effort' && isCodexSlider && (
                  <div
                    className="absolute left-0 bottom-full mb-2 w-[232px] rounded-2xl border shadow-2xl p-3 z-40 select-none backdrop-blur-xl"
                    style={{
                      backgroundColor: 'var(--bg-elevated)',
                      borderColor: 'var(--border-strong)',
                    }}
                  >
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div className="w-6 shrink-0" />
                      <div className="flex-1 px-2.5 py-1 rounded-xl bg-white/[0.04] border border-white/[0.06] text-center min-w-0">
                        <div className="text-[13px] font-bold text-sky-400 leading-tight">
                          {activeStopMeta.label}
                        </div>
                        <button
                          type="button"
                          onClick={() => setPopover('model')}
                          title="Change model"
                          className="text-[11px] text-[var(--text-muted)] hover:text-white inline-flex items-center justify-center gap-0.5 truncate max-w-[132px] cursor-pointer mt-0.5 transition-colors"
                        >
                          <span className="truncate">{currentModelLabel}</span>
                          <ChevronRight className="w-3 h-3 shrink-0" />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => onSelectEffort('medium')}
                        title="Reset to Medium"
                        className="w-6 h-6 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/[0.06] transition-colors cursor-pointer shrink-0"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Discrete Slider Track matching exact supportedEfforts count */}
                    <div
                      ref={sliderTrackRef}
                      onPointerDown={handleSliderPointerDown}
                      onPointerMove={handleSliderPointerMove}
                      onPointerUp={handleSliderPointerUp}
                      className="relative h-6 rounded-full bg-white/[0.08] flex items-center cursor-pointer select-none overflow-hidden"
                      style={{ touchAction: 'none' }}
                    >
                      <div
                        className="absolute left-0 top-0 bottom-0 rounded-full bg-sky-500 transition-all duration-150"
                        style={{
                          width: `calc(24px + (100% - 24px) * ${sliderRatio})`,
                        }}
                      />

                      <div className="absolute inset-x-[12px] top-0 bottom-0 flex items-center justify-between pointer-events-none">
                        {supportedEfforts.map((eff, idx) => (
                          <span
                            key={eff}
                            className={`w-1.5 h-1.5 rounded-full transition-colors ${
                              idx <= activeStopIndex ? 'bg-white/85' : 'bg-white/25'
                            }`}
                          />
                        ))}
                      </div>

                      <div
                        className="w-5 h-5 rounded-full bg-white shadow-md absolute top-0.5 -translate-x-1/2 transition-all duration-150 pointer-events-none"
                        style={{
                          left: `calc(12px + (100% - 24px) * ${sliderRatio})`,
                        }}
                      />
                    </div>

                    <div className="mt-2 text-center text-[10px] text-[var(--text-muted)]">
                      {activeStopMeta.desc}
                    </div>
                  </div>
                )}

                {/* Antigravity / Gemini & Claude Style: Clean Thinking Effort List (exact real levels only!) */}
                {popover === 'effort' && !isCodexSlider && (
                  <div
                    className="absolute left-0 bottom-full mb-2 w-[196px] rounded-2xl border shadow-2xl p-1.5 z-40 space-y-0.5"
                    style={{
                      backgroundColor: 'var(--bg-elevated)',
                      borderColor: 'var(--border-strong)',
                    }}
                  >
                    <div className="px-2.5 pt-1 pb-1.5 flex items-center justify-between text-[11px] font-medium text-[var(--text-muted)]">
                      <span>Thinking effort</span>
                      <span className="text-[10px] tabular-nums">{supportedEfforts.length} levels</span>
                    </div>
                    {supportedEfforts.map((eff) => {
                      const meta = EFFORT_META[eff];
                      const selected = eff === effectiveEffort;
                      return (
                        <button
                          key={eff}
                          type="button"
                          onClick={() => {
                            onSelectEffort(eff);
                            setPopover(null);
                          }}
                          className={`w-full px-2.5 py-2 rounded-xl text-left flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                            selected ? 'bg-white/[0.09]' : 'hover:bg-white/[0.05]'
                          }`}
                        >
                          <div className="min-w-0">
                            <div
                              className="text-xs font-medium"
                              style={{ color: selected ? 'var(--accent)' : 'var(--text-primary)' }}
                            >
                              {meta.label}
                            </div>
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
            )}
          </div>

          {/* Right Cluster: Safety Mode + Context Ring + Command Help (popovers open left cleanly) */}
          <div className="flex items-center gap-1 shrink-0">
            {/* 4. Permission Picker */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setPopover((p) => (p === 'permission' ? null : 'permission'))}
                title={currentPermission.label}
                className={`h-7 px-2 rounded-lg text-xs inline-flex items-center gap-1 border transition-colors cursor-pointer ${
                  popover === 'permission'
                    ? 'border-[var(--accent)] text-[var(--text-primary)] bg-white/[0.06]'
                    : 'border-transparent text-[var(--text-secondary)] hover:bg-white/[0.06] hover:text-[var(--text-primary)]'
                }`}
              >
                <span
                  className={settings.safetyMode === 'full_auto' ? 'text-rose-300 font-medium' : ''}
                >
                  {currentPermission.shortLabel}
                </span>
                <ChevronDown className="w-3 h-3 text-[var(--text-muted)]" />
              </button>

              {popover === 'permission' && (
                <div
                  className="absolute right-0 bottom-full mb-2 w-[292px] rounded-2xl border shadow-2xl p-1.5 z-40 space-y-0.5"
                  style={{
                    backgroundColor: 'var(--bg-elevated)',
                    borderColor: 'var(--border-strong)',
                  }}
                >
                  {PERMISSION_OPTIONS.map((opt) => {
                    const selected = opt.id === settings.safetyMode;
                    const enforcement = CLI_SAFETY_SUPPORT[activeEngine][opt.id];
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          onSelectPermission(opt.id);
                          setPopover(null);
                        }}
                        className={`w-full px-3 py-2 rounded-xl text-left flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                          selected ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="text-xs font-semibold"
                              style={{ color: selected ? 'var(--accent)' : 'var(--text-primary)' }}
                            >
                              {opt.label}
                            </span>
                            {enforcement.enforced !== 'full' && (
                              <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">
                                CLI sandbox
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-[var(--text-muted)] leading-snug mt-0.5">
                            {enforcement.note}
                          </div>
                          <div className="text-[10px] font-mono text-sky-300/80 truncate mt-0.5">
                            {enforcement.flagSummary}
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

            {/* 5. Context / Token Usage Ring */}
            <ContextRingPopover
              messages={messages}
              defaultContextWindow={currentModelOption?.contextWindow || 1_000_000}
            />

            {/* 6. Compact Command Palette Shortcut */}
            <button
              type="button"
              onClick={onOpenCommandPalette}
              title={copy.typeSlashHint}
              className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-[var(--text-muted)] hover:bg-white/[0.06] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
