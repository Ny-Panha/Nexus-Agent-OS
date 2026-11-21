import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  AccountSlotConfig,
  AccountSlotStatus,
  AgentId,
  AppSettings,
  CliAccountProvider,
  ModelOption,
  ProviderAccountStatus,
  ProviderType,
} from '../../shared/types.js';
import {
  getCliHomesRoot,
  getSlotCliHomeDir,
  saveSettings,
} from '../store/storage.js';
import { listOllamaModels } from './client.js';

const execFileAsync = promisify(execFile);

interface CacheEntry {
  statuses: ProviderAccountStatus[];
  timestamp: number;
}

let statusCache: CacheEntry | null = null;
const CACHE_TTL_MS = 30_000;

function fileExists(p: string): boolean {
  try {
    return fsSync.existsSync(p) && fsSync.statSync(p).isFile();
  } catch {
    return false;
  }
}

async function whereCommand(cmd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('where.exe', [cmd], { timeout: 2500 });
    const lines = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    return lines[0];
  } catch {
    return undefined;
  }
}

async function findExtensionBinary(baseDir: string, prefix: string, relativeBin: string): Promise<string | undefined> {
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    const matching = entries
      .filter((e) => e.isDirectory() && e.name.toLowerCase().startsWith(prefix.toLowerCase()))
      .map((e) => e.name)
      .sort()
      .reverse();
    for (const dir of matching) {
      const candidate = path.join(baseDir, dir, relativeBin);
      if (fileExists(candidate)) return candidate;
    }
  } catch {
    // ignore missing dir
  }
  return undefined;
}

export async function resolveGeminiCliBinary(): Promise<string | undefined> {
  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const candidates = [
    path.join(appData, 'npm', 'gemini.cmd'),
    await whereCommand('gemini.cmd'),
    await whereCommand('gemini'),
  ];
  return candidates.find((c): c is string => Boolean(c && fileExists(c)));
}

export async function resolveBinaryPath(provider: ProviderType): Promise<string | undefined> {
  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');

  if (provider === 'gemini_agy') {
    const direct = path.join(home, '.gemini', 'antigravity', 'bin', 'agy.exe');
    if (fileExists(direct)) return direct;
    return whereCommand('agy');
  }

  if (provider === 'codex') {
    const onPath = await whereCommand('codex');
    if (onPath) return onPath;

    const candidates = [
      await findExtensionBinary(path.join(home, '.vscode', 'extensions'), 'openai.chatgpt-', path.join('bin', 'windows-x86_64', 'codex.exe')),
      await findExtensionBinary(path.join(home, '.antigravity', 'extensions'), 'openai.chatgpt-', path.join('bin', 'windows-x86_64', 'codex.exe')),
      path.join(home, '.local', 'bin', 'codex.exe'),
      path.join(appData, 'npm', 'codex.cmd'),
    ];
    return candidates.find((c): c is string => Boolean(c && fileExists(c)));
  }

  if (provider === 'claude') {
    const candidates = [
      path.join(home, '.local', 'bin', 'claude.exe'),
      path.join(appData, 'npm', 'claude.cmd'),
      await whereCommand('claude'),
    ];
    return candidates.find((c): c is string => Boolean(c && fileExists(c)));
  }

  if (provider === 'ollama') {
    const candidates = [
      path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe'),
      await whereCommand('ollama'),
    ];
    return candidates.find((c): c is string => Boolean(c && fileExists(c)));
  }

  return undefined;
}

/**
 * Resolves the absolute isolated config-home directory for a non-default slot.
 * Slot 1 (isDefault, homeDir undefined) returns undefined so the CLI uses its OS default home.
 */
export function resolveSlotHomeAbs(provider: CliAccountProvider, slot: AccountSlotConfig): string | undefined {
  if (!slot.homeDir) return undefined;
  return getSlotCliHomeDir(provider, slot.id);
}

/**
 * Builds subprocess environment variables for a given provider + account slot.
 * Strictly passes official config-home env vars only — never injects tokens or credentials.
 */
export function buildSlotEnv(provider: CliAccountProvider, slot: AccountSlotConfig): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const absHome = resolveSlotHomeAbs(provider, slot);
  if (!absHome) return env;

  if (provider === 'codex') {
    env.CODEX_HOME = absHome;
  } else if (provider === 'claude') {
    env.CLAUDE_CONFIG_DIR = absHome;
  } else if (provider === 'gemini_agy' && slot.cliEngine === 'gemini_cli') {
    env.GEMINI_CLI_HOME = absHome;
    env.GEMINI_FORCE_FILE_STORAGE = 'true';
  }
  return env;
}

async function execCliCapture(
  binary: string,
  args: string[],
  timeoutMs = 7000,
  env?: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const isCmd = /\.(cmd|bat)$/i.test(binary);
    const child = spawn(isCmd ? 'cmd.exe' : binary, isCmd ? ['/c', binary, ...args] : args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: env || process.env,
    });
    let stdout = '';
    let stderr = '';
    let finished = false;

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        child.kill();
        resolve({ stdout, stderr: `${stderr}\nTimed out`, exitCode: 124 });
      }
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (err) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        resolve({ stdout, stderr: err.message, exitCode: 1 });
      }
    });
    child.on('close', (code) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      }
    });
  });
}

