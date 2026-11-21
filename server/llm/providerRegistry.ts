import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  AppSettings,
  ModelOption,
  ProviderAccountStatus,
  ProviderType,
} from '../../shared/types.js';
import { saveSettings } from '../store/storage.js';
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

async function execCliCapture(
  binary: string,
  args: string[],
  timeoutMs = 7000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const isCmd = /\.(cmd|bat)$/i.test(binary);
    const child = spawn(isCmd ? 'cmd.exe' : binary, isCmd ? ['/c', binary, ...args] : args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
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

async function inspectAgyProvider(settings: AppSettings): Promise<ProviderAccountStatus> {
  const binaryPath = await resolveBinaryPath('gemini_agy');
  if (!binaryPath) {
    return {
      id: 'gemini_agy',
      name: 'Gemini',
      shortName: 'Gemini',
      subtitle: 'Your Google account, through Antigravity',
      installed: false,
      signedIn: false,
      models: [],
      defaultModel: 'gemini-4-argon',
      canLogin: false,
      canLogout: false,
      error: 'Antigravity CLI (agy) is not installed on this computer.',
    };
  }

  if (settings.disconnectedProviders?.includes('gemini_agy')) {
    return {
      id: 'gemini_agy',
      name: 'Gemini',
      shortName: 'Gemini',
      subtitle: 'Your Google account, through Antigravity',
      installed: true,
      signedIn: false,
      binaryPath,
      profileHint: '~/.gemini',
      models: [],
      defaultModel: 'gemini-4-argon',
      canLogin: true,
      loginActionLabel: 'Sign in with Google',
      canLogout: false,
      error: 'Signed out from Gemini in Nexus Agent OS. Click Sign in with Google to reconnect.',
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

  // Group effort variants (e.g., gemini-4-neon-low/medium/high/xhigh) into one clean base model
  // so Model picker + Effort picker never duplicate or conflict with each other!
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

  // Annotate supported effort range cleanly in model description
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
    models.find((m) => m.id === 'gemini-4-argon')?.id ||
    models.find((m) => m.id === 'gemini-4-hydrogen')?.id ||
    models.find((m) => m.id === 'gemini-3.8-flash')?.id ||
    models.find((m) => m.id === 'gemini-4-neon')?.id ||
    models[0]?.id ||
    'gemini-4-argon';

  return {
    id: 'gemini_agy',
    name: 'Gemini',
    shortName: 'Gemini',
    subtitle: 'Your Google account, through Antigravity',
    installed: true,
    signedIn,
    binaryPath,
    accountLabel: signedIn ? `Google Account via Antigravity (${rawModels.length} variants)` : undefined,
    profileHint: '~/.gemini',
    models,
    defaultModel: preferredDefault,
    canLogin: true,
    loginActionLabel: signedIn ? 'Switch Google account' : 'Sign in with Google',
    canLogout: signedIn,
    logoutActionLabel: 'Sign out',
    error: signedIn ? undefined : (res.stderr || 'Sign in through Antigravity to unlock Gemini models.').trim().slice(0, 240),
  };
}

async function readCodexConfigModel(): Promise<string | undefined> {
  try {
    const cfg = await fs.readFile(path.join(os.homedir(), '.codex', 'config.toml'), 'utf8');
    const match = cfg.match(/^\s*model\s*=\s*"([^"]+)"/m);
    return match?.[1];
  } catch {
    return undefined;
  }
}

async function inspectCodexProvider(settings: AppSettings): Promise<ProviderAccountStatus> {
  const binaryPath = await resolveBinaryPath('codex');
  const baseModels: ModelOption[] = [
    { id: 'default', label: 'Default (ChatGPT Account)', description: 'Uses your active Codex plan model', contextWindow: 256_000 },
    { id: 'gpt-5.4', label: 'GPT-5.4', description: 'Flagship reasoning & coding', contextWindow: 400_000 },
    { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', description: 'Specialized agentic coding', contextWindow: 400_000 },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', description: 'Fast everyday tasks', contextWindow: 400_000 },
    { id: 'o3', label: 'o3', description: 'Deep analytical reasoning', contextWindow: 200_000 },
    { id: 'o4-mini', label: 'o4-mini', description: 'Fast reasoning', contextWindow: 200_000 },
  ];

  if (!binaryPath) {
    return {
      id: 'codex',
      name: 'Codex',
      shortName: 'Codex',
      subtitle: 'Your ChatGPT plan',
      installed: false,
      signedIn: false,
      models: baseModels,
      defaultModel: 'default',
      canLogin: false,
      canLogout: false,
      error: 'Codex CLI is not installed on this computer.',
    };
  }

  if (settings.disconnectedProviders?.includes('codex')) {
    return {
      id: 'codex',
      name: 'Codex',
      shortName: 'Codex',
      subtitle: 'Your ChatGPT plan',
      installed: true,
      signedIn: false,
      binaryPath,
      profileHint: '~/.codex',
      models: [],
      defaultModel: 'default',
      canLogin: true,
      loginActionLabel: 'Sign in with ChatGPT',
      canLogout: false,
      error: 'Signed out from Codex (ChatGPT). Click Sign in with ChatGPT to authenticate.',
    };
  }

  const res = await execCliCapture(binaryPath, ['login', 'status'], 5000);
  const combined = `${res.stdout}\n${res.stderr}`.trim();
  const signedIn = /logged in/i.test(combined) && !/not logged in/i.test(combined);
  const configuredModel = await readCodexConfigModel();

  const models = [...baseModels];
  if (configuredModel && !models.some((m) => m.id === configuredModel)) {
    models.splice(1, 0, {
      id: configuredModel,
      label: `${configuredModel} (Configured)`,
      description: 'From ~/.codex/config.toml',
      contextWindow: 400_000,
    });
  }

  return {
    id: 'codex',
    name: 'Codex',
    shortName: 'Codex',
    subtitle: 'Your ChatGPT plan',
    installed: true,
    signedIn,
    binaryPath,
    accountLabel: signedIn ? combined.split(/\r?\n/)[0] || 'Logged in using ChatGPT' : undefined,
    profileHint: '~/.codex',
    models: signedIn ? models : [],
    defaultModel: configuredModel || 'default',
    canLogin: true,
    loginActionLabel: signedIn ? 'Switch ChatGPT account' : 'Sign in with ChatGPT',
    canLogout: signedIn,
    logoutActionLabel: 'Sign out',
    error: signedIn ? undefined : 'Codex profile Default (~/.codex) is not signed in. Sign in with your ChatGPT account to chat.',
  };
}

async function inspectClaudeProvider(settings: AppSettings): Promise<ProviderAccountStatus> {
  const binaryPath = await resolveBinaryPath('claude');
  const claudeModels: ModelOption[] = [
    { id: 'sonnet', label: 'Claude Sonnet (Latest)', description: 'Balanced speed & intelligence', contextWindow: 200_000 },
    { id: 'opus', label: 'Claude Opus (Latest)', description: 'Deepest complex reasoning', contextWindow: 200_000 },
    { id: 'haiku', label: 'Claude Haiku (Fast)', description: 'Quick lightweight turns', contextWindow: 200_000 },
  ];

  if (!binaryPath) {
    return {
      id: 'claude',
      name: 'Claude Code',
      shortName: 'Claude',
      subtitle: 'Your Claude plan',
      installed: false,
      signedIn: false,
      models: [],
      defaultModel: 'sonnet',
      canLogin: false,
      canLogout: false,
      error: 'Claude Code CLI is not installed on this computer.',
    };
  }

  if (settings.disconnectedProviders?.includes('claude')) {
    return {
      id: 'claude',
      name: 'Claude Code',
      shortName: 'Claude',
      subtitle: 'Your Claude plan',
      installed: true,
      signedIn: false,
      binaryPath,
      profileHint: '~/.claude',
      models: [],
      defaultModel: 'sonnet',
      canLogin: true,
      loginActionLabel: 'Sign in with Claude',
      canLogout: false,
      error: 'Signed out from Claude Code. Click Sign in with Claude to authenticate.',
    };
  }

  const res = await execCliCapture(binaryPath, ['auth', 'status'], 5000);
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
    id: 'claude',
    name: 'Claude Code',
    shortName: 'Claude',
    subtitle: 'Your Claude plan',
    installed: true,
    signedIn: loggedIn,
    binaryPath,
    accountLabel,
    profileHint: '~/.claude',
    models: loggedIn ? claudeModels : [],
    defaultModel: 'sonnet',
    canLogin: true,
    loginActionLabel: loggedIn ? 'Switch Claude account' : 'Sign in with Claude',
    canLogout: loggedIn,
    logoutActionLabel: 'Sign out',
    error: loggedIn
      ? undefined
      : 'Claude Code profile Default (~/.claude) is not signed in. Click Sign in to authenticate with your Claude plan.',
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
    inspectAgyProvider(settings),
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

export function invalidateProviderCache(): void {
  statusCache = null;
}

export async function triggerProviderLogin(
  provider: ProviderType,
  settings: AppSettings,
): Promise<{ ok: boolean; message: string; openedTerminal?: boolean }> {
  invalidateProviderCache();

  // Clear from disconnectedProviders if previously signed out inside Nexus
  const wasDisconnected = Boolean(settings.disconnectedProviders?.includes(provider));
  if (wasDisconnected) {
    const nextDisconnected = (settings.disconnectedProviders || []).filter((p) => p !== provider);
    settings = await saveSettings({ disconnectedProviders: nextDisconnected });
  }

  // If Gemini (Antigravity) was only signed out inside Nexus and local agy is already signed in, reconnect immediately!
  if (provider === 'gemini_agy' && wasDisconnected) {
    const status = await inspectAgyProvider(settings);
    if (status.signedIn) {
      return {
        ok: true,
        message: `Reconnected Google account via Antigravity (${status.models.length} base models loaded).`,
      };
    }
  }

  if (provider === 'ollama') {
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
      // Wait briefly for local Ollama API to wake up
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

  const bin = await resolveBinaryPath(provider);
  if (!bin) {
    return {
      ok: false,
      message: `CLI for ${provider} was not found on this computer.`,
    };
  }

  let commandArgs: string[] = [];
  let title = 'Nexus AI Sign In';
  if (provider === 'claude') {
    title = 'Sign in to Claude Code';
    commandArgs = [bin, 'auth', 'login'];
  } else if (provider === 'codex') {
    title = 'Sign in to Codex (ChatGPT)';
    commandArgs = [bin, 'login'];
  } else if (provider === 'gemini_agy') {
    title = 'Sign in to Gemini (Antigravity)';
    commandArgs = [bin];
  } else {
    return { ok: false, message: `Provider ${provider} does not support CLI OAuth login.` };
  }

  try {
    // Launch official CLI login flow in a visible native Windows terminal so user completes browser OAuth directly
    const psCmd = `& '${commandArgs[0].replace(/'/g, "''")}' ${commandArgs.slice(1).join(' ')}; Write-Host ''; Write-Host 'You can close this window and click Refresh status in Nexus Agent OS.' -ForegroundColor Cyan; Pause`;
    const child = spawn(
      'cmd.exe',
      ['/c', 'start', title, 'powershell.exe', '-NoLogo', '-Command', psCmd],
      { detached: true, stdio: 'ignore' },
    );
    child.unref();

    return {
      ok: true,
      openedTerminal: true,
      message: `Opened official ${title} flow. Complete sign-in in your browser, then click Refresh status.`,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Could not open sign-in terminal.',
    };
  }
}

export async function triggerProviderLogout(
  provider: ProviderType,
  settings: AppSettings,
): Promise<{ ok: boolean; message: string }> {
  invalidateProviderCache();

  // Run official CLI logout for Claude Code & Codex
  const bin = await resolveBinaryPath(provider);
  if (bin && provider === 'claude') {
    await execCliCapture(bin, ['auth', 'logout'], 5000);
  } else if (bin && provider === 'codex') {
    await execCliCapture(bin, ['logout'], 5000);
  }

  // Also record provider in disconnectedProviders so Gemini (Antigravity) & Local AI sign out cleanly inside Nexus
  const current = new Set(settings.disconnectedProviders || []);
  current.add(provider);
  await saveSettings({ disconnectedProviders: Array.from(current) });
  invalidateProviderCache();

  const label =
    provider === 'claude'
      ? 'Claude Code'
      : provider === 'codex'
        ? 'Codex (ChatGPT)'
        : provider === 'gemini_agy'
          ? 'Gemini (Antigravity)'
          : 'Local AI (Ollama)';

  return {
    ok: true,
    message: `Signed out from ${label}. You can sign back in anytime.`,
  };
}
