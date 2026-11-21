export type AgentId = 'orchestrator' | 'file' | 'system' | 'browser';

export type TargetMode = 'auto' | AgentId;

export type SafetyMode = 'read_only' | 'smart' | 'safe' | 'full_auto';

export type ToolRisk = 'read' | 'write' | 'danger';

export type ProviderType =
  | 'gemini_agy'
  | 'codex'
  | 'claude'
  | 'ollama'
  | 'gemini_api'
  | 'openai_compatible';

export type CliAccountProvider = 'gemini_agy' | 'codex' | 'claude';

export type CliEngineKind = 'agy' | 'gemini_cli' | 'codex' | 'claude';

export interface AccountSlotConfig {
  id: string;
  label: string;
  cliEngine: CliEngineKind;
  /** Relative path under project root (e.g. data/cli-homes/codex/slot-2); omitted for Slot 1 OS default home */
  homeDir?: string;
  disconnected?: boolean;
  createdAt: string;
}

export interface AccountSlotStatus {
  id: string;
  provider: CliAccountProvider;
  label: string;
  cliEngine: CliEngineKind;
  homeDir?: string;
  homeDirHint: string;
  installed: boolean;
  signedIn: boolean;
  binaryPath?: string;
  accountLabel?: string;
  models: ModelOption[];
  defaultModel: string;
  error?: string;
  canLogin: boolean;
  loginActionLabel?: string;
  canLogout: boolean;
  logoutActionLabel?: string;
  isDefault: boolean;
}

export interface AgentRouteConfig {
  provider: ProviderType;
  slotId?: string;
  model: string;
}

export interface SafetyModeEnforcement {
  enforced: 'full' | 'partial' | 'sandbox_fallback';
  flagSummary: string;
  note: string;
}

export const CLI_SAFETY_SUPPORT: Record<CliEngineKind | 'native', Record<SafetyMode, SafetyModeEnforcement>> = {
  codex: {
    read_only: {
      enforced: 'full',
      flagSummary: '-s read-only',
      note: 'Enforced by Codex read-only sandbox.',
    },
    safe: {
      enforced: 'sandbox_fallback',
      flagSummary: '-s read-only',
      note: 'codex exec is non-interactive and cannot prompt per tool; Safe enforces read-only sandbox.',
    },
    smart: {
      enforced: 'full',
      flagSummary: '-s workspace-write',
      note: 'Confines writes to the workspace sandbox.',
    },
    full_auto: {
      enforced: 'full',
      flagSummary: '--dangerously-bypass-approvals-and-sandbox',
      note: 'Runs tools without approvals or sandbox.',
    },
  },
  agy: {
    read_only: {
      enforced: 'full',
      flagSummary: '--mode plan',
      note: 'Enforced by Antigravity plan mode.',
    },
    safe: {
      enforced: 'sandbox_fallback',
      flagSummary: '--mode plan --sandbox',
      note: 'Headless agy stream-json cannot pause for interactive chat prompts; Safe enforces plan + sandbox.',
    },
    smart: {
      enforced: 'full',
      flagSummary: '--mode accept-edits --sandbox',
      note: 'Allows workspace edits with terminal sandbox restrictions.',
    },
    full_auto: {
      enforced: 'full',
      flagSummary: '--dangerously-skip-permissions',
      note: 'Auto-approves all tool calls without asking.',
    },
  },
  gemini_cli: {
    read_only: {
      enforced: 'full',
      flagSummary: '--approval-mode plan',
      note: 'Enforced by Gemini CLI read-only plan mode.',
    },
    safe: {
      enforced: 'sandbox_fallback',
      flagSummary: '--approval-mode plan -s',
      note: 'Headless gemini -p cannot prompt interactively; Safe enforces plan mode + sandbox.',
    },
    smart: {
      enforced: 'full',
      flagSummary: '--approval-mode auto_edit',
      note: 'Auto-approves file edits; blocks unapproved shell actions.',
    },
    full_auto: {
      enforced: 'full',
      flagSummary: '--approval-mode yolo',
      note: 'Auto-approves all tools without prompting.',
    },
  },
  claude: {
    read_only: {
      enforced: 'full',
      flagSummary: '--permission-mode plan',
      note: 'Enforced by Claude Code plan mode.',
    },
    safe: {
      enforced: 'partial',
      flagSummary: '--permission-mode manual --permission-prompts none',
      note: 'Headless claude -p cannot prompt interactively; unapproved tools are denied automatically.',
    },
    smart: {
      enforced: 'full',
      flagSummary: '--permission-mode acceptEdits --permission-prompts none',
      note: 'Auto-approves workspace edits; denies unapproved shell commands.',
    },
    full_auto: {
      enforced: 'full',
      flagSummary: '--dangerously-skip-permissions',
      note: 'Bypasses all permission checks.',
    },
  },
  native: {
    read_only: {
      enforced: 'full',
      flagSummary: 'Nexus PermissionGate (read-only)',
      note: 'Blocks all write and danger tools.',
    },
    safe: {
      enforced: 'full',
      flagSummary: 'Nexus PermissionGate (ask every tool)',
      note: 'Prompts inline in chat before every tool execution.',
    },
    smart: {
      enforced: 'full',
      flagSummary: 'Nexus PermissionGate (ask writes/danger)',
      note: 'Auto-allows reads; prompts inline for writes and shell commands.',
    },
    full_auto: {
      enforced: 'full',
      flagSummary: 'Nexus PermissionGate (auto-allow)',
      note: 'Runs all tools without asking.',
    },
  },
};

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type ThemeId =
  | 'midnight'
  | 'angkor'
  | 'tonle_sap'
  | 'royal_lacquer'
  | 'forest'
  | 'sakura'
  | 'sunset'
  | 'cyberpunk';