function getProviderSlots(settings: AppSettings, provider: CliAccountProvider): AccountSlotConfig[] {
  const list = settings.accountSlots?.[provider];
  if (list && list.length > 0) return list;
  return [
    {
      id: 'slot-1',
      label: provider === 'gemini_agy' ? 'Account 1 (Default · Antigravity)' : 'Account 1 (Default)',
      cliEngine: provider === 'gemini_agy' ? 'agy' : provider,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];
}

// ---------------------------------------------------------------------------
// Per-Slot Inspectors
// ---------------------------------------------------------------------------

async function inspectAgySlot(
  slot: AccountSlotConfig,
  binaryPath: string | undefined,
  settings: AppSettings,
): Promise<AccountSlotStatus> {
  const isDisconnected = Boolean(slot.disconnected || (slot.id === 'slot-1' && settings.disconnectedProviders?.includes('gemini_agy')));

  if (!binaryPath) {
    return {
      id: slot.id,
      provider: 'gemini_agy',
      label: slot.label,
      cliEngine: 'agy',
      homeDirHint: '~/.gemini (Antigravity)',
      installed: false,
      signedIn: false,
      models: [],
      defaultModel: 'gemini-3.8-flash',
      canLogin: false,
      canLogout: false,
      isDefault: slot.id === 'slot-1',
      error: 'Antigravity CLI (agy) is not installed on this computer.',
    };
  }

  if (isDisconnected) {
    return {
      id: slot.id,
      provider: 'gemini_agy',
      label: slot.label,
      cliEngine: 'agy',
      homeDirHint: '~/.gemini (Antigravity)',
      installed: true,
      signedIn: false,
      binaryPath,
      models: [],
      defaultModel: 'gemini-3.8-flash',
      canLogin: true,
      loginActionLabel: 'Sign in with Google',
      canLogout: false,
      isDefault: slot.id === 'slot-1',
      error: 'Signed out from Gemini Slot 1 in Nexus Agent OS. Click Sign in with Google to reconnect.',
    };
  }

  const res = await execCliCapture(binaryPath, ['models'], 9000);
  const rawModels: Array<{ id: string; label: string }> = [];
  for (const line of res.stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.toLowerCase().startsWith('fetching')) continue;
    const parts = trimmed.split('\t').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      rawModels.push({ id: parts[0], label: parts[1] });
    } else if (/^[a-z0-9][a-z0-9._-]+$/i.test(trimmed)) {
      rawModels.push({ id: trimmed, label: trimmed });
    }
  }

  // Group effort variants into clean base models so Model + Effort never collide
  const grouped = new Map<string, ModelOption>();
  const suffixRe = /-(low|medium|high|xhigh|max)$/i;
  const labelSuffixRe = /\s*\((Low|Medium|High|XHigh|Max)\)\s*$/i;

  for (const rm of rawModels) {
    const m = rm.id.match(suffixRe);
    if (m) {
      const eff = m[1].toLowerCase() as 'low' | 'medium' | 'high' | 'xhigh' | 'max';
      const baseId = rm.id.replace(suffixRe, '');
      const baseLabel = rm.label.replace(labelSuffixRe, '').trim();
      let entry = grouped.get(baseId);
      if (!entry) {
        entry = {
          id: baseId,
          label: baseLabel,
          description: 'Antigravity account model',
          contextWindow: 1_000_000,
          effortVariants: {},
        };
        grouped.set(baseId, entry);
      }
      entry.effortVariants![eff] = rm.id;
    } else {
      grouped.set(rm.id, {
        id: rm.id,
        label: rm.label,
        description: 'Antigravity account model',
        contextWindow: 1_000_000,
      });
    }
  }

  const models: ModelOption[] = Array.from(grouped.values()).map((entry) => {
    if (entry.effortVariants) {
      const keys = Object.keys(entry.effortVariants);
      const order = ['low', 'medium', 'high', 'xhigh', 'max'];
      keys.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      return {
        ...entry,
        description: `Antigravity · Efforts: ${keys.join(', ')}`,
      };
    }
    return entry;
  });

  const signedIn = res.exitCode === 0 && models.length > 0;
  const preferredDefault =
    models.find((m) => m.id === 'gemini-3.8-flash')?.id ||
    models.find((m) => m.id === 'gemini-4-argon')?.id ||
    models.find((m) => m.id === 'gemini-4-hydrogen')?.id ||
    models.find((m) => m.id === 'gemini-4-neon')?.id ||
    models[0]?.id ||
    'gemini-3.8-flash';

  return {
    id: slot.id,
    provider: 'gemini_agy',
    label: slot.label,
    cliEngine: 'agy',
    homeDirHint: '~/.gemini (Antigravity)',
    installed: true,
    signedIn,
    binaryPath,
    accountLabel: signedIn ? `Google Account via Antigravity (${rawModels.length} variants)` : undefined,
    models,
    defaultModel: preferredDefault,
    canLogin: true,
    loginActionLabel: signedIn ? 'Switch account' : 'Sign in with Google',
    canLogout: signedIn,
    logoutActionLabel: 'Sign out',
    isDefault: slot.id === 'slot-1',
    error: signedIn ? undefined : (res.stderr || 'Sign in through Antigravity to unlock Gemini models.').trim().slice(0, 240),
  };
}

const GEMINI_CLI_FALLBACK_MODELS: ModelOption[] = [
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', description: 'Fast Gemini CLI model', contextWindow: 1_048_576 },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Balanced fast Flash model', contextWindow: 1_048_576 },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Deep reasoning Pro model', contextWindow: 1_048_576 },
  { id: 'auto', label: 'Auto (Gemini CLI)', description: 'Let Gemini CLI choose best model', contextWindow: 1_048_576 },
];

