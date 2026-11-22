import { useEffect, useState } from 'react';
import {
  X,
  Sun,
  Users,
  KeyRound,
  Cpu,
  Wrench,
  FolderOpen,
  Info,
  RefreshCw,
  LogIn,
  LogOut,
  CheckCircle2,
  Plus,
  Trash2,
  Loader2,
  ExternalLink,
  Pencil,
  RotateCcw,
  Check,
  FileText,
} from 'lucide-react';
import {
  AGENT_ROSTER,
  CLI_SAFETY_SUPPORT,
  type AgentId,
  type AgentRouteConfig,
  type AppSettings,
  type CliAccountProvider,
  type ProviderAccountStatus,
  type ProviderType,
  type StorageStats,
  type TextSize,
  type WorkflowPreset,
} from '../../shared/types';
import { api } from '../lib/api';
import { THEME_SWATCHES, t } from '../lib/i18n';
import { StudioSelect } from './StudioSelect';

export type SettingsSection =
  | 'general'
  | 'accounts'
  | 'agents'
  | 'local_ai'
  | 'workflows'
  | 'folders'
  | 'about';

interface SettingsModalProps {
  open: boolean;
  initialSection?: SettingsSection;
  settings: AppSettings;
  providers: ProviderAccountStatus[];
  presets: WorkflowPreset[];
  onClose: () => void;
  onSaved: (next: AppSettings) => void;
  onProvidersUpdated: (providers: ProviderAccountStatus[]) => void;
  onPresetsChanged: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function SettingsModal({
  open,
  initialSection = 'general',
  settings,
  providers,
  presets,
  onClose,
  onSaved,
  onProvidersUpdated,
  onPresetsChanged,
}: SettingsModalProps) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [form, setForm] = useState<AppSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loginBusy, setLoginBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);

  // Workflow editor form (create + edit)
  const [wfEditingId, setWfEditingId] = useState<string | null>(null);
  const [wfName, setWfName] = useState('');
  const [wfKhmer, setWfKhmer] = useState('');
  const [wfPrompt, setWfPrompt] = useState('');
  const [wfTarget, setWfTarget] = useState<WorkflowPreset['target']>('auto');
  const [wfAgents, setWfAgents] = useState<AgentId[]>(['orchestrator', 'file', 'system']);
  const [wfBusy, setWfBusy] = useState(false);
  const [wfError, setWfError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(settings);
      setSection(initialSection);
      setNotice(null);
      void api.getStorageStats().then((r) => setStorageStats(r.stats)).catch(() => {});
    }
  }, [open, settings, initialSection]);

  if (!open) return null;

  const copy = t(form.language);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { settings: updated } = await api.updateSettings(form);
      onSaved(updated);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleRefreshProviders = async () => {
    setRefreshing(true);
    setNotice(null);
    try {
      const res = await api.refreshProviders();
      onProvidersUpdated(res.providers);
      setNotice('Account statuses & available models refreshed.');
    } finally {
      setRefreshing(false);
    }
  };

  const handleProviderLogin = async (providerId: ProviderType) => {
    setLoginBusy(providerId);
    setNotice(null);
    try {
      const res = await api.loginProvider(providerId);
      onProvidersUpdated(res.providers);
      if (res.settings) {
        setForm(res.settings);
        onSaved(res.settings);
      }
      setNotice(res.message);
    } finally {
      setLoginBusy(null);
    }
  };

  const handleProviderLogout = async (providerId: ProviderType) => {
    setLoginBusy(providerId);
    setNotice(null);
    try {
      const res = await api.logoutProvider(providerId);
      onProvidersUpdated(res.providers);
      if (res.settings) {
        setForm(res.settings);
        onSaved(res.settings);
      }
      setNotice(res.message);
    } finally {
      setLoginBusy(null);
    }
  };

  const handleAddSlot = async (providerId: CliAccountProvider) => {
    setLoginBusy(`add:${providerId}`);
    setNotice(null);
    try {
      const res = await api.addProviderSlot(providerId);
      onProvidersUpdated(res.providers);
      setForm(res.settings);
      onSaved(res.settings);
      setNotice(res.message);
    } finally {
      setLoginBusy(null);
    }
  };

  const handleRemoveSlot = async (providerId: CliAccountProvider, slotId: string) => {
    setLoginBusy(`rm:${providerId}:${slotId}`);
    setNotice(null);
    try {
      const res = await api.removeProviderSlot(providerId, slotId);
      onProvidersUpdated(res.providers);
      setForm(res.settings);
      onSaved(res.settings);
      setNotice(res.message);
    } finally {
      setLoginBusy(null);
    }
  };

  const handleSlotLogin = async (providerId: CliAccountProvider, slotId: string) => {
    setLoginBusy(`login:${providerId}:${slotId}`);
    setNotice(null);
    try {
      const res = await api.loginProviderSlot(providerId, slotId);
      onProvidersUpdated(res.providers);
      if (res.settings) {
        setForm(res.settings);
        onSaved(res.settings);
      }
      setNotice(res.message);
    } finally {
      setLoginBusy(null);
    }
  };

  const handleSlotLogout = async (providerId: CliAccountProvider, slotId: string) => {
    setLoginBusy(`logout:${providerId}:${slotId}`);
    setNotice(null);
    try {
      const res = await api.logoutProviderSlot(providerId, slotId);
      onProvidersUpdated(res.providers);
      if (res.settings) {
        setForm(res.settings);
        onSaved(res.settings);
      }
      setNotice(res.message);
    } finally {
      setLoginBusy(null);
    }
  };

  const handleActivateSlot = async (providerId: CliAccountProvider, slotId: string) => {
    setLoginBusy(`act:${providerId}:${slotId}`);
    setNotice(null);
    try {
      const res = await api.activateProviderSlot(providerId, slotId);
      onProvidersUpdated(res.providers);
      setForm(res.settings);
      onSaved(res.settings);
      setNotice(res.message);
    } finally {
      setLoginBusy(null);
    }
  };

  const getAgentRoute = (agentId: AgentId): AgentRouteConfig => {
    const existing = form.agentRoutes?.[agentId];
    if (existing) return existing;
    if (agentId === 'orchestrator') {
      const codexProv = providers.find((p) => p.id === 'codex');
      return { provider: 'codex', slotId: 'slot-1', model: codexProv?.defaultModel || 'default' };
    }
    return { provider: 'gemini_agy', slotId: 'slot-1', model: 'gemini-3.8-flash' };
  };

  const updateAgentRoute = (agentId: AgentId, patch: Partial<AgentRouteConfig>) => {
    const current = getAgentRoute(agentId);
    const nextProvider = patch.provider ?? current.provider;
    const isCli = nextProvider === 'codex' || nextProvider === 'gemini_agy' || nextProvider === 'claude';
    const provStatus = providers.find((p) => p.id === nextProvider);
    const provSlots = provStatus?.slots || [];

    let nextSlotId = patch.slotId !== undefined ? patch.slotId : current.slotId;
    if (isCli) {
      if (patch.provider && patch.provider !== current.provider) {
        nextSlotId = provSlots[0]?.id || 'slot-1';
      } else if (!nextSlotId || (provSlots.length > 0 && !provSlots.some((s) => s.id === nextSlotId))) {
        nextSlotId = provSlots[0]?.id || 'slot-1';
      }
    } else {
      nextSlotId = undefined;
    }

    let nextModel = patch.model ?? current.model;
    if (patch.provider !== undefined || patch.slotId !== undefined) {
      if (isCli) {
        const slot = provSlots.find((s) => s.id === nextSlotId) || provSlots[0];
        if (agentId === 'orchestrator') {
          nextModel = slot?.defaultModel || provStatus?.defaultModel || 'default';
        } else {
          const flash = slot?.models.find((m) => m.id === 'gemini-3.8-flash') || slot?.models.find((m) => /flash/i.test(m.id));
          nextModel =
            flash?.id ||
            slot?.defaultModel ||
            'gemini-3.8-flash';
        }
      } else if (nextProvider === 'ollama') {
        nextModel = provStatus?.models[0]?.id || form.ollamaModel || 'qwen2.5:7b';
      } else if (nextProvider === 'gemini_api') {
        nextModel = form.geminiModel || 'gemini-3.8-flash';
      } else {
        nextModel = form.openaiModel || 'gpt-4o-mini';
      }
    }

    const baseRoutes: Record<AgentId, AgentRouteConfig> = {
      orchestrator: getAgentRoute('orchestrator'),
      file: getAgentRoute('file'),
      system: getAgentRoute('system'),
      browser: getAgentRoute('browser'),
    };
    baseRoutes[agentId] = {
      provider: nextProvider,
      ...(nextSlotId ? { slotId: nextSlotId } : {}),
      model: nextModel,
    };
    setForm((f) => ({ ...f, agentRoutes: baseRoutes }));
  };

  const handleResetAgentDefaults = () => {
    const codexSlot1 = providers.find((p) => p.id === 'codex')?.slots?.[0];
    const gemSlot1 = providers.find((p) => p.id === 'gemini_agy')?.slots?.[0];
    const strongestCodex =
      codexSlot1?.defaultModel ||
      codexSlot1?.models.find((m) => m.id !== 'default')?.id ||
      'default';
    const flashGem =
      gemSlot1?.models.find((m) => m.id === 'gemini-3.8-flash')?.id ||
      gemSlot1?.models.find((m) => /flash/i.test(m.id))?.id ||
      gemSlot1?.defaultModel ||
      'gemini-3.8-flash';

    setForm((f) => ({
      ...f,
      agentRoutes: {
        orchestrator: { provider: 'codex', slotId: 'slot-1', model: strongestCodex },
        file: { provider: 'gemini_agy', slotId: 'slot-1', model: flashGem },
        system: { provider: 'gemini_agy', slotId: 'slot-1', model: flashGem },
        browser: { provider: 'gemini_agy', slotId: 'slot-1', model: flashGem },
      },
    }));
    setNotice('Reset agent routes to defaults (Orchestrator → Codex Slot 1; Specialists → Gemini Slot 1 Flash). Click Save to persist.');
  };

  const handlePickFolder = async () => {
    if (!window.nexusDesktop?.pickDirectory) return;
    const picked = await window.nexusDesktop.pickDirectory();
    if (picked) setForm((prev) => ({ ...prev, defaultWorkspace: picked }));
  };

  const resetWorkflowForm = () => {
    setWfEditingId(null);
    setWfName('');
    setWfKhmer('');
    setWfPrompt('');
    setWfTarget('auto');
    setWfAgents(['orchestrator', 'file', 'system']);
    setWfError(null);
  };

  const handleEditPreset = (p: WorkflowPreset) => {
    setWfEditingId(p.id);
    setWfName(p.name);
    setWfKhmer(p.khmerLabel || '');
    setWfPrompt(p.prompt);
    setWfTarget(p.target);
    setWfAgents(p.agentsInvolved.length ? p.agentsInvolved : ['orchestrator']);
    setWfError(null);
  };

  const handleInsertWorkflowTemplate = () => {
    setWfPrompt(
      [
        'Goal: ...',
        '',
        'Steps:',
        '1. File Agent: ...',
        '2. System Agent: ...',
        '',
        'Rules:',
        '- កុំលុប ឬ edit file មុនសួរខ្ញុំ។',
        '',
        'Output (Khmer + English technical terms):',
        '- ...',
      ].join('\n'),
    );
  };

  const handleSavePreset = async () => {
    const name = wfName.trim();
    const prompt = wfPrompt.trim();
    if (name.length < 2 || prompt.length < 3) {
      setWfError('Name (≥ 2 chars) and instructions are required.');
      return;
    }
    setWfBusy(true);
    setWfError(null);
    const firstLine = prompt.split(/\r?\n/).find((l) => l.trim())?.trim() || prompt;
    const payload = {
      name,
      khmerLabel: wfKhmer.trim(),
      description: firstLine.replace(/^Goal:\s*/i, '').slice(0, 140),
      target: wfTarget,
      prompt,
      agentsInvolved: wfAgents.length ? wfAgents : (['orchestrator'] as AgentId[]),
    };
    try {
      if (wfEditingId) {
        await api.updatePreset(wfEditingId, payload);
        setNotice(`Workflow "${name}" updated.`);
      } else {
        await api.createPreset(payload);
        setNotice(`Workflow "${name}" added.`);
      }
      resetWorkflowForm();
      onPresetsChanged();
    } catch (err) {
      setWfError(err instanceof Error ? err.message : 'Failed to save workflow.');
    } finally {
      setWfBusy(false);
    }
  };

  const handleResetPreset = async (p: WorkflowPreset) => {
    await api.resetPreset(p.id);
    if (wfEditingId === p.id) resetWorkflowForm();
    setNotice(`"${p.name}" restored to the default prompt.`);
    onPresetsChanged();
  };

  const handleDeletePreset = async (p: WorkflowPreset) => {
    await api.deletePreset(p.id);
    if (wfEditingId === p.id) resetWorkflowForm();
    onPresetsChanged();
  };

  const navGroups: Array<{
    group: string;
    items: Array<{ id: SettingsSection; label: string; sub: string; icon: typeof Sun; color: string }>;
  }> = [
    {
      group: 'You',
      items: [
        { id: 'general', label: copy.general, sub: 'Name, language, look, text', icon: Sun, color: 'bg-sky-500/20 text-sky-300' },
      ],
    },
    {
      group: 'Agents',
      items: [
        { id: 'accounts', label: copy.aiAccounts, sub: 'Claude, Codex, Gemini, Local AI', icon: KeyRound, color: 'bg-amber-500/20 text-amber-300' },
        { id: 'agents', label: 'Agents', sub: 'Team roles & routing', icon: Users, color: 'bg-violet-500/20 text-violet-300' },
        { id: 'local_ai', label: copy.localAi, sub: 'Free offline Ollama models', icon: Cpu, color: 'bg-emerald-500/20 text-emerald-300' },
        { id: 'workflows', label: copy.workflows, sub: 'Reusable multi-agent presets', icon: Wrench, color: 'bg-slate-500/25 text-slate-300' },
      ],
    },
    {
      group: 'Data & App',
      items: [
        { id: 'folders', label: copy.folders, sub: 'Workspace & local storage', icon: FolderOpen, color: 'bg-cyan-500/20 text-cyan-300' },
        { id: 'about', label: copy.about, sub: 'Version & engine info', icon: Info, color: 'bg-white/10 text-slate-300' },
      ],
    },
  ];

  const activeProvider = providers.find((p) => p.id === form.provider);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[860px] h-[82vh] max-h-[680px] rounded-2xl border shadow-2xl overflow-hidden flex"
        style={{
          backgroundColor: 'var(--bg-panel)',
          borderColor: 'var(--border-strong)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left Navigation Column */}
        <aside className="w-[232px] shrink-0 border-r border-white/[0.07] p-3.5 overflow-y-auto space-y-4">
          <div className="px-2 text-base font-semibold text-[var(--text-primary)]">{copy.settings}</div>

          {navGroups.map((grp) => (
            <div key={grp.group} className="space-y-1">
              <div className="px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                {grp.group}
              </div>
              {grp.items.map((item) => {
                const Icon = item.icon;
                const active = section === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSection(item.id)}
                    className={`w-full px-2.5 py-2 rounded-xl flex items-center gap-2.5 text-left transition-colors cursor-pointer ${
                      active ? 'bg-white/[0.09]' : 'hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${item.color}`}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-[var(--text-primary)] truncate">
                        {item.label}
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)] truncate">{item.sub}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </aside>

        {/* Right Detail Column */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="px-6 py-4 border-b border-white/[0.07] flex items-center justify-between shrink-0">
            <h2 className="text-base font-semibold text-[var(--text-primary)] capitalize">
              {section.replace('_', ' ')}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:bg-white/[0.08] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            {notice && (
              <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-200 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{notice}</span>
              </div>
            )}

            {/* SECTION: GENERAL */}
            {section === 'general' && (
              <>
                {/* Language Switcher */}
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-[var(--text-primary)]">
                    {copy.languageLabel}
                  </label>
                  <div className="inline-flex p-1 rounded-full border border-white/[0.09] bg-black/25">
                    {(
                      [
                        { id: 'en', label: 'English' },
                        { id: 'km', label: 'ខ្មែរ' },
                      ] as const
                    ).map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, language: l.id }))}
                        className={`px-4 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                          form.language === l.id
                            ? ''
                            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                        }`}
                        style={
                          form.language === l.id
                            ? { backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }
                            : undefined
                        }
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Active Account Row */}
                <div className="rounded-xl border border-white/[0.08] px-4 py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                      style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                    >
                      {(form.userName || 'N')[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-[var(--text-primary)] truncate">
                        {activeProvider?.name || 'Gemini'} ·{' '}
                        {activeProvider?.signedIn ? activeProvider.accountLabel || copy.signedIn : copy.notSignedIn}
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)] truncate">
                        {activeProvider?.models.length || 0} models loaded from your local account
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {activeProvider?.signedIn && activeProvider.canLogout && (
                      <button
                        type="button"
                        disabled={loginBusy === activeProvider.id}
                        onClick={() => void handleProviderLogout(activeProvider.id)}
                        className="px-3 py-1.5 rounded-lg border border-white/[0.1] hover:border-rose-500/40 hover:bg-rose-500/15 text-xs text-[var(--text-secondary)] hover:text-rose-200 cursor-pointer transition-colors"
                      >
                        Sign out
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setSection('accounts')}
                      className="px-3 py-1.5 rounded-lg border border-white/[0.1] hover:bg-white/[0.06] text-xs text-[var(--text-primary)] cursor-pointer"
                    >
                      Manage accounts
                    </button>
                  </div>
                </div>

                {/* Your Name */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-[var(--text-primary)]">
                    {copy.yourName}
                  </label>
                  <input
                    type="text"
                    value={form.userName}
                    onChange={(e) => setForm((f) => ({ ...f, userName: e.target.value }))}
                    className="w-full px-3.5 py-2 rounded-xl bg-black/25 border border-white/[0.1] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                  />
                  <p className="text-[11px] text-[var(--text-muted)]">Agents greet and address you by this name.</p>
                </div>

                {/* Theme Look Grid */}
                <div className="space-y-2.5">
                  <label className="block text-xs font-medium text-[var(--text-primary)]">
                    {copy.lookLabel}
                  </label>
                  <div className="grid grid-cols-4 gap-2.5">
                    {THEME_SWATCHES.map((sw) => {
                      const active = form.theme === sw.id;
                      return (
                        <button
                          key={sw.id}
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, theme: sw.id }))}
                          className={`p-2 rounded-xl border text-center transition-colors cursor-pointer ${
                            active
                              ? 'border-[var(--accent)] bg-white/[0.06]'
                              : 'border-white/[0.08] hover:border-white/[0.18]'
                          }`}
                        >
                          <div
                            className="h-9 rounded-lg p-1.5 flex items-center gap-1.5 mb-1.5"
                            style={{ backgroundColor: sw.canvas }}
                          >
                            <span
                              className="flex-1 h-full rounded"
                              style={{ backgroundColor: sw.primary }}
                            />
                            <span
                              className="w-5 h-full rounded opacity-85"
                              style={{ backgroundColor: sw.secondary }}
                            />
                          </div>
                          <div className="text-[11px] font-medium text-[var(--text-primary)] truncate">
                            {sw.label}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Text Size */}
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-[var(--text-primary)]">
                    {copy.textSize}
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['small', 'default', 'large'] as TextSize[]).map((sz) => (
                      <button
                        key={sz}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, textSize: sz }))}
                        className={`py-2 rounded-xl border text-xs capitalize cursor-pointer ${
                          form.textSize === sz
                            ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text-primary)] font-medium'
                            : 'border-white/[0.08] text-[var(--text-secondary)] hover:bg-white/[0.04]'
                        }`}
                      >
                        {sz}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* SECTION: AI ACCOUNTS (MULTI-SLOT CLI ACCOUNTS — ZERO API KEY EXTRACTION) */}
            {section === 'accounts' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    Sign in through official local CLIs—zero tokens extracted or stored by Nexus. Add multiple isolated account slots per provider to spread quota across agents.
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleRefreshProviders()}
                    disabled={refreshing}
                    className="h-8 px-3 rounded-lg border border-white/[0.1] hover:bg-white/[0.06] text-xs text-[var(--text-primary)] inline-flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                    <span>Refresh</span>
                  </button>
                </div>

                <div className="rounded-xl border border-white/[0.08] divide-y divide-white/[0.08] overflow-hidden">
                  {providers.map((p) => {
                    const isCliMulti = p.id === 'codex' || p.id === 'gemini_agy' || p.id === 'claude';
                    const slots = p.slots || [];

                    if (isCliMulti && slots.length > 0) {
                      const cliProv = p.id as CliAccountProvider;
                      const addingThis = loginBusy === `add:${cliProv}`;
                      const signedCount = slots.filter((s) => s.signedIn).length;

                      return (
                        <div key={p.id} className="divide-y divide-white/[0.05]">
                          {/* Provider Group Header */}
                          <div className="px-4 py-3 bg-white/[0.02] flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`w-2 h-2 rounded-full ${
                                    signedCount > 0 ? 'bg-emerald-400' : p.installed ? 'bg-amber-400' : 'bg-rose-400'
                                  }`}
                                />
                                <span className="text-sm font-semibold text-[var(--text-primary)]">{p.name}</span>
                                <span className="text-[11px] text-[var(--text-muted)] tabular-nums">
                                  {signedCount}/{slots.length} signed in
                                </span>
                              </div>
                              <div className="text-[11px] text-[var(--text-muted)] mt-0.5">{p.subtitle}</div>
                            </div>
                            <button
                              type="button"
                              disabled={addingThis}
                              onClick={() => void handleAddSlot(cliProv)}
                              className="h-7 px-2.5 rounded-lg border border-white/[0.12] hover:bg-white/[0.06] text-[11px] font-medium text-[var(--text-primary)] inline-flex items-center gap-1 cursor-pointer shrink-0 disabled:opacity-50"
                            >
                              {addingThis ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                              <span>Add account</span>
                            </button>
                          </div>

                          {/* Per-Slot Rows */}
                          {slots.map((slot) => {
                            const isActiveSlot = form.provider === cliProv && (form.activeSlots?.[cliProv] || 'slot-1') === slot.id;
                            const busyLogin = loginBusy === `login:${cliProv}:${slot.id}`;
                            const busyLogout = loginBusy === `logout:${cliProv}:${slot.id}`;
                            const busyRemove = loginBusy === `rm:${cliProv}:${slot.id}`;
                            const engineBadge =
                              slot.cliEngine === 'agy'
                                ? 'Antigravity'
                                : slot.cliEngine === 'gemini_cli'
                                  ? 'Gemini CLI'
                                  : slot.cliEngine === 'codex'
                                    ? 'Codex CLI'
                                    : 'Claude CLI';

                            return (
                              <div key={slot.id} className="px-4 py-3 flex items-center justify-between gap-3">
                                <div className="min-w-0 space-y-0.5">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span
                                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                        slot.signedIn ? 'bg-emerald-400' : slot.installed ? 'bg-amber-400' : 'bg-rose-400'
                                      }`}
                                    />
                                    <span className="text-xs font-medium text-[var(--text-primary)]">{slot.label}</span>
                                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.05] text-[var(--text-muted)]">
                                      {engineBadge}
                                    </span>
                                    <span className="text-[11px] text-[var(--text-muted)] tabular-nums">
                                      {slot.signedIn
                                        ? `Active · ${slot.models.length} model${slot.models.length === 1 ? '' : 's'}`
                                        : slot.installed
                                          ? copy.notSignedIn
                                          : copy.notInstalled}
                                    </span>
                                  </div>
                                  {slot.accountLabel && (
                                    <div className="text-[11px] text-emerald-300/90 truncate">{slot.accountLabel}</div>
                                  )}
                                  {slot.error && !slot.signedIn && (
                                    <div className="text-[11px] text-rose-300/90">{slot.error}</div>
                                  )}
                                  <div className="text-[10px] font-mono text-[var(--text-muted)] truncate">
                                    {slot.homeDirHint}
                                  </div>
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0">
                                  {slot.signedIn && (
                                    <button
                                      type="button"
                                      onClick={() => void handleActivateSlot(cliProv, slot.id)}
                                      className={`h-7 px-2.5 rounded-lg text-[11px] font-medium cursor-pointer border ${
                                        isActiveSlot
                                          ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                                          : 'border-white/[0.1] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                                      }`}
                                    >
                                      {isActiveSlot ? 'Active' : 'Use'}
                                    </button>
                                  )}

                                  {slot.canLogin && (
                                    <button
                                      type="button"
                                      disabled={busyLogin}
                                      onClick={() => void handleSlotLogin(cliProv, slot.id)}
                                      className="h-7 px-2.5 rounded-lg text-[11px] font-medium inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                                      style={
                                        slot.signedIn
                                          ? { backgroundColor: 'rgba(255,255,255,0.06)', color: 'var(--text-primary)' }
                                          : { backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }
                                      }
                                    >
                                      {busyLogin ? (
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                      ) : (
                                        <LogIn className="w-3 h-3" />
                                      )}
                                      <span>{slot.signedIn ? 'Switch' : 'Sign in'}</span>
                                    </button>
                                  )}

                                  {slot.signedIn && slot.canLogout && (
                                    <button
                                      type="button"
                                      disabled={busyLogout}
                                      onClick={() => void handleSlotLogout(cliProv, slot.id)}
                                      title={`Sign out from ${slot.label}`}
                                      className="h-7 px-2.5 rounded-lg border border-white/[0.1] hover:border-rose-500/40 hover:bg-rose-500/15 text-[11px] text-[var(--text-secondary)] hover:text-rose-200 inline-flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-50"
                                    >
                                      {busyLogout ? (
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                      ) : (
                                        <LogOut className="w-3 h-3" />
                                      )}
                                      <span>Sign out</span>
                                    </button>
                                  )}

                                  {!slot.isDefault && (
                                    <button
                                      type="button"
                                      disabled={busyRemove}
                                      onClick={() => void handleRemoveSlot(cliProv, slot.id)}
                                      title="Remove slot from Nexus config (keeps data/cli-homes folder on disk)"
                                      className="h-7 w-7 rounded-lg border border-white/[0.08] hover:border-rose-500/40 hover:bg-rose-500/15 text-[var(--text-muted)] hover:text-rose-300 inline-flex items-center justify-center cursor-pointer transition-colors disabled:opacity-50"
                                    >
                                      {busyRemove ? (
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                      ) : (
                                        <Trash2 className="w-3 h-3" />
                                      )}
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    }

                    // Local AI (Ollama) row preserved as-is
                    const isSelected = form.provider === p.id;
                    return (
                      <div key={p.id} className="p-4 flex items-center justify-between gap-4">
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`w-2 h-2 rounded-full ${
                                p.signedIn ? 'bg-emerald-400' : p.installed ? 'bg-amber-400' : 'bg-rose-400'
                              }`}
                            />
                            <span className="text-sm font-semibold text-[var(--text-primary)]">{p.name}</span>
                            <span className="text-[11px] text-[var(--text-muted)]">
                              {p.signedIn
                                ? `${p.models.length} model${p.models.length === 1 ? '' : 's'}`
                                : p.installed
                                  ? copy.notSignedIn
                                  : copy.notInstalled}
                            </span>
                          </div>
                          <div className="text-xs text-[var(--text-secondary)]">{p.subtitle}</div>
                          {p.accountLabel && (
                            <div className="text-[11px] text-emerald-300/90">{p.accountLabel}</div>
                          )}
                          {p.error && !p.signedIn && (
                            <div className="text-[11px] text-rose-300/90">{p.error}</div>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {p.signedIn && (
                            <button
                              type="button"
                              onClick={() => setForm((f) => ({ ...f, provider: p.id }))}
                              className={`h-8 px-3 rounded-lg text-xs font-medium cursor-pointer border ${
                                isSelected
                                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                                  : 'border-white/[0.1] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                              }`}
                            >
                              {isSelected ? 'Active' : 'Use'}
                            </button>
                          )}

                          {p.canLogin && (
                            <button
                              type="button"
                              disabled={loginBusy === p.id}
                              onClick={() => void handleProviderLogin(p.id)}
                              className="h-8 px-3 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                              style={
                                p.signedIn
                                  ? { backgroundColor: 'rgba(255,255,255,0.06)', color: 'var(--text-primary)' }
                                  : { backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }
                              }
                            >
                              {loginBusy === p.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <LogIn className="w-3.5 h-3.5" />
                              )}
                              <span>{p.loginActionLabel || copy.signInAgain}</span>
                            </button>
                          )}

                          {p.signedIn && p.canLogout && (
                            <button
                              type="button"
                              disabled={loginBusy === p.id}
                              onClick={() => void handleProviderLogout(p.id)}
                              title={`Sign out from ${p.name}`}
                              className="h-8 px-3 rounded-lg border border-white/[0.1] hover:border-rose-500/40 hover:bg-rose-500/15 text-xs text-[var(--text-secondary)] hover:text-rose-200 inline-flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
                            >
                              <LogOut className="w-3.5 h-3.5" />
                              <span>{p.logoutActionLabel || 'Sign out'}</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Collapsed optional API key fallbacks (preserved for per-agent routing) */}
                <details className="rounded-xl border border-white/[0.07] px-4 py-3">
                  <summary className="text-xs text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-secondary)]">
                    Optional fallback engines: Gemini API Key & OpenAI-compatible API
                  </summary>
                  <div className="mt-3 space-y-3 pt-3 border-t border-white/[0.06]">
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-medium text-[var(--text-secondary)]">Gemini API Key Fallback</div>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="password"
                          value={form.geminiApiKey}
                          onChange={(e) => setForm((f) => ({ ...f, geminiApiKey: e.target.value }))}
                          placeholder="GEMINI_API_KEY (optional)"
                          className="px-3 py-2 rounded-lg bg-black/25 border border-white/[0.1] text-xs font-mono text-[var(--text-primary)] outline-none"
                        />
                        <input
                          type="text"
                          value={form.geminiModel}
                          onChange={(e) => setForm((f) => ({ ...f, geminiModel: e.target.value }))}
                          placeholder="gemini-2.5-flash"
                          className="px-3 py-2 rounded-lg bg-black/25 border border-white/[0.1] text-xs font-mono text-[var(--text-primary)] outline-none"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-medium text-[var(--text-secondary)]">OpenAI-Compatible API Fallback</div>
                      <div className="grid grid-cols-3 gap-2">
                        <input
                          type="text"
                          value={form.openaiBaseUrl}
                          onChange={(e) => setForm((f) => ({ ...f, openaiBaseUrl: e.target.value }))}
                          placeholder="https://api.openai.com/v1"
                          className="px-3 py-2 rounded-lg bg-black/25 border border-white/[0.1] text-xs font-mono text-[var(--text-primary)] outline-none"
                        />
                        <input
                          type="password"
                          value={form.openaiApiKey}
                          onChange={(e) => setForm((f) => ({ ...f, openaiApiKey: e.target.value }))}
                          placeholder="API Key (optional)"
                          className="px-3 py-2 rounded-lg bg-black/25 border border-white/[0.1] text-xs font-mono text-[var(--text-primary)] outline-none"
                        />
                        <input
                          type="text"
                          value={form.openaiModel}
                          onChange={(e) => setForm((f) => ({ ...f, openaiModel: e.target.value }))}
                          placeholder="gpt-4o-mini"
                          className="px-3 py-2 rounded-lg bg-black/25 border border-white/[0.1] text-xs font-mono text-[var(--text-primary)] outline-none"
                        />
                      </div>
                    </div>
                  </div>
                </details>
              </div>
            )}

            {/* SECTION: AGENTS (PER-AGENT PROVIDER → ACCOUNT SLOT → MODEL ROUTING) */}
            {section === 'agents' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    Assign each agent its own provider, account slot, and model. Agents never sign in on their own—they reuse the assigned slot&apos;s official CLI login.
                  </p>
                  <button
                    type="button"
                    onClick={handleResetAgentDefaults}
                    className="h-8 px-3 rounded-lg border border-white/[0.1] hover:bg-white/[0.06] text-xs text-[var(--text-primary)] cursor-pointer shrink-0"
                  >
                    Reset defaults
                  </button>
                </div>

                <div className="rounded-xl border border-white/[0.08] divide-y divide-white/[0.07]">
                  {AGENT_ROSTER.map((a, agentIdx) => {
                    const route = getAgentRoute(a.id);
                    const isCliProv =
                      route.provider === 'codex' ||
                      route.provider === 'gemini_agy' ||
                      route.provider === 'claude';
                    const provMeta = providers.find((p) => p.id === route.provider);
                    const slots = provMeta?.slots || [];
                    const selectedSlot = slots.find((s) => s.id === (route.slotId || 'slot-1')) || slots[0];
                    const slotModels = isCliProv
                      ? selectedSlot?.models || []
                      : route.provider === 'ollama'
                        ? provMeta?.models || []
                        : [];
                    const openUp = agentIdx >= AGENT_ROSTER.length - 2;

                    const providerOptions = [
                      { value: 'codex', label: 'Codex (ChatGPT)', dot: (providers.find((p) => p.id === 'codex')?.slots?.some((s) => s.signedIn) ? 'emerald' : 'rose') as 'emerald' | 'rose' },
                      { value: 'gemini_agy', label: 'Gemini (Google)', dot: (providers.find((p) => p.id === 'gemini_agy')?.slots?.some((s) => s.signedIn) ? 'emerald' : 'rose') as 'emerald' | 'rose' },
                      { value: 'claude', label: 'Claude Code', dot: (providers.find((p) => p.id === 'claude')?.slots?.some((s) => s.signedIn) ? 'emerald' : 'rose') as 'emerald' | 'rose' },
                      { value: 'ollama', label: 'Local AI (Ollama)', dot: (providers.find((p) => p.id === 'ollama')?.signedIn ? 'emerald' : 'amber') as 'emerald' | 'amber' },
                      { value: 'gemini_api', label: 'Gemini API Key', sublabel: 'Fallback engine' },
                      { value: 'openai_compatible', label: 'OpenAI-Compatible', sublabel: 'Fallback engine' },
                    ];

                    const slotOptions =
                      slots.length > 0
                        ? slots.map((s) => ({
                            value: s.id,
                            label: s.label,
                            sublabel: s.signedIn ? `${s.models.length} models · Active` : 'Not signed in',
                            dot: (s.signedIn ? 'emerald' : 'rose') as 'emerald' | 'rose',
                          }))
                        : [{ value: 'slot-1', label: 'Account 1 (Default)' }];

                    const isKnownBroken = route.model ? /gemini-4-/i.test(route.model) : false;
                    const modelOptions =
                      slotModels.length > 0
                        ? [
                            ...(!slotModels.some((m) => m.id === route.model) && route.model && !isKnownBroken
                              ? [{ value: route.model, label: route.model }]
                              : []),
                            ...slotModels.map((m) => ({
                              value: m.id,
                              label: m.label,
                              sublabel:
                                m.description &&
                                m.description !== m.id &&
                                m.description !== m.label
                                  ? m.description
                                  : undefined,
                            })),
                          ]
                        : [
                            {
                              value: route.model || 'default',
                              label: route.model || 'default',
                              sublabel: 'Sign in to load models',
                            },
                          ];

                    return (
                      <div key={a.id} className="p-4 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold text-[var(--text-primary)]">{a.name}</div>
                            <div className="text-[11px] text-[var(--text-muted)]">{a.description}</div>
                          </div>
                          <span className="text-[11px] text-[var(--text-muted)] shrink-0">{a.khmerRole}</span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                          {/* 1. Provider */}
                          <div className="space-y-1">
                            <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                              Provider
                            </label>
                            <StudioSelect
                              value={route.provider}
                              options={providerOptions}
                              openUp={openUp}
                              onChange={(val) => updateAgentRoute(a.id, { provider: val as ProviderType })}
                            />
                          </div>

                          {/* 2. Account Slot */}
                          <div className="space-y-1">
                            <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                              Account slot
                            </label>
                            {isCliProv ? (
                              <StudioSelect
                                value={route.slotId || 'slot-1'}
                                options={slotOptions}
                                openUp={openUp}
                                onChange={(val) => updateAgentRoute(a.id, { slotId: val })}
                              />
                            ) : (
                              <div className="h-8 px-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[11px] text-[var(--text-muted)] flex items-center">
                                {route.provider === 'ollama' ? 'Local Ollama server' : 'API Key fallback'}
                              </div>
                            )}
                          </div>

                          {/* 3. Model */}
                          <div className="space-y-1">
                            <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                              Model
                            </label>
                            {isCliProv || (route.provider === 'ollama' && slotModels.length > 0) ? (
                              <StudioSelect
                                value={route.model}
                                options={modelOptions}
                                openUp={openUp}
                                align="right"
                                onChange={(val) => updateAgentRoute(a.id, { model: val })}
                              />
                            ) : (
                              <input
                                type="text"
                                value={route.model}
                                onChange={(e) => updateAgentRoute(a.id, { model: e.target.value })}
                                placeholder={
                                  route.provider === 'gemini_api'
                                    ? 'gemini-3.8-flash'
                                    : route.provider === 'ollama'
                                      ? 'qwen2.5:7b'
                                      : 'gpt-4o-mini'
                                }
                                className="w-full h-8 px-2.5 rounded-lg bg-black/30 border border-white/[0.1] text-xs font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                              />
                            )}
                          </div>
                        </div>

                        {isCliProv && selectedSlot && !selectedSlot.signedIn && (
                          <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-200">
                            <span>
                              {selectedSlot.label} is not signed in. Other agents on other slots will still work.
                            </span>
                            <button
                              type="button"
                              onClick={() => setSection('accounts')}
                              className="underline font-medium cursor-pointer shrink-0"
                            >
                              Sign in
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Honest CLI Safety Mode Enforcement Summary */}
                <details className="rounded-xl border border-white/[0.07] px-4 py-3">
                  <summary className="text-xs text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-secondary)]">
                    Safety mode enforcement across CLI engines (honest capability map)
                  </summary>
                  <div className="mt-3 pt-3 border-t border-white/[0.06] space-y-2 text-[11px] text-[var(--text-secondary)]">
                    {(['codex', 'agy', 'gemini_cli', 'claude', 'native'] as const).map((eng) => {
                      const info = CLI_SAFETY_SUPPORT[eng][form.safetyMode];
                      const label =
                        eng === 'codex'
                          ? 'Codex CLI'
                          : eng === 'agy'
                            ? 'Antigravity (Slot 1)'
                            : eng === 'gemini_cli'
                              ? 'Gemini CLI (Slot 2+)'
                              : eng === 'claude'
                                ? 'Claude Code CLI'
                                : 'Ollama / API Key';
                      return (
                        <div key={eng} className="flex items-start justify-between gap-3">
                          <span className="font-medium text-[var(--text-primary)] shrink-0">{label}</span>
                          <span className="text-right text-[var(--text-muted)]">
                            <code className="text-[10px] text-sky-300">{info.flagSummary}</code> — {info.note}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </details>
              </div>
            )}

            {/* SECTION: LOCAL AI (OLLAMA) */}
            {section === 'local_ai' && (
              <div className="space-y-4">
                <p className="text-xs text-[var(--text-secondary)]">
                  Run 100% private offline models on your laptop with Ollama—no account or internet required.
                </p>
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-[var(--text-primary)]">Ollama Local URL</label>
                  <input
                    type="text"
                    value={form.ollamaBaseUrl}
                    onChange={(e) => setForm((f) => ({ ...f, ollamaBaseUrl: e.target.value }))}
                    className="w-full px-3.5 py-2 rounded-xl bg-black/25 border border-white/[0.1] text-xs font-mono text-[var(--text-primary)] outline-none"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleProviderLogin('ollama')}
                    disabled={loginBusy === 'ollama'}
                    className="h-9 px-4 rounded-xl text-xs font-medium inline-flex items-center gap-2 cursor-pointer"
                    style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
                  >
                    {loginBusy === 'ollama' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>Start Local AI Server</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRefreshProviders()}
                    className="h-9 px-3 rounded-xl border border-white/[0.1] text-xs text-[var(--text-primary)] hover:bg-white/[0.05] cursor-pointer"
                  >
                    Detect Models
                  </button>
                </div>
                {providers.find((p) => p.id === 'ollama')?.models.length ? (
                  <div className="rounded-xl border border-white/[0.08] divide-y divide-white/[0.06]">
                    {providers
                      .find((p) => p.id === 'ollama')!
                      .models.map((m) => (
                        <div key={m.id} className="px-3.5 py-2.5 flex items-center justify-between text-xs">
                          <span className="font-mono text-[var(--text-primary)]">{m.label}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setForm((f) => ({
                                ...f,
                                provider: 'ollama',
                                ollamaModel: m.id,
                                selectedModels: { ...f.selectedModels, ollama: m.id },
                              }))
                            }
                            className="text-[11px] hover:underline cursor-pointer"
                            style={{ color: 'var(--accent)' }}
                          >
                            Select
                          </button>
                        </div>
                      ))}
                  </div>
                ) : (
                  <div className="text-xs text-[var(--text-muted)]">
                    Tip: To add a tool-calling local model, run <code className="px-1 py-0.5 rounded bg-white/[0.08]">ollama pull qwen2.5:7b</code> in terminal.
                  </div>
                )}
              </div>
            )}

            {/* SECTION: WORKFLOWS (create / edit / reset) */}
            {section === 'workflows' && (
              <div className="space-y-4">
                {/* Editor Card */}
                <div
                  className={`rounded-xl border p-4 space-y-3 transition-colors ${
                    wfEditingId ? 'border-[var(--accent)]/60 bg-[var(--accent-soft)]/30' : 'border-white/[0.08]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-[var(--text-primary)]">
                      {wfEditingId ? `Edit workflow · ${wfName || 'Untitled'}` : 'New workflow'}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleInsertWorkflowTemplate}
                        className="h-7 px-2.5 rounded-lg border border-white/[0.1] hover:bg-white/[0.06] text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-1 cursor-pointer"
                      >
                        <FileText className="w-3 h-3" />
                        <span>Use template</span>
                      </button>
                      {wfEditingId && (
                        <button
                          type="button"
                          onClick={resetWorkflowForm}
                          className="h-7 px-2.5 rounded-lg border border-white/[0.1] hover:bg-white/[0.06] text-[11px] text-[var(--text-secondary)] cursor-pointer"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={wfName}
                      onChange={(e) => setWfName(e.target.value)}
                      placeholder="Workflow name (e.g. Debug Project)"
                      className="px-3 py-2 rounded-lg bg-black/25 border border-white/[0.1] text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                    />
                    <input
                      type="text"
                      value={wfKhmer}
                      onChange={(e) => setWfKhmer(e.target.value)}
                      placeholder="Khmer subtitle (optional)"
                      className="px-3 py-2 rounded-lg bg-black/25 border border-white/[0.1] text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                    />
                  </div>

                  <div className="relative">
                    <textarea
                      rows={8}
                      value={wfPrompt}
                      onChange={(e) => setWfPrompt(e.target.value)}
                      placeholder={'Goal: ...\n\nSteps:\n1. File Agent: ...\n2. System Agent: ...\n\nRules:\n- ...\n\nOutput: ...'}
                      className="w-full px-3 py-2.5 rounded-lg bg-black/25 border border-white/[0.1] text-xs leading-relaxed font-mono text-[var(--text-primary)] outline-none resize-y min-h-[140px] focus:border-[var(--accent)]"
                    />
                    <span className="absolute right-2.5 bottom-2 text-[10px] text-[var(--text-muted)] tabular-nums pointer-events-none">
                      {wfPrompt.length}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-3 items-start">
                    <div className="space-y-1">
                      <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                        Send to
                      </label>
                      <StudioSelect
                        value={wfTarget}
                        openUp
                        options={[
                          { value: 'auto', label: 'Nexus team (auto)', sublabel: 'Orchestrator delegates' },
                          { value: 'file', label: 'File Agent only' },
                          { value: 'system', label: 'System Agent only' },
                          { value: 'browser', label: 'Browser Agent only' },
                        ]}
                        onChange={(val) => setWfTarget(val as WorkflowPreset['target'])}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                        Agents involved
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {AGENT_ROSTER.map((ag) => {
                          const on = wfAgents.includes(ag.id);
                          return (
                            <button
                              key={ag.id}
                              type="button"
                              onClick={() =>
                                setWfAgents((prev) =>
                                  prev.includes(ag.id) ? prev.filter((x) => x !== ag.id) : [...prev, ag.id],
                                )
                              }
                              className={`h-7 px-2.5 rounded-lg text-[11px] border inline-flex items-center gap-1 cursor-pointer transition-colors ${
                                on
                                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                                  : 'border-white/[0.08] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                              }`}
                            >
                              {on && <Check className="w-3 h-3" />}
                              <span>{ag.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {wfError && <div className="text-[11px] text-rose-300">{wfError}</div>}

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => void handleSavePreset()}
                      disabled={wfBusy || wfName.trim().length < 2 || wfPrompt.trim().length < 3}
                      className="h-8 px-3.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                      style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
                    >
                      {wfBusy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : wfEditingId ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Plus className="w-3.5 h-3.5" />
                      )}
                      <span>{wfEditingId ? 'Save changes' : 'Add workflow'}</span>
                    </button>
                  </div>
                </div>

                {/* Workflow List */}
                <div className="rounded-xl border border-white/[0.08] divide-y divide-white/[0.06]">
                  {presets.map((p) => {
                    const isEditing = wfEditingId === p.id;
                    return (
                      <div
                        key={p.id}
                        className={`group px-4 py-3 flex items-start justify-between gap-3 transition-colors ${
                          isEditing ? 'bg-[var(--accent-soft)]/40' : 'hover:bg-white/[0.02]'
                        }`}
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs font-semibold text-[var(--text-primary)]">{p.name}</span>
                            <span
                              className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                                !p.builtIn
                                  ? 'bg-emerald-500/15 text-emerald-300'
                                  : p.edited
                                    ? 'bg-amber-500/15 text-amber-300'
                                    : 'bg-white/[0.06] text-[var(--text-muted)]'
                              }`}
                            >
                              {!p.builtIn ? 'Custom' : p.edited ? 'Edited' : 'Built-in'}
                            </span>
                          </div>
                          {p.khmerLabel && (
                            <div className="text-[11px] text-[var(--text-secondary)] truncate">{p.khmerLabel}</div>
                          )}
                          <div className="text-[11px] text-[var(--text-muted)] line-clamp-2 leading-relaxed">
                            {p.description || p.prompt}
                          </div>
                          <div className="flex flex-wrap gap-1 pt-0.5">
                            {p.agentsInvolved.map((id) => (
                              <span
                                key={id}
                                className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.05] text-[var(--text-muted)]"
                              >
                                {AGENT_ROSTER.find((a) => a.id === id)?.name || id}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleEditPreset(p)}
                            title="Edit workflow"
                            className={`h-7 px-2 rounded-lg text-[11px] inline-flex items-center gap-1 border cursor-pointer transition-colors ${
                              isEditing
                                ? 'border-[var(--accent)] text-[var(--accent)]'
                                : 'border-white/[0.08] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/[0.05]'
                            }`}
                          >
                            <Pencil className="w-3 h-3" />
                            <span>Edit</span>
                          </button>
                          {p.builtIn && p.edited && (
                            <button
                              type="button"
                              onClick={() => void handleResetPreset(p)}
                              title="Reset to default prompt"
                              className="h-7 w-7 rounded-lg border border-white/[0.08] text-[var(--text-muted)] hover:text-amber-300 hover:bg-amber-500/10 inline-flex items-center justify-center cursor-pointer"
                            >
                              <RotateCcw className="w-3 h-3" />
                            </button>
                          )}
                          {!p.builtIn && (
                            <button
                              type="button"
                              onClick={() => void handleDeletePreset(p)}
                              title="Delete workflow"
                              className="h-7 w-7 rounded-lg border border-white/[0.08] text-[var(--text-muted)] hover:text-rose-300 hover:bg-rose-500/15 inline-flex items-center justify-center cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* SECTION: FOLDERS & STORAGE */}
            {section === 'folders' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-[var(--text-primary)]">
                    Default Workspace Folder
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={form.defaultWorkspace}
                      onChange={(e) => setForm((f) => ({ ...f, defaultWorkspace: e.target.value }))}
                      className="flex-1 px-3 py-2 rounded-xl bg-black/25 border border-white/[0.1] text-xs font-mono text-[var(--text-primary)] outline-none"
                    />
                    {window.nexusDesktop?.pickDirectory && (
                      <button
                        type="button"
                        onClick={() => void handlePickFolder()}
                        className="px-3 py-2 rounded-xl border border-white/[0.1] hover:bg-white/[0.06] text-xs text-[var(--text-primary)] cursor-pointer"
                      >
                        Browse
                      </button>
                    )}
                  </div>
                </div>

                {storageStats && (
                  <div className="rounded-xl border border-white/[0.08] divide-y divide-white/[0.06] text-xs tabular-nums">
                    <div className="px-4 py-3 flex justify-between">
                      <span className="text-[var(--text-muted)]">Data directory</span>
                      <span className="font-mono text-[11px] text-[var(--text-primary)] truncate max-w-[320px]">
                        {storageStats.dataDir}
                      </span>
                    </div>
                    <div className="px-4 py-3 flex justify-between">
                      <span className="text-[var(--text-muted)]">Saved missions</span>
                      <span className="text-[var(--text-primary)]">{storageStats.sessionsCount}</span>
                    </div>
                    <div className="px-4 py-3 flex justify-between">
                      <span className="text-[var(--text-muted)]">Audit log entries</span>
                      <span className="text-[var(--text-primary)]">{storageStats.auditLogsCount}</span>
                    </div>
                    <div className="px-4 py-3 flex justify-between">
                      <span className="text-[var(--text-muted)]">Storage used</span>
                      <span className="text-[var(--text-primary)]">{formatBytes(storageStats.totalBytes)}</span>
                    </div>
                  </div>
                )}

                {window.nexusDesktop?.openFolder && storageStats && (
                  <button
                    type="button"
                    onClick={() => void window.nexusDesktop?.openFolder?.(storageStats.dataDir)}
                    className="h-8 px-3 rounded-lg border border-white/[0.1] hover:bg-white/[0.06] text-xs text-[var(--text-primary)] inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open Data Folder</span>
                  </button>
                )}
              </div>
            )}

            {/* SECTION: ABOUT */}
            {section === 'about' && (
              <div className="space-y-3 text-xs text-[var(--text-secondary)]">
                <div className="text-sm font-semibold text-[var(--text-primary)]">Nexus Agent OS v2.0.0</div>
                <p className="leading-relaxed">
                  Local-first Multi-Agent Desktop OS built with Electron, React, Tailwind CSS, WebSocket, and official signed-in CLI account bridges (Gemini Antigravity, Codex ChatGPT, Claude Code, and offline Ollama).
                </p>
                <div className="rounded-xl border border-white/[0.08] divide-y divide-white/[0.06]">
                  {providers.map((p) => (
                    <div key={p.id} className="px-3.5 py-2.5 flex items-center justify-between gap-2">
                      <span className="text-[var(--text-primary)] font-medium">{p.name}</span>
                      <span className="font-mono text-[10px] text-[var(--text-muted)] truncate max-w-[330px]">
                        {p.binaryPath || 'Not detected'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sticky Footer: 1 Primary CTA (Save) + Quiet Close */}
          <div className="px-6 py-3 border-t border-white/[0.07] flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="h-8 px-4 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
            >
              {saving ? 'Saving...' : copy.save}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="h-8 px-3.5 rounded-lg border border-white/[0.1] hover:bg-white/[0.05] text-xs text-[var(--text-secondary)] cursor-pointer"
            >
              {copy.close}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
