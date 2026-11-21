import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type {
  AccountSlotConfig,
  AgentId,
  AgentRouteConfig,
  AppSettings,
  AuditLogEntry,
  ChatMessage,
  ChatSession,
  CliAccountProvider,
  StorageStats,
  WorkflowPreset,
} from '../../shared/types.js';

const DATA_DIR = path.resolve(process.cwd(), '.nexus-data');
const CLI_HOMES_ROOT = path.resolve(process.cwd(), 'data', 'cli-homes');
const SCREENSHOTS_DIR = path.join(DATA_DIR, 'screenshots');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const PRESETS_FILE = path.join(DATA_DIR, 'presets.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit-log.json');

export function getDataDir(): string {
  return DATA_DIR;
}

export function getCliHomesRoot(): string {
  return CLI_HOMES_ROOT;
}

export function getSlotCliHomeDir(provider: CliAccountProvider, slotId: string): string {
  const safeSlot = slotId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeSlot || safeSlot !== slotId) {
    throw new Error(`Invalid slot ID: ${slotId}`);
  }
  const resolved = path.resolve(CLI_HOMES_ROOT, provider, safeSlot);
  if (!resolved.startsWith(CLI_HOMES_ROOT + path.sep)) {
    throw new Error(`Resolved slot path escaped CLI homes root: ${resolved}`);
  }
  return resolved;
}

export function getScreenshotsDir(): string {
  return SCREENSHOTS_DIR;
}

export function createDefaultAccountSlots(): Record<CliAccountProvider, AccountSlotConfig[]> {
  const createdAt = '2026-01-01T00:00:00.000Z';
  return {
    codex: [
      {
        id: 'slot-1',
        label: 'Account 1 (Default)',
        cliEngine: 'codex',
        createdAt,
      },
    ],
    gemini_agy: [
      {
        id: 'slot-1',
        label: 'Account 1 (Default · Antigravity)',
        cliEngine: 'agy',
        createdAt,
      },
    ],
    claude: [
      {
        id: 'slot-1',
        label: 'Account 1 (Default)',
        cliEngine: 'claude',
        createdAt,
      },
    ],
  };
}

export const DEFAULT_AGENT_ROUTES: Record<AgentId, AgentRouteConfig> = {
  orchestrator: {
    provider: 'codex',
    slotId: 'slot-1',
    model: 'default',
  },
  file: {
    provider: 'gemini_agy',
    slotId: 'slot-1',
    model: 'gemini-3.8-flash',
  },
  system: {
    provider: 'gemini_agy',
    slotId: 'slot-1',
    model: 'gemini-3.8-flash',
  },
  browser: {
    provider: 'gemini_agy',
    slotId: 'slot-1',
    model: 'gemini-3.8-flash',
  },
};

export const DEFAULT_SETTINGS: AppSettings = {
  provider: 'codex',
  effort: 'medium',
  selectedModels: {
    gemini_agy: 'gemini-3.8-flash',
    codex: 'default',
    claude: 'sonnet',
    ollama: 'qwen2.5:7b',
  },
  disconnectedProviders: [],
  accountSlots: createDefaultAccountSlots(),
  activeSlots: {
    codex: 'slot-1',
    gemini_agy: 'slot-1',
    claude: 'slot-1',
  },
  agentRoutes: {
    orchestrator: { ...DEFAULT_AGENT_ROUTES.orchestrator },
    file: { ...DEFAULT_AGENT_ROUTES.file },
    system: { ...DEFAULT_AGENT_ROUTES.system },
    browser: { ...DEFAULT_AGENT_ROUTES.browser },
  },
  userName: 'Nha',
  language: 'en',
  theme: 'midnight',
  glassOpacity: 92,
  textSize: 'default',
  safetyMode: 'smart',
  defaultWorkspace: path.join(os.homedir(), 'Desktop'),
  maxToolSteps: 10,
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'qwen2.5:7b',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: 'gemini-2.5-flash',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: 'gpt-4o-mini',
};