async function inspectGeminiCliSlot(
  slot: AccountSlotConfig,
  binaryPath: string | undefined,
): Promise<AccountSlotStatus> {
  const absHome = resolveSlotHomeAbs('gemini_agy', slot);
  const homeDirHint = slot.homeDir || `data/cli-homes/gemini_agy/${slot.id}`;

  if (!binaryPath) {
    return {
      id: slot.id,
      provider: 'gemini_agy',
      label: slot.label,
      cliEngine: 'gemini_cli',
      homeDir: slot.homeDir,
      homeDirHint,
      installed: false,
      signedIn: false,
      models: [],
      defaultModel: 'gemini-2.5-flash',
      canLogin: false,
      canLogout: false,
      isDefault: false,
      error: 'Official Gemini CLI (gemini) is not installed. Run `npm i -g @google/gemini-cli`.',
    };
  }

  if (slot.disconnected) {
    return {
      id: slot.id,
      provider: 'gemini_agy',
      label: slot.label,
      cliEngine: 'gemini_cli',
      homeDir: slot.homeDir,
      homeDirHint,
      installed: true,
      signedIn: false,
      binaryPath,
      models: [],
      defaultModel: 'gemini-2.5-flash',
      canLogin: true,
      loginActionLabel: 'Sign in with Google',
      canLogout: false,
      isDefault: false,
      error: `Signed out from ${slot.label}. Click Sign in with Google to sign in inside this isolated slot.`,
    };
  }

  // Read ONLY non-secret public email display from google_accounts.json (NEVER read oauth_creds.json!)
  let activeEmail: string | undefined;
  let isApiKeyAuth = false;
  if (absHome) {
    try {
      const raw = await fs.readFile(path.join(absHome, '.gemini', 'google_accounts.json'), 'utf8');
      const parsed = JSON.parse(raw) as { active?: string | null };
      if (typeof parsed.active === 'string' && parsed.active.trim()) {
        activeEmail = parsed.active.trim();
      }
    } catch {
      // Not yet signed in in this slot
    }

    // Also detect if user authenticated via Gemini API Key inside official Gemini CLI
    try {
      const settingsPath = path.join(absHome, '.gemini', 'settings.json');
      const credsPath = path.join(absHome, '.gemini', 'gemini-credentials.json');
      if (fileExists(settingsPath) && fileExists(credsPath)) {
        const settingsRaw = await fs.readFile(settingsPath, 'utf8');
        const parsedSettings = JSON.parse(settingsRaw) as { security?: { auth?: { selectedType?: string } } };
        if (parsedSettings.security?.auth?.selectedType === 'gemini-api-key') {
          isApiKeyAuth = true;
        }
      }
    } catch {
      // Not signed in via API key
    }
  }

  const signedIn = Boolean(activeEmail || isApiKeyAuth);
  let models: ModelOption[] = [];

  if (signedIn) {
    const env = buildSlotEnv('gemini_agy', slot);
    const listRes = await execCliCapture(binaryPath, ['--list-models'], 8000, env);
    const parsedModels: ModelOption[] = [];
    for (const line of listRes.stdout.split(/\r?\n/)) {
      const m = line.match(/^([a-z0-9][a-z0-9._-]+)\s+\(([^)]+)\)\s*$/i);
      if (m) {
        const id = m[1].trim();
        const label = m[2].trim();
        if (!parsedModels.some((x) => x.id === id)) {
          parsedModels.push({
            id,
            label: label === id ? id : `${label} (${id})`,
            description: 'Gemini CLI isolated slot model',
            contextWindow: 1_048_576,
          });
        }
      }
    }
    models = parsedModels.length > 0 ? [...parsedModels] : [...GEMINI_CLI_FALLBACK_MODELS];
    // Always ensure Flash model option exists for fast specialist routing
    if (!models.some((m) => m.id === 'gemini-2.5-flash')) {
      models.push({
        id: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash',
        description: 'Fast Flash model (Gemini CLI)',
        contextWindow: 1_048_576,
      });
    }
  }

  const preferredDefault =
    models.find((m) => /flash/i.test(m.id))?.id ||
    models[0]?.id ||
    'gemini-2.5-flash';

  const accountLabel = activeEmail
    ? `${activeEmail} (Gemini CLI)`
    : isApiKeyAuth
      ? 'Gemini API Key (CLI Slot 2)'
      : undefined;

  return {
    id: slot.id,
    provider: 'gemini_agy',
    label: slot.label,
    cliEngine: 'gemini_cli',
    homeDir: slot.homeDir,
    homeDirHint,
    installed: true,
    signedIn,
    binaryPath,
    accountLabel,
    models,
    defaultModel: preferredDefault,
    canLogin: true,
    loginActionLabel: signedIn ? 'Switch account' : 'Sign in',
    canLogout: signedIn,
    logoutActionLabel: 'Sign out',
    isDefault: false,
    error: signedIn
      ? undefined
      : `${slot.label} is not signed in yet. Click Sign in to authenticate with Google or Gemini API Key in ${homeDirHint}.`,
  };
}

async function readCodexConfigModel(codexHomeDir: string): Promise<string | undefined> {
  try {
    const cfg = await fs.readFile(path.join(codexHomeDir, 'config.toml'), 'utf8');
    const match = cfg.match(/^\s*model\s*=\s*"([^"]+)"/m);
    return match?.[1];
  } catch {
    return undefined;
  }
}