export type UiLanguage = 'en' | 'km';

export type TextSize = 'small' | 'default' | 'large';

export type AgentRunState =
  | 'idle'
  | 'thinking'
  | 'running_tool'
  | 'waiting_approval'
  | 'done'
  | 'error';

export interface AgentMeta {
  id: AgentId;
  name: string;
  khmerRole: string;
  description: string;
  accent: string;
  capabilities: string[];
}

export const AGENT_ROSTER: AgentMeta[] = [
  {
    id: 'orchestrator',
    name: 'Nexus Agent',
    khmerRole: 'មេក្រុមចែកការងារ',
    description:
      'Knows every workspace tool and specialist agent, plans tasks, delegates work, and synthesizes clear answers.',
    accent: 'amber',
    capabilities: ['Task Planning', 'Agent Delegation', 'Parallel Execution', 'Result Synthesis'],
  },
  {
    id: 'file',
    name: 'File Agent',
    khmerRole: 'គ្រប់គ្រង File & Folder',
    description:
      'Lists, searches, reads, creates, edits, moves, and organizes files and folders anywhere on your laptop.',
    accent: 'cyan',
    capabilities: ['Directory Tree', 'Read / Write Files', 'Content Search', 'Organize / Cleanup'],
  },
  {
    id: 'system',
    name: 'System Agent',
    khmerRole: 'បញ្ជា PowerShell & Apps',
    description:
      'Runs PowerShell commands, launches Windows apps, monitors CPU/RAM/processes, reads clipboard, and captures screenshots.',
    accent: 'emerald',
    capabilities: ['PowerShell / CMD', 'Launch Apps', 'System Monitor', 'Screen Capture'],
  },
  {
    id: 'browser',
    name: 'Browser Agent',
    khmerRole: 'ស្រាវជ្រាវ Web & Browser',
    description:
      'Searches the web, fetches and parses live web pages, inspects rendered DOM, and opens URLs in your browser.',
    accent: 'violet',
    capabilities: ['Web Search', 'Fetch & Parse URL', 'DOM Inspection', 'Open Browser Tabs'],
  },
];

export interface ModelOption {
  id: string;
  label: string;
  description?: string;
  contextWindow?: number;
  effortVariants?: Partial<Record<EffortLevel, string>>;
}

export interface ProviderAccountStatus {
  id: ProviderType;
  name: string;
  shortName: string;
  subtitle: string;
  installed: boolean;
  signedIn: boolean;
  binaryPath?: string;
  accountLabel?: string;
  profileHint?: string;
  models: ModelOption[];
  defaultModel: string;
  error?: string;
  canLogin: boolean;
  loginActionLabel?: string;
  canLogout?: boolean;
  logoutActionLabel?: string;
  slots?: AccountSlotStatus[];
  activeSlotId?: string;
}

export interface TokenUsageStats {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  contextWindow: number;
  estimated?: boolean;
}

export interface NeedsAttentionAction {
  type: 'login' | 'start_ollama' | 'open_settings' | 'install_cli';
  provider: ProviderType;
  slotId?: string;
  slotLabel?: string;
  agent?: AgentId;
  reason?: 'signed_out' | 'quota_exceeded' | 'cli_missing' | 'error';
  label: string;
  detail?: string;
}

export interface AgentSlotError {
  agent: AgentId;
  provider: ProviderType;
  slotId?: string;
  slotLabel?: string;
  model?: string;
  reason: 'signed_out' | 'quota_exceeded' | 'cli_missing' | 'error';
  message: string;
  action: NeedsAttentionAction;
}

