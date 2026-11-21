import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AgentHandoff,
  AgentId,
  AgentRunState,
  AppSettings,
  AuditLogEntry,
  ChatSession,
  EffortLevel,
  PendingApproval,
  PlanStep,
  ProviderAccountStatus,
  ProviderType,
  SafetyMode,
  ServerWsEvent,
  SystemTelemetry,
  TargetMode,
  ToolCallTrace,
  WorkflowPreset,
} from '../shared/types';
import { api, connectEventStream } from './lib/api';
import { THEME_SWATCHES, t } from './lib/i18n';
import { TopBar } from './components/TopBar';
import { CommandPalette } from './components/CommandPalette';
import { Sidebar } from './components/Sidebar';
import { ChatPanel } from './components/ChatPanel';
import { InspectorPanel, type InspectorTab } from './components/InspectorPanel';
import { SettingsModal, type SettingsSection } from './components/SettingsModal';

const INITIAL_AGENT_STATES: Record<AgentId, { state: AgentRunState; detail?: string }> = {
  orchestrator: { state: 'idle' },
  file: { state: 'idle' },
  system: { state: 'idle' },
  browser: { state: 'idle' },
};

const FALLBACK_SETTINGS: AppSettings = {
  provider: 'gemini_agy',
  effort: 'medium',
  selectedModels: {},
  userName: 'Nha',
  language: 'en',
  theme: 'midnight',
  glassOpacity: 92,
  textSize: 'default',
  safetyMode: 'smart',
  defaultWorkspace: '',
  maxToolSteps: 10,
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'qwen2.5:7b',
  geminiApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiApiKey: '',
  openaiModel: 'gpt-4o-mini',
};