async function inspectCodexSlot(
  slot: AccountSlotConfig,
  binaryPath: string | undefined,
  settings: AppSettings,
): Promise<AccountSlotStatus> {
  const baseModels: ModelOption[] = [
    { id: 'default', label: 'Default (ChatGPT Account)', description: 'Uses your active Codex plan model', contextWindow: 256_000 },
    { id: 'gpt-5.4', label: 'GPT-5.4', description: 'Flagship reasoning & coding', contextWindow: 400_000 },
    { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', description: 'Specialized agentic coding', contextWindow: 400_000 },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', description: 'Fast everyday tasks', contextWindow: 400_000 },
    { id: 'o3', label: 'o3', description: 'Deep analytical reasoning', contextWindow: 200_000 },
    { id: 'o4-mini', label: 'o4-mini', description: 'Fast reasoning', contextWindow: 200_000 },
  ];

  const absHome = resolveSlotHomeAbs('codex', slot);
  const homeDirHint = slot.homeDir || '~/.codex';
  const isDisconnected = Boolean(slot.disconnected || (slot.id === 'slot-1' && settings.disconnectedProviders?.includes('codex')));

  if (!binaryPath) {
    return {
      id: slot.id,
      provider: 'codex',
      label: slot.label,
      cliEngine: 'codex',
      homeDir: slot.homeDir,
      homeDirHint,
      installed: false,
      signedIn: false,
      models: [],
      defaultModel: 'default',
      canLogin: false,
      canLogout: false,
      isDefault: slot.id === 'slot-1',
      error: 'Codex CLI is not installed on this computer.',
    };
  }

  if (isDisconnected) {
    return {
      id: slot.id,
      provider: 'codex',
      label: slot.label,
      cliEngine: 'codex',
      homeDir: slot.homeDir,
      homeDirHint,
      installed: true,
      signedIn: false,
      binaryPath,
      models: [],
      defaultModel: 'default',
      canLogin: true,
      loginActionLabel: 'Sign in with ChatGPT',
      canLogout: false,
      isDefault: slot.id === 'slot-1',
      error: `Signed out from Codex (${slot.label}). Click Sign in with ChatGPT to authenticate.`,
    };
  }

  if (absHome) {
    await fs.mkdir(absHome, { recursive: true });
  }
  const env = buildSlotEnv('codex', slot);
  const res = await execCliCapture(binaryPath, ['login', 'status'], 6000, env);
  const combined = `${res.stdout}\n${res.stderr}`.trim();
  const signedIn = /logged in/i.test(combined) && !/not logged in/i.test(combined);
  const codexHomeDir = absHome || path.join(os.homedir(), '.codex');
  const configuredModel = await readCodexConfigModel(codexHomeDir);

  const models = [...baseModels];
  if (configuredModel && !models.some((m) => m.id === configuredModel)) {
    models.splice(1, 0, {
      id: configuredModel,
      label: `${configuredModel} (Configured)`,
      description: `From ${homeDirHint}/config.toml`,
      contextWindow: 400_000,
    });
  }

  const firstCleanLine = res.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /logged in/i.test(l));

  return {
    id: slot.id,
    provider: 'codex',
    label: slot.label,
    cliEngine: 'codex',
    homeDir: slot.homeDir,
    homeDirHint,
    installed: true,
    signedIn,
    binaryPath,
    accountLabel: signedIn ? firstCleanLine || 'Logged in using ChatGPT' : undefined,
    models: signedIn ? models : [],
    defaultModel: configuredModel || 'gpt-5.4',
    canLogin: true,
    loginActionLabel: signedIn ? 'Switch ChatGPT account' : 'Sign in with ChatGPT',
    canLogout: signedIn,
    logoutActionLabel: 'Sign out',
    isDefault: slot.id === 'slot-1',
    error: signedIn
      ? undefined
      : `Codex ${slot.label} (${homeDirHint}) is not signed in. Sign in with your ChatGPT account.`,
  };
}

async function inspectClaudeSlot(
  slot: AccountSlotConfig,
  binaryPath: string | undefined,
  settings: AppSettings,
): Promise<AccountSlotStatus> {
  const claudeModels: ModelOption[] = [
    { id: 'sonnet', label: 'Claude Sonnet (Latest)', description: 'Balanced speed & intelligence', contextWindow: 200_000 },
    { id: 'opus', label: 'Claude Opus (Latest)', description: 'Deepest complex reasoning', contextWindow: 200_000 },
    { id: 'haiku', label: 'Claude Haiku (Fast)', description: 'Quick lightweight turns', contextWindow: 200_000 },
  ];

  const absHome = resolveSlotHomeAbs('claude', slot);
  const homeDirHint = slot.homeDir || '~/.claude';
  const isDisconnected = Boolean(slot.disconnected || (slot.id === 'slot-1' && settings.disconnectedProviders?.includes('claude')));

  if (!binaryPath) {
    return {
      id: slot.id,
      provider: 'claude',
      label: slot.label,
      cliEngine: 'claude',
      homeDir: slot.homeDir,
      homeDirHint,
      installed: false,
      signedIn: false,
      models: [],
      defaultModel: 'sonnet',
      canLogin: false,
      canLogout: false,
      isDefault: slot.id === 'slot-1',
      error: 'Claude Code CLI is not installed on this computer.',
    };
  }

  if (isDisconnected) {
    return {
      id: slot.id,
      provider: 'claude',
      label: slot.label,
      cliEngine: 'claude',
      homeDir: slot.homeDir,
      homeDirHint,
      installed: true,
      signedIn: false,
      binaryPath,
      models: [],
      defaultModel: 'sonnet',
      canLogin: true,
      loginActionLabel: 'Sign in with Claude',
      canLogout: false,
      isDefault: slot.id === 'slot-1',
      error: `Signed out from Claude Code (${slot.label}). Click Sign in with Claude to authenticate.`,
    };
  }

  if (absHome) {
    await fs.mkdir(absHome, { recursive: true });
  }
  const env = buildSlotEnv('claude', slot);
  const res = await execCliCapture(binaryPath, ['auth', 'status'], 5000, env);
  let loggedIn = false;
  let accountLabel: string | undefined;
  try {
    const parsed = JSON.parse(res.stdout.trim()) as {
      loggedIn?: boolean;
      authMethod?: string;
      email?: string;
    };
    loggedIn = Boolean(parsed.loggedIn);
    if (loggedIn) {
      accountLabel = parsed.email || `Claude (${parsed.authMethod || 'OAuth'})`;
    }
  } catch {
    loggedIn = /"loggedIn"\s*:\s*true/i.test(res.stdout);
  }

  return {
    id: slot.id,
    provider: 'claude',
    label: slot.label,
    cliEngine: 'claude',
    homeDir: slot.homeDir,
    homeDirHint,
    installed: true,
    signedIn: loggedIn,
    binaryPath,
    accountLabel,
    models: loggedIn ? claudeModels : [],
    defaultModel: 'sonnet',
    canLogin: true,
    loginActionLabel: loggedIn ? 'Switch Claude account' : 'Sign in with Claude',
    canLogout: loggedIn,
    logoutActionLabel: 'Sign out',
    isDefault: slot.id === 'slot-1',
    error: loggedIn
      ? undefined
      : `Claude Code ${slot.label} (${homeDirHint}) is not signed in. Click Sign in to authenticate.`,
  };
}