export const BUILTIN_PRESETS: WorkflowPreset[] = [
  {
    id: 'preset-system-health',
    name: 'Laptop Health Audit',
    khmerLabel: 'ពិនិត្យសុខភាព Laptop',
    description: 'System Agent inspects CPU, RAM, drives, and top processes and summarizes recommendations.',
    target: 'auto',
    prompt:
      'ពិនិត្យសុខភាព laptop របស់ខ្ញុំទាំងមូល (CPU, RAM, Disk space, Top processes ដែលស៊ី RAM ច្រើន) ហើយសង្ខេបជាភាសាខ្មែរ + ណែនាំអ្វីគួរបិទឬសម្អាត។',
    agentsInvolved: ['orchestrator', 'system'],
    builtIn: true,
  },
  {
    id: 'preset-desktop-audit',
    name: 'Scan Desktop & Organize Plan',
    khmerLabel: 'ស្កេន Desktop & រៀបចំឯកសារ',
    description: 'File Agent scans your Desktop folder and suggests a clean folder organization without deleting anything.',
    target: 'auto',
    prompt:
      'ប្រើ File Agent ស្កេនមើល files និង folders ទាំងអស់លើ Desktop របស់ខ្ញុំ ហើយរៀបចំសំណើបែងចែក folder ឲ្យមានរបៀប (កុំទាន់លុប ឬផ្លាស់ទីអី ស្នើសិន)។',
    agentsInvolved: ['orchestrator', 'file'],
    builtIn: true,
  },
  {
    id: 'preset-research-save',
    name: 'Web Research → Desktop Note',
    khmerLabel: 'ស្រាវជ្រាវ Web ហើយរក្សាទុក File',
    description: 'Browser Agent researches a topic online, then File Agent writes a clean Markdown summary to Desktop.',
    target: 'auto',
    prompt:
      'ប្រើ Browser Agent ស្រាវជ្រាវអំពី "Model Context Protocol (MCP) for AI Agents" ហើយឲ្យ File Agent បង្កើត file សង្ខេបជា Markdown ឈ្មោះ mcp-summary.md ដាក់លើ Desktop។',
    agentsInvolved: ['orchestrator', 'browser', 'file'],
    builtIn: true,
  },
  {
    id: 'preset-screen-inspect',
    name: 'Capture & Explain Screen',
    khmerLabel: 'ថត Screen ហើយវិភាគ',
    description: 'System Agent captures the current desktop screen and reports active apps & what is visible.',
    target: 'auto',
    prompt:
      'ថត screenshot អេក្រង់ laptop ឥឡូវនេះ ហើយពិនិត្យមើលថាមាន app អ្វីខ្លះកំពុងបើកដំណើរការ រួចសង្ខេបឲ្យខ្ញុំ។',
    agentsInvolved: ['orchestrator', 'system'],
    builtIn: true,
  },
];