export function App() {
  const [wsConnected, setWsConnected] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(FALLBACK_SETTINGS);
  const [providers, setProviders] = useState<ProviderAccountStatus[]>([]);
  const [refreshingProviders, setRefreshingProviders] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [presets, setPresets] = useState<WorkflowPreset[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [telemetry, setTelemetry] = useState<SystemTelemetry | null>(null);
  const [telemetryLoading, setTelemetryLoading] = useState(false);

  const [targetMode, setTargetMode] = useState<TargetMode>('auto');
  const [isRunning, setIsRunning] = useState(false);
  const [agentStates, setAgentStates] = useState(INITIAL_AGENT_STATES);
  const [livePlan, setLivePlan] = useState<PlanStep[]>([]);
  const [liveHandoffs, setLiveHandoffs] = useState<AgentHandoff[]>([]);
  const [liveTraces, setLiveTraces] = useState<ToolCallTrace[]>([]);
  const [liveNotes, setLiveNotes] = useState<Array<{ agent: AgentId; text: string }>>([]);
  const [liveStreamText, setLiveStreamText] = useState('');
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);

  // Layout controls
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('profile');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');

  const splitView = inspectorOpen && inspectorTab === 'mesh';
  const handleToggleSplitView = useCallback(() => {
    if (!inspectorOpen) {
      setInspectorOpen(true);
      setInspectorTab('mesh');
    } else if (inspectorTab === 'mesh') {
      setInspectorTab('profile');
    } else {
      setInspectorTab('mesh');
    }
  }, [inspectorOpen, inspectorTab]);

  const refreshTelemetry = useCallback(async () => {
    setTelemetryLoading(true);
    try {
      const { telemetry: data } = await api.getTelemetry();
      setTelemetry(data);
    } catch {
      // ignore initial error
    } finally {
      setTelemetryLoading(false);
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    const { sessions: list } = await api.getSessions();
    setSessions(list);
    return list;
  }, []);

  const refreshPresets = useCallback(async () => {
    const { presets: list } = await api.getPresets();
    setPresets(list);
  }, []);

  const refreshProviders = useCallback(async (force = true) => {
    setRefreshingProviders(true);
    try {
      const res = force ? await api.refreshProviders() : await api.getProviderStatuses(false);
      setProviders(res.providers);
    } catch {
      // ignore transient
    } finally {
      setRefreshingProviders(false);
    }
  }, []);

  // Apply theme & glass opacity to document + Electron window
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme);
    const alpha = Math.min(1, Math.max(0.72, settings.glassOpacity / 100));
    document.documentElement.style.setProperty('--glass-alpha', String(alpha));

    const swatch = THEME_SWATCHES.find((s) => s.id === settings.theme);
    if (swatch && window.nexusDesktop?.setTitlebarTheme) {
      void window.nexusDesktop.setTitlebarTheme({ color: swatch.canvas, symbolColor: '#94A3B8' });
    }
    if (window.nexusDesktop?.setOpacity) {
      void window.nexusDesktop.setOpacity(alpha);
    }
  }, [settings.theme, settings.glassOpacity]);

  // Global Ctrl+K shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Bootstrap initial data
  useEffect(() => {
    (async () => {
      try {
        const [setRes, provRes, sesRes, preRes, audRes, appRes] = await Promise.all([
          api.getSettings(),
          api.getProviderStatuses(false),
          api.getSessions(),
          api.getPresets(),
          api.getAuditLogs(),
          api.getApprovals(),
        ]);
        setSettings(setRes.settings);
        setProviders(provRes.providers);
        setSessions(sesRes.sessions);
        if (sesRes.sessions.length > 0) {
          setActiveSessionId(sesRes.sessions[0].id);
        }
        setPresets(preRes.presets);
        setAuditLogs(audRes.logs);
        setPendingApprovals(appRes.approvals);
      } catch (err) {
        console.error('Bootstrap error:', err);
      }
    })();
    void refreshTelemetry();
  }, [refreshTelemetry]);

  // Live WebSocket stream
  useEffect(() => {
    const disconnect = connectEventStream(
      (event: ServerWsEvent) => {
        switch (event.type) {
          case 'agent_state':
            setAgentStates((prev) => ({
              ...prev,
              [event.agent]: { state: event.state, detail: event.detail },
            }));
            break;

          case 'run_started':
            setIsRunning(true);
            setLivePlan([]);
            setLiveHandoffs([]);
            setLiveTraces([]);
            setLiveNotes([]);
            setLiveStreamText('');
            break;

          case 'plan_updated':
            setLivePlan(event.steps);
            break;

          case 'handoff_event':
            setLiveHandoffs((prev) => {
              const idx = prev.findIndex((h) => h.id === event.handoff.id);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = event.handoff;
                return next;
              }
              return [...prev, event.handoff];
            });
            break;

          case 'tool_event':
            setLiveTraces((prev) => {
              const idx = prev.findIndex((tItem) => tItem.id === event.trace.id);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = event.trace;
                return next;
              }
              return [...prev, event.trace];
            });
            break;

          case 'assistant_note':
            setLiveNotes((prev) => [...prev, { agent: event.agent, text: event.text }]);
            break;

          case 'stream_delta':
            setLiveStreamText((prev) => prev + event.delta);
            break;

          case 'approval_required':
            setPendingApprovals((prev) => [...prev, event.approval]);
            break;

          case 'approval_resolved':
            setPendingApprovals((prev) => prev.filter((a) => a.id !== event.approvalId));
            break;

          case 'audit_entry':
            setAuditLogs((prev) => [event.entry, ...prev].slice(0, 300));
            break;

          case 'run_finished':
            setIsRunning(false);
            setLiveStreamText('');
            setSessions((prev) =>
              prev.map((s) =>
                s.id === event.sessionId
                  ? { ...s, messages: [...s.messages, event.message], updatedAt: new Date().toISOString() }
                  : s,
              ),
            );
            void refreshTelemetry();
            break;

          case 'run_error':
            setIsRunning(false);
            void refreshSessions();
            break;
        }
      },
      (connected) => setWsConnected(connected),
    );
    return disconnect;
  }, [refreshSessions, refreshTelemetry]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;
  const activeProvider = providers.find((p) => p.id === settings.provider);

  const needsYouCount = useMemo(() => {
    let count = pendingApprovals.length;
    if (activeProvider && !activeProvider.signedIn) count += 1;
    return count;
  }, [pendingApprovals.length, activeProvider]);

  const openSettingsAt = (sec: SettingsSection = 'general') => {
    setSettingsSection(sec);
    setSettingsOpen(true);
  };

  const patchSettings = async (patch: Partial<AppSettings>) => {
    setSettings((prev) => ({
      ...prev,
      ...patch,
      selectedModels: { ...prev.selectedModels, ...(patch.selectedModels || {}) },
    }));
    const { settings: updated } = await api.updateSettings(patch);
    setSettings(updated);
  };

  const handleSelectProvider = async (nextProvider: ProviderType) => {
    const activeAgentId: AgentId = targetMode === 'auto' ? 'orchestrator' : targetMode;
    const prevRouteProvider = settings.agentRoutes?.[activeAgentId]?.provider || settings.provider;
    if (nextProvider === prevRouteProvider && nextProvider === settings.provider) return;

    const prevName =
      providers.find((p) => p.id === prevRouteProvider)?.name || prevRouteProvider;
    const nextMeta = providers.find((p) => p.id === nextProvider);
    const nextName = nextMeta?.name || nextProvider;

    const isCliProv = nextProvider === 'codex' || nextProvider === 'gemini_agy' || nextProvider === 'claude';
    const nextSlotId = isCliProv
      ? settings.activeSlots?.[nextProvider] || nextMeta?.activeSlotId || 'slot-1'
      : undefined;
    const nextSlot = isCliProv
      ? nextMeta?.slots?.find((s) => s.id === nextSlotId) || nextMeta?.slots?.[0]
      : undefined;

    const existingModel = settings.selectedModels?.[nextProvider];
    const defaultModel =
      nextSlot?.defaultModel || existingModel || nextMeta?.defaultModel || 'default';

    const currentRoutes = settings.agentRoutes || {
      orchestrator: { provider: 'codex', slotId: 'slot-1', model: 'default' },
      file: { provider: 'gemini_agy', slotId: 'slot-1', model: 'gemini-3.8-flash' },
      system: { provider: 'gemini_agy', slotId: 'slot-1', model: 'gemini-3.8-flash' },
      browser: { provider: 'gemini_agy', slotId: 'slot-1', model: 'gemini-3.8-flash' },
    };

    const nextRoutes = {
      ...currentRoutes,
      [activeAgentId]: {
        provider: nextProvider,
        ...(nextSlotId ? { slotId: nextSlotId } : {}),
        model: defaultModel,
      },
    };

    await patchSettings({
      ...(activeAgentId === 'orchestrator' ? { provider: nextProvider } : {}),
      agentRoutes: nextRoutes,
      ...(defaultModel
        ? { selectedModels: { ...settings.selectedModels, [nextProvider]: defaultModel } }
        : {}),
    });

    // Insert a clean inline handoff divider if the active session already has messages
    if (activeSession && activeSession.messages.length > 0 && prevRouteProvider !== nextProvider) {
      const dividerText = t(settings.language).switchedNotice(prevName, nextName);
      try {
        const res = await api.recordHandoff(activeSession.id, {
          fromProvider: prevName,
          toProvider: nextName,
          text: dividerText,
        });
        setSessions((prev) =>
          prev.map((s) => (s.id === activeSession.id ? res.session : s)),
        );
      } catch {
        // non-blocking
      }
    }
  };

  const handleSelectModel = async (provider: ProviderType, modelId: string) => {
    const activeAgentId: AgentId = targetMode === 'auto' ? 'orchestrator' : targetMode;
    const currentRoutes = settings.agentRoutes || {
      orchestrator: { provider: 'codex', slotId: 'slot-1', model: 'default' },
      file: { provider: 'gemini_agy', slotId: 'slot-1', model: 'gemini-3.8-flash' },
      system: { provider: 'gemini_agy', slotId: 'slot-1', model: 'gemini-3.8-flash' },
      browser: { provider: 'gemini_agy', slotId: 'slot-1', model: 'gemini-3.8-flash' },
    };
    const existingRoute = currentRoutes[activeAgentId];
    const patch: Partial<AppSettings> = {
      selectedModels: { ...settings.selectedModels, [provider]: modelId },
      agentRoutes: {
        ...currentRoutes,
        [activeAgentId]: {
          ...existingRoute,
          provider,
          model: modelId,
        },
      },
    };
    if (provider === 'ollama') patch.ollamaModel = modelId;
    await patchSettings(patch);
  };

  const handleSelectEffort = async (effort: EffortLevel) => {
    await patchSettings({ effort });
  };

  const handleSelectPermission = async (mode: SafetyMode) => {
    await patchSettings({ safetyMode: mode });
  };

  const handleNewSession = async () => {
    const { session } = await api.createSession();
    setSessions((prev) => [session, ...prev]);
    setActiveSessionId(session.id);
    setLivePlan([]);
    setLiveHandoffs([]);
    setLiveTraces([]);
    setLiveNotes([]);
  };

  const handleDeleteSession = async (id: string) => {
    await api.deleteSession(id);
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (activeSessionId === id) {
        setActiveSessionId(next[0]?.id || null);
      }
      return next;
    });
  };

  const handleSend = async (prompt: string, overrideTarget?: TargetMode) => {
    const target = overrideTarget || targetMode;
    try {
      const res = await api.runMission({
        sessionId: activeSessionId || undefined,
        prompt,
        target,
      });

      setActiveSessionId(res.sessionId);
      setSessions((prev) => {
        const exists = prev.some((s) => s.id === res.sessionId);
        if (exists) {
          return prev.map((s) =>
            s.id === res.sessionId
              ? {
                  ...s,
                  title:
                    s.messages.filter((m) => m.role === 'user').length === 0
                      ? prompt.slice(0, 48)
                      : s.title,
                  messages: [...s.messages, res.userMessage],
                }
              : s,
          );
        }
        return [
          {
            id: res.sessionId,
            title: prompt.slice(0, 48),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messages: [res.userMessage],
          },
          ...prev,
        ];
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to start mission');
    }
  };

  const handleStop = async () => {
    if (!activeSessionId) return;
    await api.stopMission(activeSessionId);
    setIsRunning(false);
  };

  const handleRunPreset = (preset: WorkflowPreset) => {
    setTargetMode(preset.target);
    void handleSend(preset.prompt, preset.target);
  };

  const handleDecideApproval = async (
    approvalId: string,
    approved: boolean,
    rememberForSession = false,
  ) => {
    await api.resolveApproval(approvalId, approved, rememberForSession);
    setPendingApprovals((prev) => prev.filter((a) => a.id !== approvalId));
  };

  const handleTriggerLogin = async (provider: ProviderType, slotId?: string) => {
    const res = await api.loginProvider(provider, slotId);
    setProviders(res.providers);
    if (res.settings) setSettings(res.settings);
  };

  const handleTogglePin = async (messageId: string) => {
    if (!activeSessionId) return;
    const res = await api.togglePin(activeSessionId, messageId);
    setSessions((prev) => prev.map((s) => (s.id === activeSessionId ? res.session : s)));
  };

  const handleQuickScreenshot = async (): Promise<string | null> => {
    try {
      const res = await api.takeScreenshot();
      return res.dataUrl;
    } catch {
      return null;
    }
  };

  const handleCycleTheme = () => {
    const idx = THEME_SWATCHES.findIndex((s) => s.id === settings.theme);
    const next = THEME_SWATCHES[(idx + 1) % THEME_SWATCHES.length].id;
    void patchSettings({ theme: next });
  };

  const handleToggleGlass = () => {
    const nextOpacity = settings.glassOpacity > 86 ? 82 : 96;
    void patchSettings({ glassOpacity: nextOpacity });
  };

  const handleClickNeedsYou = () => {
    if (pendingApprovals.length > 0) {
      // Approvals render directly inside active chat stream
      return;
    }
    openSettingsAt('accounts');
  };

  const handleOpenWorkspaceFolder = () => {
    if (window.nexusDesktop?.openFolder && settings.defaultWorkspace) {
      void window.nexusDesktop.openFolder(settings.defaultWorkspace);
    } else {
      openSettingsAt('folders');
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col nexus-canvas">
      {/* Unified Frameless Top Bar */}
      <TopBar
        language={settings.language}
        wsConnected={wsConnected}
        needsYouCount={needsYouCount}
        glassOpacity={settings.glassOpacity}
        inspectorOpen={inspectorOpen}
        refreshingProviders={refreshingProviders}
        onOpenCommandPalette={() => setPaletteOpen(true)}
        onClickNeedsYou={handleClickNeedsYou}
        onChangeGlassOpacity={(val) => void patchSettings({ glassOpacity: val })}
        onToggleInspector={() => setInspectorOpen((v) => !v)}
        onRefreshProviders={() => void refreshProviders(true)}
      />

      {/* Main Floating Studio Workspace */}
      <div className="flex-1 min-h-0 px-2 pb-2 flex gap-2">
        {sidebarOpen && (
          <Sidebar
            settings={settings}
            providers={providers}
            agentStates={agentStates}
            sessions={sessions}
            activeSessionId={activeSessionId}
            targetMode={targetMode}
            needsYouCount={needsYouCount}
            splitView={splitView}
            onNewSession={() => void handleNewSession()}
            onSelectSession={(id) => setActiveSessionId(id)}
            onDeleteSession={(id) => void handleDeleteSession(id)}
            onSelectTarget={setTargetMode}
            onClickNeedsYou={handleClickNeedsYou}
            onToggleSplitView={handleToggleSplitView}
            onQuickScreenshot={() => void handleQuickScreenshot()}
            onOpenWorkspaceFolder={handleOpenWorkspaceFolder}
            onOpenSettings={(sec) => openSettingsAt((sec as SettingsSection) || 'general')}
            onCycleTheme={handleCycleTheme}
            onToggleGlass={handleToggleGlass}
          />
        )}

        <ChatPanel
          sessionTitle={activeSession?.title || 'New Mission'}
          messages={activeSession?.messages || []}
          pinnedIds={activeSession?.pinnedMessageIds || []}
          targetMode={targetMode}
          settings={settings}
          providers={providers}
          presets={presets}
          isRunning={isRunning}
          sidebarOpen={sidebarOpen}
          inspectorOpen={inspectorOpen}
          splitView={splitView}
          liveNotes={liveNotes}
          liveStreamText={liveStreamText}
          livePlan={livePlan}
          liveHandoffs={liveHandoffs}
          liveTraces={liveTraces}
          pendingApprovals={pendingApprovals}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onToggleInspector={() => setInspectorOpen((v) => !v)}
          onToggleSplitView={handleToggleSplitView}
          onNewSession={() => void handleNewSession()}
          onChangeTarget={setTargetMode}
          onSend={(p) => void handleSend(p)}
          onStop={() => void handleStop()}
          onRunPreset={handleRunPreset}
          onSelectProvider={(p) => void handleSelectProvider(p)}
          onSelectModel={(p, m) => void handleSelectModel(p, m)}
          onSelectEffort={(e) => void handleSelectEffort(e)}
          onSelectPermission={(m) => void handleSelectPermission(m)}
          onDecideApproval={(id, ok, rem) => void handleDecideApproval(id, ok, rem)}
          onTriggerLogin={handleTriggerLogin}
          onRefreshProviders={() => refreshProviders(true)}
          onTogglePin={(id) => void handleTogglePin(id)}
          onQuickScreenshot={() => void handleQuickScreenshot()}
          onOpenCommandPalette={() => setPaletteOpen(true)}
          onOpenSettings={(sec) => openSettingsAt((sec as SettingsSection) || 'general')}
        />

        {/* Single Right Context Inspector */}
        {inspectorOpen && (
          <InspectorPanel
            language={settings.language}
            targetMode={targetMode}
            activeSession={activeSession}
            activeProvider={activeProvider}
            agentStates={agentStates}
            livePlan={livePlan}
            liveHandoffs={liveHandoffs}
            liveTraces={liveTraces}
            auditLogs={auditLogs}
            telemetry={telemetry}
            telemetryLoading={telemetryLoading}
            tab={inspectorTab}
            onTabChange={setInspectorTab}
            closable
            onClose={() => setInspectorOpen(false)}
            onRefreshTelemetry={() => void refreshTelemetry()}
            onQuickScreenshot={handleQuickScreenshot}
          />
        )}
      </div>

      {/* Ctrl+K Command Palette */}
      <CommandPalette
        open={paletteOpen}
        sessions={sessions}
        presets={presets}
        providers={providers}
        onClose={() => setPaletteOpen(false)}
        onNewSession={() => void handleNewSession()}
        onSelectSession={(id) => setActiveSessionId(id)}
        onSelectTarget={setTargetMode}
        onSwitchProvider={(p) => void handleSelectProvider(p)}
        onRunPreset={handleRunPreset}
        onToggleSplitView={handleToggleSplitView}
        onQuickScreenshot={() => void handleQuickScreenshot()}
        onOpenSettings={(sec) => openSettingsAt((sec as SettingsSection) || 'general')}
      />

      {/* 2-Column Studio Settings Modal */}
      <SettingsModal
        open={settingsOpen}
        initialSection={settingsSection}
        settings={settings}
        providers={providers}
        presets={presets}
        onClose={() => setSettingsOpen(false)}
        onSaved={(next) => setSettings(next)}
        onProvidersUpdated={(list) => setProviders(list)}
        onPresetsChanged={() => void refreshPresets()}
      />
    </div>
  );
}

export default App;