// ---------------------------------------------------------------------------
// Provider Aggregators (Backward-Compatible + Multi-Slot)
// ---------------------------------------------------------------------------

async function inspectGeminiProvider(settings: AppSettings): Promise<ProviderAccountStatus> {
  const [agyBin, geminiCliBin] = await Promise.all([
    resolveBinaryPath('gemini_agy'),
    resolveGeminiCliBinary(),
  ]);
  const slotConfigs = getProviderSlots(settings, 'gemini_agy');
  const slots = await Promise.all(
    slotConfigs.map((slot) =>
      slot.cliEngine === 'gemini_cli'
        ? inspectGeminiCliSlot(slot, geminiCliBin)
        : inspectAgySlot(slot, agyBin, settings),
    ),
  );

  const activeSlotId = settings.activeSlots?.gemini_agy || 'slot-1';
  const activeSlot = slots.find((s) => s.id === activeSlotId) || slots[0];
  const anyInstalled = slots.some((s) => s.installed);

  return {
    id: 'gemini_agy',
    name: 'Gemini',
    shortName: 'Gemini',
    subtitle: 'Google accounts via Antigravity (Slot 1) & official Gemini CLI (Slot 2+)',
    installed: anyInstalled,
    signedIn: Boolean(activeSlot?.signedIn),
    binaryPath: activeSlot?.binaryPath || agyBin || geminiCliBin,
    accountLabel: activeSlot?.accountLabel,
    profileHint: activeSlot?.homeDirHint || '~/.gemini',
    models: activeSlot?.models || [],
    defaultModel: activeSlot?.defaultModel || 'gemini-3.8-flash',
    error: activeSlot?.error,
    canLogin: Boolean(activeSlot?.canLogin),
    loginActionLabel: activeSlot?.loginActionLabel,
    canLogout: Boolean(activeSlot?.canLogout),
    logoutActionLabel: activeSlot?.logoutActionLabel,
    slots,
    activeSlotId: activeSlot?.id || 'slot-1',
  };
}

async function inspectCodexProvider(settings: AppSettings): Promise<ProviderAccountStatus> {
  const binaryPath = await resolveBinaryPath('codex');
  const slotConfigs = getProviderSlots(settings, 'codex');
  const slots = await Promise.all(slotConfigs.map((slot) => inspectCodexSlot(slot, binaryPath, settings)));

  const activeSlotId = settings.activeSlots?.codex || 'slot-1';
  const activeSlot = slots.find((s) => s.id === activeSlotId) || slots[0];

  return {
    id: 'codex',
    name: 'Codex',
    shortName: 'Codex',
    subtitle: 'Your ChatGPT plan (isolated CODEX_HOME per account slot)',
    installed: Boolean(binaryPath),
    signedIn: Boolean(activeSlot?.signedIn),
    binaryPath,
    accountLabel: activeSlot?.accountLabel,
    profileHint: activeSlot?.homeDirHint || '~/.codex',
    models: activeSlot?.models || [],
    defaultModel: activeSlot?.defaultModel || 'default',
    error: activeSlot?.error,
    canLogin: Boolean(activeSlot?.canLogin),
    loginActionLabel: activeSlot?.loginActionLabel,
    canLogout: Boolean(activeSlot?.canLogout),
    logoutActionLabel: activeSlot?.logoutActionLabel,
    slots,
    activeSlotId: activeSlot?.id || 'slot-1',
  };
}

async function inspectClaudeProvider(settings: AppSettings): Promise<ProviderAccountStatus> {
  const binaryPath = await resolveBinaryPath('claude');
  const slotConfigs = getProviderSlots(settings, 'claude');
  const slots = await Promise.all(slotConfigs.map((slot) => inspectClaudeSlot(slot, binaryPath, settings)));

  const activeSlotId = settings.activeSlots?.claude || 'slot-1';
  const activeSlot = slots.find((s) => s.id === activeSlotId) || slots[0];

  return {
    id: 'claude',
    name: 'Claude Code',
    shortName: 'Claude',
    subtitle: 'Your Claude plan (isolated CLAUDE_CONFIG_DIR per account slot)',
    installed: Boolean(binaryPath),
    signedIn: Boolean(activeSlot?.signedIn),
    binaryPath,
    accountLabel: activeSlot?.accountLabel,
    profileHint: activeSlot?.homeDirHint || '~/.claude',
    models: activeSlot?.models || [],
    defaultModel: activeSlot?.defaultModel || 'sonnet',
    error: activeSlot?.error,
    canLogin: Boolean(activeSlot?.canLogin),
    loginActionLabel: activeSlot?.loginActionLabel,
    canLogout: Boolean(activeSlot?.canLogout),
    logoutActionLabel: activeSlot?.logoutActionLabel,
    slots,
    activeSlotId: activeSlot?.id || 'slot-1',
  };
}

