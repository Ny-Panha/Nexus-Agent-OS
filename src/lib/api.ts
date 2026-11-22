import type {
  AccountSlotConfig,
  AgentMeta,
  AppSettings,
  AuditLogEntry,
  ChatMessage,
  ChatSession,
  CliAccountProvider,
  PendingApproval,
  ProviderAccountStatus,
  ProviderType,
  ServerWsEvent,
  StorageStats,
  SystemTelemetry,
  TargetMode,
  WorkflowPreset,
} from '../../shared/types';

const API_BASE = '';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return data as T;
}

export const api = {
  getAgents: () => request<{ agents: AgentMeta[] }>('/api/agents'),
  getProviderStatuses: (refresh = false) =>
    request<{ providers: ProviderAccountStatus[] }>(`/api/providers/status${refresh ? '?refresh=1' : ''}`),
  loginProvider: (provider: ProviderType, slotId?: string) =>
    request<{
      ok: boolean;
      message: string;
      openedTerminal?: boolean;
      settings?: AppSettings;
      providers: ProviderAccountStatus[];
    }>(`/api/providers/${provider}/login`, {
      method: 'POST',
      body: JSON.stringify(slotId ? { slotId } : {}),
    }),
  logoutProvider: (provider: ProviderType, slotId?: string) =>
    request<{
      ok: boolean;
      message: string;
      settings?: AppSettings;
      providers: ProviderAccountStatus[];
    }>(`/api/providers/${provider}/logout`, {
      method: 'POST',
      body: JSON.stringify(slotId ? { slotId } : {}),
    }),
  addProviderSlot: (provider: CliAccountProvider, label?: string) =>
    request<{
      ok: boolean;
      slot: AccountSlotConfig;
      settings: AppSettings;
      message: string;
      providers: ProviderAccountStatus[];
    }>(`/api/providers/${provider}/slots`, {
      method: 'POST',
      body: JSON.stringify(label ? { label } : {}),
    }),
  removeProviderSlot: (provider: CliAccountProvider, slotId: string) =>
    request<{
      ok: boolean;
      settings: AppSettings;
      message: string;
      providers: ProviderAccountStatus[];
    }>(`/api/providers/${provider}/slots/${slotId}`, {
      method: 'DELETE',
    }),
  loginProviderSlot: (provider: CliAccountProvider, slotId: string) =>
    request<{
      ok: boolean;
      message: string;
      openedTerminal?: boolean;
      settings?: AppSettings;
      providers: ProviderAccountStatus[];
    }>(`/api/providers/${provider}/slots/${slotId}/login`, {
      method: 'POST',
    }),
  logoutProviderSlot: (provider: CliAccountProvider, slotId: string) =>
    request<{
      ok: boolean;
      message: string;
      settings?: AppSettings;
      providers: ProviderAccountStatus[];
    }>(`/api/providers/${provider}/slots/${slotId}/logout`, {
      method: 'POST',
    }),
  activateProviderSlot: (provider: CliAccountProvider, slotId: string) =>
    request<{
      ok: boolean;
      settings: AppSettings;
      message: string;
      providers: ProviderAccountStatus[];
    }>(`/api/providers/${provider}/slots/${slotId}/activate`, {
      method: 'POST',
    }),
  refreshProviders: () =>
    request<{ ok: boolean; providers: ProviderAccountStatus[] }>('/api/providers/refresh', {
      method: 'POST',
    }),
  getSettings: () => request<{ settings: AppSettings }>('/api/settings'),
  updateSettings: (patch: Partial<AppSettings>) =>
    request<{ settings: AppSettings }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  testConnection: (settings: Partial<AppSettings>) =>
    request<{ ok: boolean; message: string }>('/api/settings/test', {
      method: 'POST',
      body: JSON.stringify(settings),
    }),
  getOllamaModels: () => request<{ ok: boolean; models: string[]; error?: string }>('/api/ollama/models'),
  getSessions: () => request<{ sessions: ChatSession[] }>('/api/sessions'),
  createSession: (title?: string) =>
    request<{ session: ChatSession }>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),
  recordHandoff: (sessionId: string, payload: { fromProvider: string; toProvider: string; text: string }) =>
    request<{ session: ChatSession; message: ChatMessage }>(`/api/sessions/${sessionId}/handoff`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  togglePin: (sessionId: string, messageId: string) =>
    request<{ session: ChatSession }>(`/api/sessions/${sessionId}/pin`, {
      method: 'POST',
      body: JSON.stringify({ messageId }),
    }),
  deleteSession: (id: string) => request<{ ok: boolean }>(`/api/sessions/${id}`, { method: 'DELETE' }),
  getPresets: () => request<{ presets: WorkflowPreset[] }>('/api/presets'),
  createPreset: (preset: Omit<WorkflowPreset, 'id' | 'builtIn'>) =>
    request<{ preset: WorkflowPreset }>('/api/presets', {
      method: 'POST',
      body: JSON.stringify(preset),
    }),
  deletePreset: (id: string) => request<{ ok: boolean }>(`/api/presets/${id}`, { method: 'DELETE' }),
  updatePreset: (id: string, patch: Partial<Omit<WorkflowPreset, 'id' | 'builtIn' | 'edited'>>) =>
    request<{ preset: WorkflowPreset }>(`/api/presets/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  resetPreset: (id: string) =>
    request<{ preset: WorkflowPreset }>(`/api/presets/${id}/reset`, { method: 'POST' }),
  runMission: (payload: { sessionId?: string; prompt: string; target: TargetMode }) =>
    request<{ accepted: boolean; sessionId: string; userMessage: ChatMessage }>('/api/chat/run', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  stopMission: (sessionId: string) =>
    request<{ ok: boolean }>('/api/chat/stop', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    }),
  getApprovals: () => request<{ approvals: PendingApproval[] }>('/api/approvals'),
  resolveApproval: (approvalId: string, approved: boolean, rememberForSession = false) =>
    request<{ ok: boolean }>(`/api/approvals/${approvalId}`, {
      method: 'POST',
      body: JSON.stringify({ approved, rememberForSession }),
    }),
  getAuditLogs: () => request<{ logs: AuditLogEntry[] }>('/api/audit'),
  getStorageStats: () => request<{ stats: StorageStats }>('/api/storage/stats'),
  getTelemetry: () => request<{ telemetry: SystemTelemetry }>('/api/system/telemetry'),
  takeScreenshot: () =>
    request<{ ok: boolean; filePath: string; sizeKb: number; dataUrl: string }>('/api/system/screenshot', {
      method: 'POST',
    }),
};

export function connectEventStream(
  onEvent: (event: ServerWsEvent) => void,
  onStatus: (connected: boolean) => void,
): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let timer: number | undefined;

  const connect = () => {
    if (closed) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${window.location.host}/ws`);

    ws.onopen = () => onStatus(true);
    ws.onclose = () => {
      onStatus(false);
      if (!closed) {
        timer = window.setTimeout(connect, 1800);
      }
    };
    ws.onerror = () => {
      ws?.close();
    };
    ws.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(String(msg.data)) as ServerWsEvent;
        onEvent(parsed);
      } catch {
        // ignore malformed event
      }
    };
  };

  connect();

  return () => {
    closed = true;
    if (timer) window.clearTimeout(timer);
    ws?.close();
  };
}
