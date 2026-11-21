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
} from 'lucide-react';
import {
  AGENT_ROSTER,
  type AgentId,
  type AppSettings,
  type ProviderAccountStatus,
  type ProviderType,
  type StorageStats,
  type TextSize,
  type WorkflowPreset,
} from '../../shared/types';
import { api } from '../lib/api';
import { THEME_SWATCHES, t } from '../lib/i18n';

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
  const [loginBusy, setLoginBusy] = useState<ProviderType | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);

  // Workflow creator form
  const [wfName, setWfName] = useState('');
  const [wfKhmer, setWfKhmer] = useState('');
  const [wfPrompt, setWfPrompt] = useState('');
  const [wfAgents, setWfAgents] = useState<AgentId[]>(['orchestrator', 'file', 'system']);

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
      setNotice(res.message);
    } finally {
      setLoginBusy(null);
    }
  };

  const handlePickFolder = async () => {
    if (!window.nexusDesktop?.pickDirectory) return;
    const picked = await window.nexusDesktop.pickDirectory();
    if (picked) setForm((prev) => ({ ...prev, defaultWorkspace: picked }));
  };

  const handleCreatePreset = async () => {
    if (!wfName.trim() || !wfPrompt.trim()) return;
    await api.createPreset({
      name: wfName.trim(),
      khmerLabel: wfKhmer.trim(),
      description: wfPrompt.trim().slice(0, 140),
      target: 'auto',
      prompt: wfPrompt.trim(),
      agentsInvolved: wfAgents.length ? wfAgents : ['orchestrator'],
    });
    setWfName('');
    setWfKhmer('');
    setWfPrompt('');
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

            {/* SECTION: AI ACCOUNTS (NO API KEY REQUIRED) */}
            {section === 'accounts' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    Sign in with your existing Claude, ChatGPT, or Google accounts through their official local CLIs—models load automatically with zero API keys.
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

                <div className="rounded-xl border border-white/[0.08] divide-y divide-white/[0.07] overflow-hidden">
                  {providers.map((p) => {
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

                {/* Collapsed optional API key fallback */}
                <details className="rounded-xl border border-white/[0.07] px-4 py-3">
                  <summary className="text-xs text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-secondary)]">
                    Optional: Custom OpenAI-compatible or Gemini API Key fallback
                  </summary>
                  <div className="mt-3 space-y-3 pt-3 border-t border-white/[0.06]">
                    <div className="grid grid-cols-2 gap-2">
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
                        placeholder="Optional API Key"
                        className="px-3 py-2 rounded-lg bg-black/25 border border-white/[0.1] text-xs font-mono text-[var(--text-primary)] outline-none"
                      />
                    </div>
                  </div>
                </details>
              </div>
            )}

            {/* SECTION: AGENTS */}
            {section === 'agents' && (
              <div className="rounded-xl border border-white/[0.08] divide-y divide-white/[0.07]">
                {AGENT_ROSTER.map((a) => (
                  <div key={a.id} className="p-4 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-[var(--text-primary)]">{a.name}</span>
                      <span className="text-[11px] text-[var(--text-muted)]">{a.khmerRole}</span>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{a.description}</p>
                    <div className="text-[11px] text-[var(--text-muted)] pt-1">
                      Skills: {a.capabilities.join(' · ')}
                    </div>
                  </div>
                ))}
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

            {/* SECTION: WORKFLOWS */}
            {section === 'workflows' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-white/[0.08] p-4 space-y-3">
                  <div className="text-xs font-semibold text-[var(--text-primary)]">New Reusable Workflow</div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={wfName}
                      onChange={(e) => setWfName(e.target.value)}
                      placeholder="Workflow name"
                      className="px-3 py-2 rounded-lg bg-black/25 border border-white/[0.1] text-xs text-[var(--text-primary)] outline-none"
                    />
                    <input
                      type="text"
                      value={wfKhmer}
                      onChange={(e) => setWfKhmer(e.target.value)}
                      placeholder="Khmer subtitle (optional)"
                      className="px-3 py-2 rounded-lg bg-black/25 border border-white/[0.1] text-xs text-[var(--text-primary)] outline-none"
                    />
                  </div>
                  <textarea
                    rows={3}
                    value={wfPrompt}
                    onChange={(e) => setWfPrompt(e.target.value)}
                    placeholder="Instructions for the agents..."
                    className="w-full px-3 py-2 rounded-lg bg-black/25 border border-white/[0.1] text-xs text-[var(--text-primary)] outline-none resize-none"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex gap-1.5">
                      {(['orchestrator', 'file', 'system', 'browser'] as AgentId[]).map((id) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() =>
                            setWfAgents((prev) =>
                              prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                            )
                          }
                          className={`px-2 py-1 rounded-lg text-[11px] border cursor-pointer ${
                            wfAgents.includes(id)
                              ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                              : 'border-white/[0.08] text-[var(--text-muted)]'
                          }`}
                        >
                          {id}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleCreatePreset()}
                      disabled={!wfName.trim() || !wfPrompt.trim()}
                      className="h-8 px-3 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                      style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add</span>
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-white/[0.08] divide-y divide-white/[0.06]">
                  {presets.map((p) => (
                    <div key={p.id} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-[var(--text-primary)]">
                          {p.name} {p.builtIn && <span className="text-[10px] text-[var(--text-muted)]">(Built-in)</span>}
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)] truncate mt-0.5">{p.prompt}</div>
                      </div>
                      {!p.builtIn && (
                        <button
                          type="button"
                          onClick={async () => {
                            await api.deletePreset(p.id);
                            onPresetsChanged();
                          }}
                          className="p-1.5 rounded-lg hover:bg-rose-500/20 text-[var(--text-muted)] hover:text-rose-300 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
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