async function inspectOllamaProvider(settings: AppSettings): Promise<ProviderAccountStatus> {
  const binaryPath = await resolveBinaryPath('ollama');
  if (settings.disconnectedProviders?.includes('ollama')) {
    return {
      id: 'ollama',
      name: 'Local AI',
      shortName: 'Local AI',
      subtitle: 'A model on this computer: free and private, no account needed',
      installed: Boolean(binaryPath),
      signedIn: false,
      binaryPath,
      profileHint: settings.ollamaBaseUrl,
      models: [],
      defaultModel: settings.ollamaModel || 'qwen2.5:7b',
      canLogin: Boolean(binaryPath),
      loginActionLabel: 'Start Local AI (Ollama)',
      canLogout: false,
      error: 'Local AI is disconnected. Click Start Local AI to enable offline models.',
    };
  }

  let models: ModelOption[] = [];
  let reachable = false;
  let errText: string | undefined;

  try {
    const names = await listOllamaModels(settings.ollamaBaseUrl);
    reachable = true;
    models = names.map((name) => ({
      id: name,
      label: name,
      description: 'Local Ollama model',
      contextWindow: 32_768,
    }));
  } catch (err) {
    errText = err instanceof Error ? err.message : 'Local Ollama server is not running.';
  }

  let localHint: string | undefined;
  try {
    const localDir = path.resolve(process.cwd(), 'ollama_models');
    const entries = await fs.readdir(localDir);
    const ggufs = entries.filter((f) => f.toLowerCase().endsWith('.gguf'));
    if (ggufs.length > 0) {
      localHint = `${ggufs.length} local GGUF file${ggufs.length > 1 ? 's' : ''} in workspace`;
    }
  } catch {
    // ignore
  }

  const defaultModel = models[0]?.id || settings.ollamaModel || 'qwen2.5:7b';

  return {
    id: 'ollama',
    name: 'Local AI',
    shortName: 'Local AI',
    subtitle: 'A model on this computer: free and private, no account needed',
    installed: Boolean(binaryPath) || reachable,
    signedIn: reachable,
    binaryPath,
    accountLabel: reachable
      ? `${models.length} local model${models.length === 1 ? '' : 's'} ready`
      : localHint,
    profileHint: settings.ollamaBaseUrl,
    models,
    defaultModel,
    canLogin: Boolean(binaryPath),
    loginActionLabel: reachable ? 'Refresh Models' : 'Start Local AI (Ollama)',
    canLogout: reachable,
    logoutActionLabel: 'Disconnect',
    error: reachable
      ? models.length === 0
        ? 'Ollama is running, but no models are installed yet. Run `ollama pull qwen2.5:7b`.'
        : undefined
      : errText || 'Ollama server is asleep. Click Start Local AI to launch it locally.',
  };
}

export async function getAllProviderStatuses(
  settings: AppSettings,
  forceRefresh = false,
): Promise<ProviderAccountStatus[]> {
  if (!forceRefresh && statusCache && Date.now() - statusCache.timestamp < CACHE_TTL_MS) {
    return statusCache.statuses;
  }

  const statuses = await Promise.all([
    inspectClaudeProvider(settings),
    inspectCodexProvider(settings),
    inspectGeminiProvider(settings),
    inspectOllamaProvider(settings),
  ]);

  statusCache = { statuses, timestamp: Date.now() };
  return statuses;
}

export async function getSingleProviderStatus(
  provider: ProviderType,
  settings: AppSettings,
  forceRefresh = false,
): Promise<ProviderAccountStatus | undefined> {
  const all = await getAllProviderStatuses(settings, forceRefresh);
  return all.find((p) => p.id === provider);
}

export async function getSlotStatus(
  provider: CliAccountProvider,
  slotId: string | undefined,
  settings: AppSettings,
  forceRefresh = false,
): Promise<{ slotConfig: AccountSlotConfig; slotStatus?: AccountSlotStatus }> {
  const slots = getProviderSlots(settings, provider);
  const desiredId = slotId || settings.activeSlots?.[provider] || 'slot-1';
  const slotConfig = slots.find((s) => s.id === desiredId) || slots[0];
  const providerStatus = await getSingleProviderStatus(provider, settings, forceRefresh);
  const slotStatus =
    providerStatus?.slots?.find((s) => s.id === slotConfig.id) || providerStatus?.slots?.[0];
  return { slotConfig, slotStatus };
}

export function invalidateProviderCache(): void {
  statusCache = null;
}

// ---------------------------------------------------------------------------
// Account Slot Management (Add / Remove / Activate / Login / Logout)
// ---------------------------------------------------------------------------

export async function createAccountSlot(
  provider: CliAccountProvider,
  settings: AppSettings,
  customLabel?: string,
): Promise<{ ok: boolean; slot: AccountSlotConfig; settings: AppSettings; message: string }> {
  invalidateProviderCache();
  const existing = getProviderSlots(settings, provider);
  let nextNum = existing.length + 1;
  while (existing.some((s) => s.id === `slot-${nextNum}`)) {
    nextNum += 1;
  }
  const slotId = `slot-${nextNum}`;
  const relHome = path.posix.join('data', 'cli-homes', provider, slotId);
  const absHome = getSlotCliHomeDir(provider, slotId);
  await fs.mkdir(absHome, { recursive: true });

  const cliEngine = provider === 'gemini_agy' ? 'gemini_cli' : provider;
  const defaultLabel =
    provider === 'gemini_agy'
      ? `Account ${nextNum} (Gemini CLI)`
      : `Account ${nextNum}`;

  const slot: AccountSlotConfig = {
    id: slotId,
    label: customLabel?.trim() || defaultLabel,
    cliEngine,
    homeDir: relHome,
    disconnected: false,
    createdAt: new Date().toISOString(),
  };

  const updatedSettings = await saveSettings({
    accountSlots: {
      ...settings.accountSlots,
      [provider]: [...existing, slot],
    },
  });
  invalidateProviderCache();

  return {
    ok: true,
    slot,
    settings: updatedSettings,
    message: `Added ${slot.label} with isolated home ${relHome}. Click Sign in to authenticate.`,
  };
}

/**
 * Removes a non-default account slot's config ONLY — never deletes its data/cli-homes/ folder on disk.
 */