async function ensureDirs(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await ensureDirs();
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function normalizeAccountSlots(
  saved?: Partial<Record<CliAccountProvider, AccountSlotConfig[]>>,
  disconnectedProviders?: string[],
): Record<CliAccountProvider, AccountSlotConfig[]> {
  const defaults = createDefaultAccountSlots();
  const out = {} as Record<CliAccountProvider, AccountSlotConfig[]>;

  (['codex', 'gemini_agy', 'claude'] as CliAccountProvider[]).forEach((prov) => {
    const defSlot1 = defaults[prov][0];
    const incoming = Array.isArray(saved?.[prov]) ? saved![prov]! : [];
    const hasSlot1 = incoming.some((s) => s.id === 'slot-1');
    const merged: AccountSlotConfig[] = hasSlot1
      ? incoming.map((s) =>
          s.id === 'slot-1'
            ? {
                ...defSlot1,
                ...s,
                id: 'slot-1',
                cliEngine: prov === 'gemini_agy' ? 'agy' : prov,
                homeDir: undefined,
              }
            : s,
        )
      : [
          {
            ...defSlot1,
            disconnected: Boolean(disconnectedProviders?.includes(prov)),
          },
          ...incoming,
        ];
    out[prov] = merged;
  });

  return out;
}

function normalizeAgentRoutes(
  saved: Partial<Record<AgentId, AgentRouteConfig>> | undefined,
  slots: Record<CliAccountProvider, AccountSlotConfig[]>,
  selectedModels: AppSettings['selectedModels'],
): Record<AgentId, AgentRouteConfig> {
  const agents: AgentId[] = ['orchestrator', 'file', 'system', 'browser'];
  const out = {} as Record<AgentId, AgentRouteConfig>;

  for (const agent of agents) {
    const base = DEFAULT_AGENT_ROUTES[agent];
    const raw = saved?.[agent];
    const provider = raw?.provider || base.provider;
    let slotId = raw?.slotId;

    if (provider === 'codex' || provider === 'gemini_agy' || provider === 'claude') {
      const provSlots = slots[provider] || [];
      if (!slotId || !provSlots.some((s) => s.id === slotId)) {
        slotId = 'slot-1';
      }
    } else {
      slotId = undefined;
    }

    const fallbackModel =
      raw?.model ||
      (agent === 'orchestrator' && provider === 'codex'
        ? selectedModels?.codex || 'default'
        : base.model);

    out[agent] = {
      provider,
      ...(slotId ? { slotId } : {}),
      model: fallbackModel,
    };
  }

  return out;
}

export async function loadSettings(): Promise<AppSettings> {
  await ensureDirs();
  const saved = await readJson<Omit<Partial<AppSettings>, 'provider'> & { provider?: string }>(
    SETTINGS_FILE,
    {},
  );

  // Migrate legacy 'gemini' without key seamlessly to account-based 'gemini_agy'
  let normalizedProvider = saved.provider;
  if (normalizedProvider === 'gemini') {
    normalizedProvider = saved.geminiApiKey?.trim() ? 'gemini_api' : 'gemini_agy';
  }

  const selectedModels = {
    ...DEFAULT_SETTINGS.selectedModels,
    ...(saved.selectedModels || {}),
  };
  const accountSlots = normalizeAccountSlots(saved.accountSlots, saved.disconnectedProviders);
  const activeSlots: Record<CliAccountProvider, string> = {
    codex: saved.activeSlots?.codex || 'slot-1',
    gemini_agy: saved.activeSlots?.gemini_agy || 'slot-1',
    claude: saved.activeSlots?.claude || 'slot-1',
  };
  (['codex', 'gemini_agy', 'claude'] as CliAccountProvider[]).forEach((prov) => {
    if (!accountSlots[prov].some((s) => s.id === activeSlots[prov])) {
      activeSlots[prov] = 'slot-1';
    }
  });

  const agentRoutes = normalizeAgentRoutes(saved.agentRoutes, accountSlots, selectedModels);

  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    provider: (normalizedProvider as AppSettings['provider']) || DEFAULT_SETTINGS.provider,
    selectedModels,
    accountSlots,
    activeSlots,
    agentRoutes,
  };
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await loadSettings();
  const nextSelectedModels = {
    ...current.selectedModels,
    ...(patch.selectedModels || {}),
  };
  const nextAccountSlots = normalizeAccountSlots(
    {
      ...current.accountSlots,
      ...(patch.accountSlots || {}),
    },
    patch.disconnectedProviders ?? current.disconnectedProviders,
  );
  const nextActiveSlots: Record<CliAccountProvider, string> = {
    codex: patch.activeSlots?.codex || current.activeSlots?.codex || 'slot-1',
    gemini_agy: patch.activeSlots?.gemini_agy || current.activeSlots?.gemini_agy || 'slot-1',
    claude: patch.activeSlots?.claude || current.activeSlots?.claude || 'slot-1',
  };
  (['codex', 'gemini_agy', 'claude'] as CliAccountProvider[]).forEach((prov) => {
    if (!nextAccountSlots[prov].some((s) => s.id === nextActiveSlots[prov])) {
      nextActiveSlots[prov] = 'slot-1';
    }
  });
  const nextAgentRoutes = normalizeAgentRoutes(
    {
      ...current.agentRoutes,
      ...(patch.agentRoutes || {}),
    },
    nextAccountSlots,
    nextSelectedModels,
  );

  const next: AppSettings = {
    ...current,
    ...patch,
    selectedModels: nextSelectedModels,
    accountSlots: nextAccountSlots,
    activeSlots: nextActiveSlots,
    agentRoutes: nextAgentRoutes,
  };
  await writeJson(SETTINGS_FILE, next);
  return next;
}