export interface AppSettings {
  provider: ProviderType;
  effort: EffortLevel;
  selectedModels: Partial<Record<ProviderType, string>>;
  disconnectedProviders?: ProviderType[];
  accountSlots?: Partial<Record<CliAccountProvider, AccountSlotConfig[]>>;
  activeSlots?: Partial<Record<CliAccountProvider, string>>;
  agentRoutes?: Record<AgentId, AgentRouteConfig>;
  userName: string;
  language: UiLanguage;
  theme: ThemeId;
  glassOpacity: number;
  textSize: TextSize;
  safetyMode: SafetyMode;
  defaultWorkspace: string;
  maxToolSteps: number;
  // Local / optional API fallback settings
  ollamaBaseUrl: string;
  ollamaModel: string;
  geminiApiKey: string;
  geminiModel: string;
  openaiBaseUrl: string;
  openaiApiKey: string;
  openaiModel: string;
}

export interface WorkflowPreset {
  id: string;
  name: string;
  khmerLabel: string;
  description: string;
  target: TargetMode;
  prompt: string;
  agentsInvolved: AgentId[];
  builtIn?: boolean;
}

export interface PlanStep {
  id: string;
  title: string;
  agent: AgentId;
  detail: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export interface ToolCallTrace {
  id: string;
  sessionId: string;
  agent: AgentId;
  toolName: string;
  args: Record<string, unknown>;
  risk: ToolRisk;
  status: 'pending_approval' | 'running' | 'completed' | 'denied' | 'error';
  output?: string;
  error?: string;
  imageDataUrl?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
}

export interface AgentHandoff {
  id: string;
  from: AgentId;
  to: AgentId;
  task: string;
  status: 'running' | 'completed' | 'error';
  summary?: string;
  provider?: ProviderType;
  slotId?: string;
  slotLabel?: string;
  model?: string;
  errorAction?: NeedsAttentionAction;
  startedAt: string;
  finishedAt?: string;
}

export interface PendingApproval {
  id: string;
  sessionId: string;
  agent: AgentId;
  toolName: string;
  args: Record<string, unknown>;
  risk: ToolRisk;
  reason: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  kind?: 'message' | 'handoff_divider' | 'needs_attention';
  agent?: AgentId;
  provider?: ProviderType;
  slotId?: string;
  slotLabel?: string;
  model?: string;
  content: string;
  createdAt: string;
  plan?: PlanStep[];
  handoffs?: AgentHandoff[];
  toolTraces?: ToolCallTrace[];
  screenshots?: Array<{ label: string; dataUrl: string; filePath?: string }>;
  usage?: TokenUsageStats;
  actionCta?: NeedsAttentionAction;
  agentErrors?: AgentSlotError[];
  error?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  pinnedMessageIds?: string[];
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  sessionId: string;
  agent: AgentId;
  toolName: string;
  risk: ToolRisk;
  decision: 'auto_allowed' | 'user_allowed' | 'user_denied';
  argsPreview: string;
  status: 'completed' | 'denied' | 'error';
  durationMs?: number;
  summary?: string;
}

export interface SystemTelemetry {
  hostname: string;
  username: string;
  platform: string;
  osRelease: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  totalMemoryGb: number;
  freeMemoryGb: number;
  usedMemoryPercent: number;
  uptimeHours: number;
  homeDir: string;
  desktopDir: string;
  cwd: string;
  drives: Array<{ name: string; freeGb: number; usedGb: number; totalGb: number }>;
  topProcesses: Array<{ name: string; pid: number; cpuSec: number; memMb: number }>;
  timestamp: string;
}

export interface StorageStats {
  dataDir: string;
  sessionsCount: number;
  auditLogsCount: number;
  screenshotsCount: number;
  totalBytes: number;
}

export type ServerWsEvent =
  | { type: 'connected'; timestamp: string }
  | { type: 'agent_state'; agent: AgentId; state: AgentRunState; detail?: string }
  | { type: 'run_started'; sessionId: string; runId: string; target: TargetMode }
  | { type: 'run_finished'; sessionId: string; runId: string; message: ChatMessage }
  | { type: 'run_error'; sessionId: string; runId: string; error: string }
  | { type: 'plan_updated'; sessionId: string; steps: PlanStep[] }
  | { type: 'handoff_event'; sessionId: string; handoff: AgentHandoff }
  | { type: 'tool_event'; sessionId: string; trace: ToolCallTrace }
  | { type: 'approval_required'; approval: PendingApproval }
  | { type: 'approval_resolved'; approvalId: string; approved: boolean }
  | { type: 'audit_entry'; entry: AuditLogEntry }
  | { type: 'assistant_note'; sessionId: string; agent: AgentId; text: string }
  | { type: 'stream_delta'; sessionId: string; agent: AgentId; delta: string };