export async function removeAccountSlot(
  provider: CliAccountProvider,
  slotId: string,
  settings: AppSettings,
): Promise<{ ok: boolean; settings: AppSettings; message: string }> {
  if (slotId === 'slot-1') {
    return {
      ok: false,
      settings,
      message: 'Account 1 (Default) cannot be removed.',
    };
  }
  invalidateProviderCache();
  const existing = getProviderSlots(settings, provider);
  const target = existing.find((s) => s.id === slotId);
  if (!target) {
    return { ok: false, settings, message: `Slot ${slotId} not found.` };
  }

  const remaining = existing.filter((s) => s.id !== slotId);
  const nextActiveSlots = { ...(settings.activeSlots || {}) };
  if (nextActiveSlots[provider] === slotId) {
    nextActiveSlots[provider] = 'slot-1';
  }

  const nextAgentRoutes = { ...(settings.agentRoutes || {}) } as Record<AgentId, { provider: ProviderType; slotId?: string; model: string }>;
  (['orchestrator', 'file', 'system', 'browser'] as AgentId[]).forEach((agentId) => {
    const r = nextAgentRoutes[agentId];
    if (r && r.provider === provider && r.slotId === slotId) {
      nextAgentRoutes[agentId] = { ...r, slotId: 'slot-1' };
    }
  });

  const updatedSettings = await saveSettings({
    accountSlots: {
      ...settings.accountSlots,
      [provider]: remaining,
    },
    activeSlots: nextActiveSlots,
    agentRoutes: nextAgentRoutes,
  });
  invalidateProviderCache();

  return {
    ok: true,
    settings: updatedSettings,
    message: `Removed ${target.label} from Nexus config (isolated CLI folder preserved on disk).`,
  };
}

export async function activateAccountSlot(
  provider: CliAccountProvider,
  slotId: string,
  settings: AppSettings,
): Promise<{ ok: boolean; settings: AppSettings; message: string }> {
  const existing = getProviderSlots(settings, provider);
  const target = existing.find((s) => s.id === slotId);
  if (!target) {
    return { ok: false, settings, message: `Account slot ${slotId} not found.` };
  }
  invalidateProviderCache();
  const updatedSettings = await saveSettings({
    provider,
    activeSlots: {
      ...settings.activeSlots,
      [provider]: slotId,
    },
  });
  invalidateProviderCache();
  return {
    ok: true,
    settings: updatedSettings,
    message: `Switched active ${provider} slot to ${target.label}.`,
  };
}

function escapePsSingle(str: string): string {
  return str.replace(/'/g, "''");
}

export async function triggerSlotLogin(
  provider: CliAccountProvider,
  slotId: string,
  settings: AppSettings,
): Promise<{ ok: boolean; message: string; openedTerminal?: boolean }> {
  invalidateProviderCache();
  const slots = getProviderSlots(settings, provider);
  const target = slots.find((s) => s.id === slotId) || slots[0];
  const wasDisconnected = Boolean(
    target.disconnected || (target.id === 'slot-1' && settings.disconnectedProviders?.includes(provider)),
  );

  // Clear disconnected flag on this slot
  const nextSlots = slots.map((s) => (s.id === target.id ? { ...s, disconnected: false } : s));
  const nextDisconnected =
    target.id === 'slot-1'
      ? (settings.disconnectedProviders || []).filter((p) => p !== provider)
      : settings.disconnectedProviders || [];
  settings = await saveSettings({
    accountSlots: { ...settings.accountSlots, [provider]: nextSlots },
    disconnectedProviders: nextDisconnected,
  });

  // Slot 1 Antigravity instant reconnect if local agy is already signed in
  if (provider === 'gemini_agy' && target.cliEngine === 'agy' && wasDisconnected) {
    const agyBin = await resolveBinaryPath('gemini_agy');
    const st = await inspectAgySlot({ ...target, disconnected: false }, agyBin, settings);
    if (st.signedIn) {
      return {
        ok: true,
        message: `Reconnected ${target.label} via Antigravity (${st.models.length} base models loaded).`,
      };
    }
  }

  const absHome = resolveSlotHomeAbs(provider, target);
  if (absHome) {
    await fs.mkdir(absHome, { recursive: true });
  }

  let binary: string | undefined;
  let psSetup = '';
  let cliInvoke = '';
  let title = `Sign in (${target.label})`;

  if (provider === 'gemini_agy' && target.cliEngine === 'gemini_cli') {
    binary = await resolveGeminiCliBinary();
    if (!binary) {
      return {
        ok: false,
        message: 'Official Gemini CLI (gemini) was not found. Install with `npm i -g @google/gemini-cli`.',
      };
    }
    if (absHome) {
      const geminiDir = path.join(absHome, '.gemini');
      await fs.mkdir(geminiDir, { recursive: true });
      const slotSettingsPath = path.join(geminiDir, 'settings.json');
      if (!fileExists(slotSettingsPath)) {
        // Set only non-secret auth mode preference so Gemini CLI launches Google OAuth directly
        await fs.writeFile(
          slotSettingsPath,
          JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } }, null, 2),
          'utf8',
        );
      }
      psSetup = `$env:GEMINI_CLI_HOME = '${escapePsSingle(absHome)}'; $env:GEMINI_FORCE_FILE_STORAGE = 'true'; `;
    }
    title = `Sign in to Gemini - ${target.label}`;
    cliInvoke = `& '${escapePsSingle(binary)}'`;
  } else if (provider === 'gemini_agy') {
    binary = await resolveBinaryPath('gemini_agy');
    if (!binary) {
      return { ok: false, message: 'Antigravity CLI (agy) was not found on this computer.' };
    }
    title = `Sign in to Gemini Antigravity - ${target.label}`;
    cliInvoke = `& '${escapePsSingle(binary)}'`;
  } else if (provider === 'codex') {
    binary = await resolveBinaryPath('codex');
    if (!binary) {
      return { ok: false, message: 'Codex CLI was not found on this computer.' };
    }
    if (absHome) {
      psSetup = `$env:CODEX_HOME = '${escapePsSingle(absHome)}'; `;
    }
    title = `Sign in to Codex - ${target.label}`;
    cliInvoke = `& '${escapePsSingle(binary)}' login`;
  } else if (provider === 'claude') {
    binary = await resolveBinaryPath('claude');
    if (!binary) {
      return { ok: false, message: 'Claude Code CLI was not found on this computer.' };
    }
    if (absHome) {
      psSetup = `$env:CLAUDE_CONFIG_DIR = '${escapePsSingle(absHome)}'; `;
    }
    title = `Sign in to Claude Code - ${target.label}`;
    cliInvoke = `& '${escapePsSingle(binary)}' auth login`;
  }

  try {
    const psCmd = `${psSetup}Write-Host 'Nexus Agent OS — ${escapePsSingle(title)}' -ForegroundColor Cyan; Write-Host 'Complete official sign-in in your browser, then close this window and click Refresh in Nexus.' -ForegroundColor Gray; Write-Host ''; ${cliInvoke}; Write-Host ''; Write-Host 'Done. You can close this window and click Refresh in Nexus Agent OS.' -ForegroundColor Green; Pause`;
    const child = spawn(
      'cmd.exe',
      ['/c', 'start', title, 'powershell.exe', '-NoLogo', '-Command', psCmd],
      { detached: true, stdio: 'ignore' },
    );
    child.unref();

    return {
      ok: true,
      openedTerminal: true,
      message: `Opened official ${title} flow. Complete browser sign-in, then click Refresh.`,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Could not open sign-in terminal.',
    };
  }
}