export async function loadSessions(): Promise<ChatSession[]> {
  await ensureDirs();
  const sessions = await readJson<ChatSession[]>(SESSIONS_FILE, []);
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function saveSessions(sessions: ChatSession[]): Promise<void> {
  await writeJson(SESSIONS_FILE, sessions.slice(0, 50));
}

export async function createSession(title = 'New Mission'): Promise<ChatSession> {
  const sessions = await loadSessions();
  const now = new Date().toISOString();
  const session: ChatSession = {
    id: randomUUID(),
    title,
    createdAt: now,
    updatedAt: now,
    messages: [],
    pinnedMessageIds: [],
  };
  sessions.unshift(session);
  await saveSessions(sessions);
  return session;
}

export async function getOrCreateSession(sessionId?: string): Promise<ChatSession> {
  const sessions = await loadSessions();
  if (sessionId) {
    const found = sessions.find((s) => s.id === sessionId);
    if (found) return found;
  }
  return createSession();
}

export async function updateSession(session: ChatSession): Promise<void> {
  const sessions = await loadSessions();
  const idx = sessions.findIndex((s) => s.id === session.id);
  session.updatedAt = new Date().toISOString();
  if (idx >= 0) {
    sessions[idx] = session;
  } else {
    sessions.unshift(session);
  }
  await saveSessions(sessions);
}

export async function appendSessionSystemMessage(
  sessionId: string,
  message: ChatMessage,
): Promise<ChatSession | null> {
  const sessions = await loadSessions();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return null;
  session.messages.push(message);
  session.updatedAt = new Date().toISOString();
  await saveSessions(sessions);
  return session;
}

export async function togglePinMessage(sessionId: string, messageId: string): Promise<ChatSession | null> {
  const sessions = await loadSessions();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return null;
  const set = new Set(session.pinnedMessageIds || []);
  if (set.has(messageId)) {
    set.delete(messageId);
  } else {
    set.add(messageId);
  }
  session.pinnedMessageIds = Array.from(set);
  await saveSessions(sessions);
  return session;
}

export async function deleteSession(sessionId: string): Promise<void> {
  const sessions = await loadSessions();
  await saveSessions(sessions.filter((s) => s.id !== sessionId));
}

export async function loadPresets(): Promise<WorkflowPreset[]> {
  await ensureDirs();
  const custom = await readJson<WorkflowPreset[]>(PRESETS_FILE, []);
  return [...BUILTIN_PRESETS, ...custom];
}

export async function saveCustomPreset(
  preset: Omit<WorkflowPreset, 'id' | 'builtIn'>,
): Promise<WorkflowPreset> {
  await ensureDirs();
  const custom = await readJson<WorkflowPreset[]>(PRESETS_FILE, []);
  const created: WorkflowPreset = {
    ...preset,
    id: `custom-${randomUUID().slice(0, 8)}`,
    builtIn: false,
  };
  custom.unshift(created);
  await writeJson(PRESETS_FILE, custom);
  return created;
}

export async function deleteCustomPreset(id: string): Promise<void> {
  const custom = await readJson<WorkflowPreset[]>(PRESETS_FILE, []);
  await writeJson(PRESETS_FILE, custom.filter((p) => p.id !== id));
}

export async function loadAuditLogs(): Promise<AuditLogEntry[]> {
  await ensureDirs();
  return readJson<AuditLogEntry[]>(AUDIT_FILE, []);
}

export async function appendAuditLog(entry: AuditLogEntry): Promise<void> {
  const logs = await loadAuditLogs();
  logs.unshift(entry);
  await writeJson(AUDIT_FILE, logs.slice(0, 300));
}

async function dirSizeBytes(dir: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        const sub = await dirSizeBytes(full);
        bytes += sub.bytes;
        files += sub.files;
      } else {
        const stat = await fs.stat(full);
        bytes += stat.size;
        files += 1;
      }
    }
  } catch {
    // ignore
  }
  return { bytes, files };
}

export async function getStorageStats(): Promise<StorageStats> {
  await ensureDirs();
  const [sessions, auditLogs, total, shots] = await Promise.all([
    loadSessions(),
    loadAuditLogs(),
    dirSizeBytes(DATA_DIR),
    dirSizeBytes(SCREENSHOTS_DIR),
  ]);
  return {
    dataDir: DATA_DIR,
    sessionsCount: sessions.length,
    auditLogsCount: auditLogs.length,
    screenshotsCount: shots.files,
    totalBytes: total.bytes,
  };
}