export async function triggerSlotLogout(
  provider: CliAccountProvider,
  slotId: string,
  settings: AppSettings,
): Promise<{ ok: boolean; message: string }> {
  invalidateProviderCache();
  const slots = getProviderSlots(settings, provider);
  const target = slots.find((s) => s.id === slotId) || slots[0];
  const env = buildSlotEnv(provider, target);

  if (provider === 'claude') {
    const bin = await resolveBinaryPath('claude');
    if (bin) {
      await execCliCapture(bin, ['auth', 'logout'], 5000, env);
    }
  } else if (provider === 'codex') {
    const bin = await resolveBinaryPath('codex');
    if (bin) {
      await execCliCapture(bin, ['logout'], 5000, env);
    }
  } else if (provider === 'gemini_agy' && target.cliEngine === 'gemini_cli') {
    // Official gemini CLI v0.68.0 has no `logout` subcommand (verified via --help).
    // Strictly unlink auth files ONLY inside data/cli-homes/gemini_agy/<slotId>/.gemini/ without reading contents.
    const absHome = resolveSlotHomeAbs('gemini_agy', target);
    const homesRoot = getCliHomesRoot();
    if (absHome && absHome.startsWith(path.join(homesRoot, 'gemini_agy') + path.sep)) {
      const geminiSubDir = path.join(absHome, '.gemini');
      for (const fname of ['oauth_creds.json', 'google_accounts.json']) {
        const candidate = path.resolve(geminiSubDir, fname);
        if (candidate.startsWith(geminiSubDir + path.sep)) {
          await fs.rm(candidate, { force: true }).catch(() => {});
        }
      }
    }
  }

  const nextSlots = slots.map((s) => (s.id === target.id ? { ...s, disconnected: true } : s));
  const nextDisconnected = new Set(settings.disconnectedProviders || []);
  if (target.id === 'slot-1') {
    nextDisconnected.add(provider);
  }
  await saveSettings({
    accountSlots: { ...settings.accountSlots, [provider]: nextSlots },
    disconnectedProviders: Array.from(nextDisconnected),
  });
  invalidateProviderCache();

  return {
    ok: true,
    message: `Signed out from ${target.label}. Other account slots remain untouched.`,
  };
}

export async function triggerProviderLogin(
  provider: ProviderType,
  settings: AppSettings,
): Promise<{ ok: boolean; message: string; openedTerminal?: boolean }> {
  invalidateProviderCache();

  if (provider === 'ollama') {
    const wasDisconnected = Boolean(settings.disconnectedProviders?.includes('ollama'));
    if (wasDisconnected) {
      settings = await saveSettings({
        disconnectedProviders: (settings.disconnectedProviders || []).filter((p) => p !== 'ollama'),
      });
    }
    const bin = await resolveBinaryPath('ollama');
    if (!bin) {
      return { ok: false, message: 'Ollama is not installed. Download from https://ollama.com' };
    }
    try {
      const child = spawn(bin, ['serve'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 450));
        try {
          await listOllamaModels(settings.ollamaBaseUrl);
          return { ok: true, message: 'Local AI (Ollama) started and ready.' };
        } catch {
          // keep waiting
        }
      }
      return {
        ok: true,
        message: 'Started Ollama background server. Click Refresh status in a moment if models are still loading.',
      };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Failed to start Ollama' };
    }
  }

  if (provider === 'codex' || provider === 'gemini_agy' || provider === 'claude') {
    const slotId = settings.activeSlots?.[provider] || 'slot-1';
    return triggerSlotLogin(provider, slotId, settings);
  }

  return { ok: false, message: `Provider ${provider} does not support CLI OAuth login.` };
}

export async function triggerProviderLogout(
  provider: ProviderType,
  settings: AppSettings,
): Promise<{ ok: boolean; message: string }> {
  if (provider === 'codex' || provider === 'gemini_agy' || provider === 'claude') {
    const slotId = settings.activeSlots?.[provider] || 'slot-1';
    return triggerSlotLogout(provider, slotId, settings);
  }

  invalidateProviderCache();
  const current = new Set(settings.disconnectedProviders || []);
  current.add(provider);
  await saveSettings({ disconnectedProviders: Array.from(current) });
  invalidateProviderCache();
  return {
    ok: true,
    message: 'Disconnected Local AI (Ollama). You can reconnect anytime.',
  };
}
