import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fsSync from 'node:fs';
import os from 'node:os';
import type {
  AccountSlotConfig,
  AccountSlotStatus,
  AgentId,
  AgentRouteConfig,
  AppSettings,
  AuditLogEntry,
  ChatSession,
  CliAccountProvider,
  CliEngineKind,
  EffortLevel,
  ModelOption,
  NeedsAttentionAction,
  ProviderType,
  SafetyMode,
  ServerWsEvent,
  TargetMode,
  TokenUsageStats,
  ToolCallTrace,
} from '../../shared/types.js';
import { appendAuditLog } from '../store/storage.js';
import {
  buildSlotEnv,
  getSlotStatus,
  resolveBinaryPath,
  resolveGeminiCliBinary,
} from './providerRegistry.js';

export interface CliRunOutput {
  text: string;
  toolTraces: ToolCallTrace[];
  usage?: TokenUsageStats;
  provider: ProviderType;
  slotId: string;
  slotLabel: string;
  cliEngine: CliEngineKind;
  modelUsed: string;
  needsAttention?: {
    reason: 'signed_out' | 'quota_exceeded' | 'cli_missing' | 'error';
    message: string;
    action: NeedsAttentionAction;
  };
}

function safeWorkspaceDir(preferred: string): string {
  try {
    if (preferred && fsSync.existsSync(preferred) && fsSync.statSync(preferred).isDirectory()) {
      return preferred;
    }
  } catch {
    // fallback
  }
  return process.cwd();
}

function buildConversationPrompt(params: {
  session: ChatSession;
  prompt: string;
  target: TargetMode;
  settings: AppSettings;
  includeHistory: boolean;
  customPrompt?: string;
}): string {
  const { session, prompt, target, settings, includeHistory, customPrompt } = params;
  if (customPrompt) {
    return customPrompt;
  }

  const userName = settings.userName?.trim() || os.userInfo().username;

  if (!includeHistory) {
    return prompt;
  }

  const roleHint =
    target === 'file'
      ? 'Act as File Agent: focus on inspecting, searching, reading, and organizing files/folders accurately.'
      : target === 'system'
        ? 'Act as System Agent: focus on Windows laptop diagnostics, PowerShell tasks, processes, and app automation.'
        : target === 'browser'
          ? 'Act as Browser Agent: focus on web research, documentation, and concise cited answers.'
          : 'Act as Nexus Agent (Orchestrator): be concise, practical, direct, and verify real files/state before answering.';

  const langHint =
    settings.language === 'km'
      ? 'Respond in clear Khmer with simple English technical terms.'
      : 'Match the user language (if they write in Khmer or Romanized Khmer, respond in clear Khmer + simple English technical terms).';

  const priorMessages = session.messages
    .filter((m) => (!m.kind || m.kind === 'message') && m.content.trim())
    .slice(-7, -1);

  const historyBlock = priorMessages.length
    ? `\n\n[Earlier conversation handed over]\n${priorMessages
        .map((m) => `${m.role === 'user' ? userName : 'Assistant'}: ${m.content.slice(0, 700)}`)
        .join('\n')}\n[End earlier conversation]\n`
    : '';

  return `[Nexus Agent OS Context]
User: ${userName}
Workspace: ${safeWorkspaceDir(settings.defaultWorkspace)}
${roleHint}
${langHint}${historyBlock}
Current user request:
${prompt}`;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function mapProviderTitle(provider: ProviderType): string {
  if (provider === 'claude') return 'Claude Code';
  if (provider === 'codex') return 'Codex (ChatGPT)';
  if (provider === 'gemini_agy') return 'Gemini';
  if (provider === 'ollama') return 'Local AI';
  return provider;
}

export function classifyCliError(errMsg: string): 'signed_out' | 'quota_exceeded' | 'error' {
  if (
    /not logged in|please set an auth method|sign in|login required|unauthorized|unauthenticated|invalid_grant|code["':\s]+41\b/i.test(
      errMsg,
    )
  ) {
    return 'signed_out';
  }
  if (
    /quota|resource_exhausted|rate.?limit|too many requests|usage limit|limit reached|\b429\b/i.test(
      errMsg,
    )
  ) {
    return 'quota_exceeded';
  }
  return 'error';
}

function buildSlotAttention(params: {
  reason: 'signed_out' | 'quota_exceeded' | 'cli_missing';
  agent: AgentId;
  provider: CliAccountProvider;
  slotId: string;
  slotLabel: string;
  cliEngine: CliEngineKind;
  modelUsed: string;
  message: string;
  toolTraces: ToolCallTrace[];
}): CliRunOutput {
  const { reason, agent, provider, slotId, slotLabel, cliEngine, modelUsed, message, toolTraces } = params;
  const provTitle = mapProviderTitle(provider);
  const actionLabel =
    reason === 'cli_missing'
      ? `Open AI Accounts (${provTitle})`
      : reason === 'quota_exceeded'
        ? `Sign in / Switch ${provTitle} (${slotLabel})`
        : `Sign in to ${provTitle} (${slotLabel})`;

  return {
    text: message,
    toolTraces,
    provider,
    slotId,
    slotLabel,
    cliEngine,
    modelUsed,
    needsAttention: {
      reason,
      message,
      action: {
        type: reason === 'cli_missing' ? 'open_settings' : 'login',
        provider,
        slotId,
        slotLabel,
        agent,
        reason,
        label: actionLabel,
        detail: `${provTitle} · ${slotLabel}`,
      },
    },
  };
}

/**
 * Resolves a base model + effort level into an exact valid `agy` model ID so
 * `--model` and `--effort` NEVER conflict.
 */
export function resolveAgyModelVariant(
  selectedModel: string,
  effort: EffortLevel,
  models: ModelOption[],
): { modelId: string; passEffortFlag: boolean } {
  const suffixRe = /-(low|medium|high|xhigh|max)$/i;
  const baseId = selectedModel.replace(suffixRe, '');
  const matched = models.find((m) => m.id === selectedModel || m.id === baseId);

  if (matched?.effortVariants) {
    const fallbackChain: Record<EffortLevel, EffortLevel[]> = {
      low: ['low', 'medium', 'high', 'xhigh', 'max'],
      medium: ['medium', 'low', 'high', 'xhigh', 'max'],
      high: ['high', 'xhigh', 'medium', 'low', 'max'],
      xhigh: ['xhigh', 'high', 'medium', 'low', 'max'],
      max: ['max', 'xhigh', 'high', 'medium', 'low'],
    };
    for (const candidate of fallbackChain[effort] || fallbackChain.medium) {
      const variantId = matched.effortVariants[candidate];
      if (variantId) {
        return { modelId: variantId, passEffortFlag: false };
      }
    }
  }

  if (matched) {
    return { modelId: matched.id, passEffortFlag: false };
  }

  // Safe Fallback: If requested model (e.g. "gemini-4-hydrogen") is not in agy.exe models,
  // pick the best verified model (gemini-3.8-flash-high or gemini-3.8-flash-medium) to prevent CLI crash!
  const safeFallback =
    models.find((m) => m.id.includes('3.8-flash'))?.effortVariants?.high ||
    models.find((m) => m.id.includes('3.8-flash'))?.id ||
    models[0]?.id ||
    'gemini-3.8-flash-high';

  return { modelId: safeFallback, passEffortFlag: false };
}

// ---------------------------------------------------------------------------
// Warm Persistent `agy` Worker Pool (isolated per session + agent + slot)
// ---------------------------------------------------------------------------
interface WarmAgyWorker {
  key: string;
  sessionId: string;
  agentId: AgentId;
  slotId: string;
  modelId: string;
  child: ChildProcess;
  busy: boolean;
  lastUsedAt: number;
  lineBuffer: string;
  idleTimer?: NodeJS.Timeout;
  activeTurn?: {
    emit: (event: ServerWsEvent) => void;
    activeAgent: AgentId;
    toolTraces: ToolCallTrace[];
    safetyMode: SafetyMode;
    streamToChat: boolean;
    streamedDelta: string;
    resolve: (res: { text: string; usage?: TokenUsageStats; error?: string }) => void;
    reject: (err: Error) => void;
  };
}

const warmAgyPool = new Map<string, WarmAgyWorker>();
const WORKER_IDLE_MS = 10 * 60 * 1000;

export function disposeWarmWorkersForSession(sessionId: string): void {
  for (const [k, w] of warmAgyPool.entries()) {
    if (w.sessionId === sessionId) {
      destroyWarmWorker(k, w);
    }
  }
}

export function disposeWarmWorkersForSlot(slotId: string): void {
  for (const [k, w] of warmAgyPool.entries()) {
    if (w.slotId === slotId) {
      destroyWarmWorker(k, w);
    }
  }
}

export function disposeAllWarmWorkers(): void {
  for (const [k, w] of warmAgyPool.entries()) {
    destroyWarmWorker(k, w);
  }
}

function destroyWarmWorker(key: string, worker: WarmAgyWorker, reason?: string): void {
  warmAgyPool.delete(key);
  if (worker.idleTimer) clearTimeout(worker.idleTimer);
  try {
    worker.child.stdin?.end();
    worker.child.kill();
  } catch {
    // ignore
  }
  if (worker.activeTurn) {
    const turn = worker.activeTurn;
    worker.activeTurn = undefined;
    turn.reject(new Error(reason || 'Gemini worker closed unexpectedly.'));
  }
}

function getOrCreateWarmAgyWorker(params: {
  sessionId: string;
  agentId: AgentId;
  slotId: string;
  binary: string;
  workspace: string;
  modelId: string;
  safetyMode: SafetyMode;
  planningOnly: boolean;
  env: NodeJS.ProcessEnv;
}): { worker: WarmAgyWorker; isNew: boolean } {
  const modeKey = params.planningOnly ? 'plan_only' : params.safetyMode;
  const key = `${params.sessionId}::${params.agentId}::${params.slotId}::${params.modelId}::${modeKey}`;
  const existing = warmAgyPool.get(key);
  if (existing && !existing.child.killed && existing.child.exitCode === null && !existing.busy) {
    if (existing.idleTimer) clearTimeout(existing.idleTimer);
    existing.lastUsedAt = Date.now();
    return { worker: existing, isNew: false };
  }

  // Only replace stale workers for the same (session, agent, slot) so other agents keep their warm workers!
  for (const [k, w] of warmAgyPool.entries()) {
    if (w.sessionId === params.sessionId && w.agentId === params.agentId && w.slotId === params.slotId) {
      destroyWarmWorker(k, w);
    }
  }

  // Verified agy.exe flags: --input-format, --output-format, --model, --mode (accept-edits|auto|plan), --sandbox, --dangerously-skip-permissions, -p=
  const args: string[] = [
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--model',
    params.modelId,
  ];
  if (params.planningOnly || params.safetyMode === 'read_only') {
    args.push('--mode', 'plan');
  } else if (params.safetyMode === 'safe') {
    args.push('--mode', 'plan', '--sandbox');
  } else if (params.safetyMode === 'full_auto') {
    args.push('--dangerously-skip-permissions');
  } else {
    args.push('--mode', 'accept-edits', '--sandbox');
  }
  args.push('-p=');

  const child = spawn(params.binary, args, {
    cwd: params.workspace,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: params.env,
  });

  const worker: WarmAgyWorker = {
    key,
    sessionId: params.sessionId,
    agentId: params.agentId,
    slotId: params.slotId,
    modelId: params.modelId,
    child,
    busy: false,
    lastUsedAt: Date.now(),
    lineBuffer: '',
  };

  let stderrBuf = '';

  const handleJsonLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) return;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return;
    }

    const turn = worker.activeTurn;
    if (!turn) return;

    const evKind = String(ev.event || ev.type || '');
    const stepUpd = ev.step_update as Record<string, unknown> | undefined;

    if (evKind === 'step_update' && stepUpd) {
      const stepType = String(stepUpd.step_type || '');
      if (stepType === 'agent_response' && typeof stepUpd.text_delta === 'string') {
        turn.streamedDelta += stepUpd.text_delta;
        if (turn.streamToChat) {
          turn.emit({
            type: 'stream_delta',
            sessionId: worker.sessionId,
            agent: turn.activeAgent,
            delta: stepUpd.text_delta,
          });
        }
      } else if (stepType && stepType !== 'user_input' && stepType !== 'agent_response') {
        const toolName = String(stepUpd.tool_name || stepType);
        const stepId = `agy-step-${String(stepUpd.step_index ?? turn.toolTraces.length)}`;
        const existingTrace = turn.toolTraces.find((t) => t.id === stepId);
        const isDone = String(stepUpd.state || '').toUpperCase() === 'DONE';
        if (existingTrace) {
          existingTrace.status = isDone ? 'completed' : 'running';
          existingTrace.finishedAt = isDone ? new Date().toISOString() : undefined;
          turn.emit({ type: 'tool_event', sessionId: worker.sessionId, trace: { ...existingTrace } });
        } else {
          const trace: ToolCallTrace = {
            id: stepId,
            sessionId: worker.sessionId,
            agent: turn.activeAgent,
            toolName,
            args: (stepUpd.args as Record<string, unknown>) || {},
            risk: turn.safetyMode === 'read_only' ? 'read' : 'write',
            status: isDone ? 'completed' : 'running',
            startedAt: new Date().toISOString(),
            finishedAt: isDone ? new Date().toISOString() : undefined,
          };
          turn.toolTraces.push(trace);
          turn.emit({ type: 'tool_event', sessionId: worker.sessionId, trace });
        }
        turn.emit({
          type: 'agent_state',
          agent: turn.activeAgent,
          state: 'running_tool',
          detail: toolName,
        });
      }
      return;
    }

    if (evKind === 'result') {
      const resultObj =
        ev.result && typeof ev.result === 'object'
          ? (ev.result as Record<string, unknown>)
          : undefined;
      const responseText =
        (resultObj && typeof resultObj.response === 'string' && resultObj.response.trim()) ||
        turn.streamedDelta.trim();
      const errText =
        resultObj && typeof resultObj.error === 'string' && resultObj.error.trim()
          ? resultObj.error.trim()
          : undefined;

      const u = resultObj?.usage as Record<string, number> | undefined;
      const usage: TokenUsageStats | undefined =
        u && (typeof u.input_tokens === 'number' || typeof u.output_tokens === 'number')
          ? {
              inputTokens: Number(u.input_tokens || 0),
              cachedInputTokens: Number(u.cache_read_tokens || u.cached_input_tokens || 0),
              cacheWriteTokens: Number(u.cache_write_tokens || 0),
              outputTokens: Number(u.output_tokens || 0),
              contextWindow: 1_000_000,
            }
          : undefined;

      worker.busy = false;
      worker.activeTurn = undefined;
      worker.lastUsedAt = Date.now();
      worker.idleTimer = setTimeout(() => destroyWarmWorker(key, worker), WORKER_IDLE_MS);

      if (resultObj && String(resultObj.status || '').toUpperCase() === 'ERROR' && !responseText) {
        turn.resolve({
          text: '',
          usage,
          error: errText || 'Gemini turn returned an error.',
        });
        return;
      }

      turn.resolve({
        text: responseText,
        usage,
        error: errText,
      });
    }
  };

  child.stdout?.on('data', (chunk) => {
    worker.lineBuffer += String(chunk);
    const lines = worker.lineBuffer.split(/\r?\n/);
    worker.lineBuffer = lines.pop() || '';
    for (const l of lines) handleJsonLine(l);
  });

  child.stderr?.on('data', (chunk) => {
    stderrBuf += String(chunk);
  });

  child.on('error', (err) => {
    destroyWarmWorker(key, worker, err.message);
  });

  child.on('close', (code) => {
    if (worker.lineBuffer.trim()) handleJsonLine(worker.lineBuffer);
    if (worker.activeTurn) {
      const msg = stderrBuf.trim() || `Gemini (Antigravity) exited with code ${code ?? 1}`;
      destroyWarmWorker(key, worker, msg);
    } else {
      warmAgyPool.delete(key);
    }
  });

  warmAgyPool.set(key, worker);
  return { worker, isNew: true };
}

// ---------------------------------------------------------------------------
// Main CLI Entrypoint (Per-Agent + Per-Slot Aware)
// ---------------------------------------------------------------------------

export async function runCliProviderMission(params: {
  session: ChatSession;
  prompt: string;
  target: TargetMode;
  agentId?: AgentId;
  route?: AgentRouteConfig;
  settings: AppSettings;
  customPrompt?: string;
  planningOnly?: boolean;
  streamToChat?: boolean;
  emit: (event: ServerWsEvent) => void;
  signal: AbortSignal;
}): Promise<CliRunOutput> {
  const {
    session,
    prompt,
    target,
    settings,
    customPrompt,
    planningOnly = false,
    streamToChat = true,
    emit,
    signal,
  } = params;

  const activeAgent: AgentId = params.agentId || (target === 'auto' ? 'orchestrator' : target);
  const provider = (params.route?.provider || settings.provider) as CliAccountProvider;
  const requestedSlotId = params.route?.slotId || settings.activeSlots?.[provider] || 'slot-1';

  const { slotConfig, slotStatus } = await getSlotStatus(provider, requestedSlotId, settings, false);
  const cliEngine: CliEngineKind = slotConfig.cliEngine;
  const slotId = slotConfig.id;
  const slotLabel = slotConfig.label;

  const binary =
    slotStatus?.binaryPath ||
    (cliEngine === 'gemini_cli'
      ? await resolveGeminiCliBinary()
      : await resolveBinaryPath(provider));

  const selectedModel =
    params.route?.model ||
    settings.selectedModels?.[provider] ||
    slotStatus?.defaultModel ||
    (provider === 'claude'
      ? 'sonnet'
      : provider === 'codex'
        ? 'default'
        : cliEngine === 'gemini_cli'
          ? 'gemini-3.8-flash'
          : 'gemini-3.8-flash');

  if (!binary || !slotStatus?.installed) {
    return buildSlotAttention({
      reason: 'cli_missing',
      agent: activeAgent,
      provider,
      slotId,
      slotLabel,
      cliEngine,
      modelUsed: selectedModel,
      message: `${mapProviderTitle(provider)} (${slotLabel}) CLI is not installed on this computer.`,
      toolTraces: [],
    });
  }

  if (!slotStatus.signedIn) {
    return buildSlotAttention({
      reason: 'signed_out',
      agent: activeAgent,
      provider,
      slotId,
      slotLabel,
      cliEngine,
      modelUsed: selectedModel,
      message:
        slotStatus.error ||
        `${mapProviderTitle(provider)} ${slotLabel} is not signed in. Sign in to this account slot, then retry.`,
      toolTraces: [],
    });
  }

  const workspace = safeWorkspaceDir(settings.defaultWorkspace);
  const env = buildSlotEnv(provider, slotConfig);
  const toolTraces: ToolCallTrace[] = [];

  if (cliEngine === 'agy') {
    const resolved = resolveAgyModelVariant(selectedModel, settings.effort, slotStatus.models);
    emit({
      type: 'agent_state',
      agent: activeAgent,
      state: 'thinking',
      detail: `${slotLabel} · ${resolved.modelId}`,
    });

    return runWarmAgyTurn({
      binary,
      workspace,
      session,
      prompt,
      target,
      customPrompt,
      planningOnly,
      streamToChat,
      modelId: resolved.modelId,
      slotConfig,
      slotStatus,
      env,
      settings,
      activeAgent,
      toolTraces,
      emit,
      signal,
    });
  }

  emit({
    type: 'agent_state',
    agent: activeAgent,
    state: 'thinking',
    detail: `${mapProviderTitle(provider)} (${slotLabel}) · ${selectedModel}`,
  });

  const fullPrompt = buildConversationPrompt({
    session,
    prompt,
    target,
    settings,
    includeHistory: !customPrompt,
    customPrompt,
  });

  if (cliEngine === 'gemini_cli') {
    const out = await runGeminiCli({
      binary,
      workspace,
      fullPrompt,
      model: selectedModel,
      slotConfig,
      env,
      settings,
      planningOnly,
      streamToChat,
      sessionId: session.id,
      activeAgent,
      toolTraces,
      emit,
      signal,
    });
    // Auto-fallback: If official Gemini CLI hits free-tier quota (e.g. 20 req/day on 3.8-flash),
    // transparently fallback to available gemini-2.5-flash so the user's workflow never breaks.
    if (out.needsAttention?.reason === 'quota_exceeded' && selectedModel !== 'gemini-2.5-flash') {
      try {
        const fallbackOut = await runGeminiCli({
          binary,
          workspace,
          fullPrompt,
          model: 'gemini-2.5-flash',
          slotConfig,
          env,
          settings,
          planningOnly,
          streamToChat,
          sessionId: session.id,
          activeAgent,
          toolTraces,
          emit,
          signal,
        });
        if (!fallbackOut.needsAttention) {
          fallbackOut.modelUsed = 'gemini-2.5-flash (Auto-fallback from quota-limited ' + selectedModel + ')';
          return fallbackOut;
        }
      } catch {
        // Fallback failed, return original attention
      }
    }
    return out;
  }

  if (cliEngine === 'codex') {
    return runCodexCli({
      binary,
      workspace,
      fullPrompt,
      model: selectedModel,
      slotConfig,
      env,
      settings,
      planningOnly,
      streamToChat,
      sessionId: session.id,
      activeAgent,
      toolTraces,
      emit,
      signal,
    });
  }

  if (cliEngine === 'claude') {
    return runClaudeCli({
      binary,
      workspace,
      fullPrompt,
      model: selectedModel,
      slotConfig,
      env,
      settings,
      planningOnly,
      streamToChat,
      sessionId: session.id,
      activeAgent,
      toolTraces,
      emit,
      signal,
    });
  }

  throw new Error(`Unsupported CLI engine: ${cliEngine}`);
}

// ---------------------------------------------------------------------------
// 1. Antigravity CLI (`agy.exe`) — Slot 1
// ---------------------------------------------------------------------------

async function runWarmAgyTurn(params: {
  binary: string;
  workspace: string;
  session: ChatSession;
  prompt: string;
  target: TargetMode;
  customPrompt?: string;
  planningOnly: boolean;
  streamToChat: boolean;
  modelId: string;
  slotConfig: AccountSlotConfig;
  slotStatus: AccountSlotStatus;
  env: NodeJS.ProcessEnv;
  settings: AppSettings;
  activeAgent: AgentId;
  toolTraces: ToolCallTrace[];
  emit: (event: ServerWsEvent) => void;
  signal: AbortSignal;
}): Promise<CliRunOutput> {
  const {
    binary,
    workspace,
    session,
    prompt,
    target,
    customPrompt,
    planningOnly,
    streamToChat,
    modelId,
    slotConfig,
    env,
    settings,
    activeAgent,
    toolTraces,
    emit,
    signal,
  } = params;

  const { worker, isNew } = getOrCreateWarmAgyWorker({
    sessionId: session.id,
    agentId: activeAgent,
    slotId: slotConfig.id,
    binary,
    workspace,
    modelId,
    safetyMode: settings.safetyMode,
    planningOnly,
    env,
  });

  const messageText = buildConversationPrompt({
    session,
    prompt,
    target,
    settings,
    includeHistory: isNew && !customPrompt,
    customPrompt,
  });

  const startedAt = Date.now();
  worker.busy = true;

  const result = await new Promise<{ text: string; usage?: TokenUsageStats; error?: string }>(
    (resolve, reject) => {
      const onAbort = () => {
        destroyWarmWorker(worker.key, worker, 'Mission stopped by user.');
      };

      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });

      worker.activeTurn = {
        emit,
        activeAgent,
        toolTraces,
        safetyMode: settings.safetyMode,
        streamToChat,
        streamedDelta: '',
        resolve: (res) => {
          signal.removeEventListener('abort', onAbort);
          resolve(res);
        },
        reject: (err) => {
          signal.removeEventListener('abort', onAbort);
          reject(err);
        },
      };

      const payload =
        JSON.stringify({
          event: 'user',
          message: { role: 'user', content: messageText },
        }) + '\n';

      try {
        worker.child.stdin?.write(payload, 'utf8');
      } catch (err) {
        signal.removeEventListener('abort', onAbort);
        destroyWarmWorker(
          worker.key,
          worker,
          err instanceof Error ? err.message : 'Failed to send prompt to Gemini worker.',
        );
      }
    },
  );

  if (result.error && !result.text) {
    const kind = classifyCliError(result.error);
    if (kind === 'signed_out' || kind === 'quota_exceeded') {
      return buildSlotAttention({
        reason: kind,
        agent: activeAgent,
        provider: 'gemini_agy',
        slotId: slotConfig.id,
        slotLabel: slotConfig.label,
        cliEngine: 'agy',
        modelUsed: modelId,
        message: `${slotConfig.label} (${modelId}): ${result.error.slice(0, 320)}`,
        toolTraces,
      });
    }
    throw new Error(result.error);
  }

  const finalText = result.text || 'Done.';
  const usage: TokenUsageStats = result.usage || {
    inputTokens: estimateTokens(messageText),
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: estimateTokens(finalText),
    contextWindow: 1_000_000,
    estimated: true,
  };

  await recordCliAudit(
    session.id,
    activeAgent,
    `agy[${slotConfig.id}]:${modelId}`,
    `${slotConfig.label} (Antigravity) · ${planningOnly ? 'plan' : settings.safetyMode}`,
    Date.now() - startedAt,
    finalText,
    emit,
  );

  return {
    text: finalText,
    toolTraces,
    usage,
    provider: 'gemini_agy',
    slotId: slotConfig.id,
    slotLabel: slotConfig.label,
    cliEngine: 'agy',
    modelUsed: modelId,
  };
}

// ---------------------------------------------------------------------------
// 2. Official Gemini CLI (`gemini` v0.68.0) — Isolated Slot 2+
// ---------------------------------------------------------------------------

async function runGeminiCli(params: {
  binary: string;
  workspace: string;
  fullPrompt: string;
  model: string;
  slotConfig: AccountSlotConfig;
  env: NodeJS.ProcessEnv;
  settings: AppSettings;
  planningOnly: boolean;
  streamToChat: boolean;
  sessionId: string;
  activeAgent: AgentId;
  toolTraces: ToolCallTrace[];
  emit: (event: ServerWsEvent) => void;
  signal: AbortSignal;
}): Promise<CliRunOutput> {
  const {
    binary,
    workspace,
    fullPrompt,
    model,
    slotConfig,
    env,
    settings,
    planningOnly,
    streamToChat,
    sessionId,
    activeAgent,
    toolTraces,
    emit,
    signal,
  } = params;

  // Verified gemini --help flags: -p/--prompt, -m/--model, -o stream-json, --approval-mode (default|auto_edit|yolo|plan), -s/--sandbox, --skip-trust
  const args: string[] = ['-p', '', '-o', 'stream-json', '--skip-trust'];
  if (model && model !== 'default' && model !== 'auto') {
    args.push('-m', model);
  }

  if (planningOnly || settings.safetyMode === 'read_only') {
    args.push('--approval-mode', 'plan');
  } else if (settings.safetyMode === 'safe') {
    args.push('--approval-mode', 'plan', '-s');
  } else if (settings.safetyMode === 'full_auto') {
    args.push('--approval-mode', 'yolo');
  } else {
    args.push('--approval-mode', 'auto_edit');
  }

  const startedAt = Date.now();
  let streamedText = '';
  let finalResponse = '';
  let lastErrorText = '';
  let usage: TokenUsageStats | undefined;

  const runEnv: NodeJS.ProcessEnv = {
    ...env,
    GEMINI_CLI_TRUST_WORKSPACE: 'true',
  };

  const res = await spawnJsonStream({
    binary,
    args,
    cwd: workspace,
    env: runEnv,
    stdinText: fullPrompt,
    signal,
    onJsonEvent: (ev) => {
      const evType = String(ev.type || ev.event || '');
      if (evType === 'message') {
        const role = String(ev.role || '');
        const content = typeof ev.content === 'string' ? ev.content : '';
        if (role === 'assistant' && content) {
          if (ev.delta) {
            streamedText += content;
            if (streamToChat) {
              emit({ type: 'stream_delta', sessionId, agent: activeAgent, delta: content });
            }
          } else {
            finalResponse = content;
            if (streamToChat && !streamedText) {
              emit({ type: 'stream_delta', sessionId, agent: activeAgent, delta: content });
            }
          }
        }
      } else if (evType === 'tool_use') {
        const toolName = String(ev.tool_name || ev.name || 'gemini_tool');
        const trace: ToolCallTrace = {
          id: String(ev.tool_id || ev.id || randomUUID()),
          sessionId,
          agent: activeAgent,
          toolName,
          args: (ev.parameters as Record<string, unknown>) || (ev.args as Record<string, unknown>) || {},
          risk: settings.safetyMode === 'read_only' ? 'read' : 'write',
          status: 'running',
          startedAt: new Date().toISOString(),
        };
        toolTraces.push(trace);
        emit({ type: 'tool_event', sessionId, trace });
        emit({ type: 'agent_state', agent: activeAgent, state: 'running_tool', detail: toolName });
      } else if (evType === 'tool_result') {
        const tid = String(ev.tool_id || ev.id || '');
        const hit = toolTraces.find((t) => t.id === tid) || toolTraces[toolTraces.length - 1];
        if (hit) {
          hit.status = ev.status === 'error' ? 'error' : 'completed';
          if (typeof ev.output === 'string') hit.output = ev.output.slice(0, 1400);
          hit.finishedAt = new Date().toISOString();
          emit({ type: 'tool_event', sessionId, trace: { ...hit } });
        }
      } else if (evType === 'error') {
        const msg =
          typeof ev.message === 'string'
            ? ev.message
            : typeof (ev.error as Record<string, unknown> | undefined)?.message === 'string'
              ? String((ev.error as Record<string, unknown>).message)
              : '';
        if (msg) lastErrorText = msg;
      } else if (evType === 'result') {
        if (typeof ev.response === 'string' && ev.response.trim()) {
          finalResponse = ev.response.trim();
        }
        const stats = ev.stats as Record<string, number> | undefined;
        if (stats && (typeof stats.input_tokens === 'number' || typeof stats.output_tokens === 'number')) {
          usage = {
            inputTokens: Number(stats.input_tokens || stats.input || 0),
            cachedInputTokens: Number(stats.cached || 0),
            cacheWriteTokens: 0,
            outputTokens: Number(stats.output_tokens || 0),
            contextWindow: 1_048_576,
          };
        }
      }
    },
  });

  const text = (finalResponse || streamedText).trim();
  if (!text && (res.exitCode !== 0 || lastErrorText)) {
    const errMsg = (lastErrorText || res.rawStderr || res.rawStdout || 'Gemini CLI execution failed.').trim();
    const kind = classifyCliError(errMsg);
    if (kind === 'signed_out' || kind === 'quota_exceeded') {
      return buildSlotAttention({
        reason: kind,
        agent: activeAgent,
        provider: 'gemini_agy',
        slotId: slotConfig.id,
        slotLabel: slotConfig.label,
        cliEngine: 'gemini_cli',
        modelUsed: model,
        message: `${slotConfig.label} (${model}): ${errMsg.slice(0, 320)}`,
        toolTraces,
      });
    }
    throw new Error(errMsg.slice(0, 500));
  }

  if (!usage) {
    usage = {
      inputTokens: estimateTokens(fullPrompt),
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: estimateTokens(text),
      contextWindow: 1_048_576,
      estimated: true,
    };
  }

  await recordCliAudit(
    sessionId,
    activeAgent,
    `gemini_cli[${slotConfig.id}]:${model}`,
    `${slotConfig.label} (Gemini CLI) · ${planningOnly ? 'plan' : settings.safetyMode}`,
    Date.now() - startedAt,
    text,
    emit,
  );

  return {
    text: text || 'Done.',
    toolTraces,
    usage,
    provider: 'gemini_agy',
    slotId: slotConfig.id,
    slotLabel: slotConfig.label,
    cliEngine: 'gemini_cli',
    modelUsed: model,
  };
}

// ---------------------------------------------------------------------------
// 3. Official Codex CLI (`codex.exe` v0.169.0) — Per-Slot CODEX_HOME
// ---------------------------------------------------------------------------

async function runCodexCli(params: {
  binary: string;
  workspace: string;
  fullPrompt: string;
  model: string;
  slotConfig: AccountSlotConfig;
  env: NodeJS.ProcessEnv;
  settings: AppSettings;
  planningOnly: boolean;
  streamToChat: boolean;
  sessionId: string;
  activeAgent: AgentId;
  toolTraces: ToolCallTrace[];
  emit: (event: ServerWsEvent) => void;
  signal: AbortSignal;
}): Promise<CliRunOutput> {
  const {
    binary,
    workspace,
    fullPrompt,
    model,
    slotConfig,
    env,
    settings,
    planningOnly,
    streamToChat,
    sessionId,
    activeAgent,
    toolTraces,
    emit,
    signal,
  } = params;

  // Verified codex exec --help flags: --skip-git-repo-check, --ephemeral, -C, --json, -m, -c, -s, --dangerously-bypass-approvals-and-sandbox
  const args: string[] = ['exec', '--skip-git-repo-check', '--ephemeral', '-C', workspace, '--json'];
  if (model && model !== 'default') {
    args.push('-m', model);
  }
  const effortMap: Record<string, string> = {
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'max',
  };
  args.push('-c', `model_reasoning_effort="${effortMap[settings.effort] || 'medium'}"`);

  if (planningOnly || settings.safetyMode === 'read_only' || settings.safetyMode === 'safe') {
    args.push('-s', 'read-only');
  } else if (settings.safetyMode === 'full_auto') {
    args.push('--dangerously-bypass-approvals-and-sandbox');
  } else {
    args.push('-s', 'workspace-write');
  }

  args.push('-');

  const startedAt = Date.now();
  const agentMessages: string[] = [];
  let usage: TokenUsageStats | undefined;
  let lastErrorText = '';

  const res = await spawnJsonStream({
    binary,
    args,
    cwd: workspace,
    env,
    stdinText: fullPrompt,
    signal,
    onJsonEvent: (ev) => {
      const evType = String(ev.type || '');
      const item = ev.item as Record<string, unknown> | undefined;

      // Handle top-level errors emitted directly by Codex CLI (e.g. usage limit reached, auth error)
      if (evType === 'error' && typeof ev.message === 'string') {
        if (!/Under-development features enabled/i.test(ev.message)) {
          lastErrorText = ev.message;
        }
      } else if (evType === 'turn.failed') {
        const errObj = ev.error as Record<string, unknown> | undefined;
        if (errObj && typeof errObj.message === 'string') {
          lastErrorText = errObj.message;
        }
      }

      if (evType === 'item.completed' && item) {
        const itemType = String(item.type || '');
        if (itemType === 'agent_message' && typeof item.text === 'string') {
          agentMessages.push(item.text);
          if (streamToChat) {
            emit({ type: 'stream_delta', sessionId, agent: activeAgent, delta: item.text });
          }
        } else if (itemType === 'reasoning' && typeof item.text === 'string') {
          emit({ type: 'assistant_note', sessionId, agent: activeAgent, text: item.text.slice(0, 260) });
        } else if (
          itemType === 'command_execution' ||
          itemType === 'file_change' ||
          itemType === 'mcp_tool_call' ||
          itemType === 'web_search'
        ) {
          const cmd = String(item.command || item.tool || item.query || itemType);
          const trace: ToolCallTrace = {
            id: String(item.id || randomUUID()),
            sessionId,
            agent: activeAgent,
            toolName: itemType,
            args: { command: cmd },
            risk: itemType === 'web_search' ? 'read' : 'write',
            status: item.status === 'failed' ? 'error' : 'completed',
            output: typeof item.aggregated_output === 'string' ? item.aggregated_output.slice(0, 1400) : undefined,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          };
          toolTraces.push(trace);
          emit({ type: 'tool_event', sessionId, trace });
          emit({ type: 'agent_state', agent: activeAgent, state: 'running_tool', detail: cmd.slice(0, 48) });
        } else if (itemType === 'error' && typeof item.message === 'string') {
          if (!/Under-development features enabled/i.test(item.message)) {
            lastErrorText = item.message;
          }
        }
      }

      if (evType === 'turn.completed' && ev.usage && typeof ev.usage === 'object') {
        const u = ev.usage as Record<string, number>;
        usage = {
          inputTokens: Number(u.input_tokens || 0),
          cachedInputTokens: Number(u.cached_input_tokens || 0),
          cacheWriteTokens: Number(u.cache_write_input_tokens || 0),
          outputTokens: Number(u.output_tokens || 0),
          contextWindow: 400_000,
        };
      }
    },
  });

  const text = agentMessages.join('\n\n').trim();
  if (!text && (res.exitCode !== 0 || lastErrorText)) {
    let errMsg = lastErrorText || res.rawStderr?.trim();
    if (!errMsg && res.rawStdout) {
      for (const line of res.rawStdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.type === 'error' && typeof parsed.message === 'string' && !/Under-development/i.test(parsed.message)) {
            errMsg = parsed.message;
            break;
          }
          if (parsed.type === 'turn.failed' && typeof parsed.error?.message === 'string') {
            errMsg = parsed.error.message;
            break;
          }
        } catch {
          // ignore malformed json
        }
      }
    }
    if (!errMsg) errMsg = 'Codex execution failed.';

    const kind = classifyCliError(errMsg);
    if (kind === 'signed_out' || kind === 'quota_exceeded') {
      return buildSlotAttention({
        reason: kind,
        agent: activeAgent,
        provider: 'codex',
        slotId: slotConfig.id,
        slotLabel: slotConfig.label,
        cliEngine: 'codex',
        modelUsed: model,
        message: `Codex ${slotConfig.label} (${model}): ${errMsg.slice(0, 320)}`,
        toolTraces,
      });
    }
    throw new Error(errMsg.slice(0, 500));
  }

  if (!usage) {
    usage = {
      inputTokens: estimateTokens(fullPrompt),
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: estimateTokens(text),
      contextWindow: 400_000,
      estimated: true,
    };
  }

  await recordCliAudit(
    sessionId,
    activeAgent,
    `codex[${slotConfig.id}]:${model}`,
    `${slotConfig.label} (Codex CLI) · ${planningOnly ? 'plan' : settings.safetyMode}`,
    Date.now() - startedAt,
    text,
    emit,
  );

  return {
    text: text || 'Done.',
    toolTraces,
    usage,
    provider: 'codex',
    slotId: slotConfig.id,
    slotLabel: slotConfig.label,
    cliEngine: 'codex',
    modelUsed: model,
  };
}

// ---------------------------------------------------------------------------
// 4. Official Claude Code CLI (`claude.exe` v2.1.329) — Per-Slot CLAUDE_CONFIG_DIR
// ---------------------------------------------------------------------------

async function runClaudeCli(params: {
  binary: string;
  workspace: string;
  fullPrompt: string;
  model: string;
  slotConfig: AccountSlotConfig;
  env: NodeJS.ProcessEnv;
  settings: AppSettings;
  planningOnly: boolean;
  streamToChat: boolean;
  sessionId: string;
  activeAgent: AgentId;
  toolTraces: ToolCallTrace[];
  emit: (event: ServerWsEvent) => void;
  signal: AbortSignal;
}): Promise<CliRunOutput> {
  const {
    binary,
    workspace,
    fullPrompt,
    model,
    slotConfig,
    env,
    settings,
    planningOnly,
    streamToChat,
    sessionId,
    activeAgent,
    toolTraces,
    emit,
    signal,
  } = params;

  // Verified claude --help flags: -p, --output-format stream-json, --verbose, --model, --effort, --permission-mode, --permission-prompts, --dangerously-skip-permissions
  const args: string[] = ['-p', '--output-format', 'stream-json', '--verbose'];
  if (model && model !== 'default') {
    args.push('--model', model);
  }
  if (settings.effort) {
    args.push('--effort', settings.effort);
  }

  if (planningOnly || settings.safetyMode === 'read_only') {
    args.push('--permission-mode', 'plan');
  } else if (settings.safetyMode === 'safe') {
    args.push('--permission-mode', 'manual', '--permission-prompts', 'none');
  } else if (settings.safetyMode === 'full_auto') {
    args.push('--dangerously-skip-permissions');
  } else {
    args.push('--permission-mode', 'acceptEdits', '--permission-prompts', 'none');
  }

  const startedAt = Date.now();
  let finalText = '';
  let usage: TokenUsageStats | undefined;

  const res = await spawnJsonStream({
    binary,
    args,
    cwd: workspace,
    env,
    stdinText: fullPrompt,
    signal,
    onJsonEvent: (ev) => {
      const evType = String(ev.type || '');
      if (evType === 'assistant' && ev.message && typeof ev.message === 'object') {
        const msg = ev.message as { content?: Array<Record<string, unknown>> };
        for (const block of msg.content || []) {
          if (block.type === 'text' && typeof block.text === 'string') {
            finalText = block.text;
            if (streamToChat) {
              emit({ type: 'stream_delta', sessionId, agent: activeAgent, delta: block.text });
            }
          } else if (block.type === 'tool_use') {
            const trace: ToolCallTrace = {
              id: String(block.id || randomUUID()),
              sessionId,
              agent: activeAgent,
              toolName: String(block.name || 'claude_tool'),
              args: (block.input as Record<string, unknown>) || {},
              risk: settings.safetyMode === 'read_only' ? 'read' : 'write',
              status: 'completed',
              startedAt: new Date().toISOString(),
              finishedAt: new Date().toISOString(),
            };
            toolTraces.push(trace);
            emit({ type: 'tool_event', sessionId, trace });
            emit({ type: 'agent_state', agent: activeAgent, state: 'running_tool', detail: trace.toolName });
          }
        }
      }
      if (evType === 'result') {
        if (typeof ev.result === 'string' && ev.result.trim()) {
          finalText = ev.result.trim();
        }
        const u = ev.usage as Record<string, number> | undefined;
        if (u) {
          usage = {
            inputTokens: Number(u.input_tokens || 0),
            cachedInputTokens: Number(u.cache_read_input_tokens || 0),
            cacheWriteTokens: Number(u.cache_creation_input_tokens || 0),
            outputTokens: Number(u.output_tokens || 0),
            contextWindow: 200_000,
          };
        }
      }
    },
  });

  if (res.exitCode !== 0 && !finalText.trim()) {
    const errMsg = (res.rawStderr || res.rawStdout || 'Claude Code execution failed.').trim();
    const kind = classifyCliError(errMsg);
    if (kind === 'signed_out' || kind === 'quota_exceeded') {
      return buildSlotAttention({
        reason: kind,
        agent: activeAgent,
        provider: 'claude',
        slotId: slotConfig.id,
        slotLabel: slotConfig.label,
        cliEngine: 'claude',
        modelUsed: model,
        message: `Claude Code ${slotConfig.label} (${model}): ${errMsg.slice(0, 320)}`,
        toolTraces,
      });
    }
    throw new Error(errMsg.slice(0, 500));
  }

  if (!usage) {
    usage = {
      inputTokens: estimateTokens(fullPrompt),
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: estimateTokens(finalText),
      contextWindow: 200_000,
      estimated: true,
    };
  }

  await recordCliAudit(
    sessionId,
    activeAgent,
    `claude[${slotConfig.id}]:${model}`,
    `${slotConfig.label} (Claude CLI) · ${planningOnly ? 'plan' : settings.safetyMode}`,
    Date.now() - startedAt,
    finalText,
    emit,
  );

  return {
    text: finalText.trim() || 'Done.',
    toolTraces,
    usage,
    provider: 'claude',
    slotId: slotConfig.id,
    slotLabel: slotConfig.label,
    cliEngine: 'claude',
    modelUsed: model,
  };
}

async function recordCliAudit(
  sessionId: string,
  agent: AgentId,
  toolName: string,
  argsPreview: string,
  durationMs: number,
  summary: string,
  emit: (event: ServerWsEvent) => void,
): Promise<void> {
  const entry: AuditLogEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    sessionId,
    agent,
    toolName,
    risk: 'read',
    decision: 'auto_allowed',
    argsPreview,
    status: 'completed',
    durationMs,
    summary: summary.slice(0, 140),
  };
  await appendAuditLog(entry);
  emit({ type: 'audit_entry', entry });
}

function spawnJsonStream(params: {
  binary: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdinText: string;
  signal: AbortSignal;
  onJsonEvent: (obj: Record<string, unknown>) => void;
}): Promise<{
  exitCode: number;
  rawStdout: string;
  rawStderr: string;
  jsonObjects: Array<Record<string, unknown>>;
}> {
  return new Promise((resolve, reject) => {
    const isCmd = /\.(cmd|bat)$/i.test(params.binary);
    const child = spawn(
      isCmd ? 'cmd.exe' : params.binary,
      isCmd ? ['/c', params.binary, ...params.args] : params.args,
      {
        cwd: params.cwd,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: params.env,
      },
    );

    const jsonObjects: Array<Record<string, unknown>> = [];
    let rawStdout = '';
    let rawStderr = '';
    let lineBuffer = '';
    let settled = false;

    const onAbort = () => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      if (!settled) {
        settled = true;
        reject(new Error('Mission stopped by user.'));
      }
    };

    if (params.signal.aborted) {
      onAbort();
      return;
    }
    params.signal.addEventListener('abort', onAbort, { once: true });

    const processLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('{')) return;
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        jsonObjects.push(parsed);
        params.onJsonEvent(parsed);
      } catch {
        // ignore partial/non-JSON line
      }
    };

    child.stdout?.on('data', (chunk) => {
      const text = String(chunk);
      rawStdout += text;
      lineBuffer += text;
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() || '';
      for (const l of lines) processLine(l);
    });

    child.stderr?.on('data', (chunk) => {
      rawStderr += String(chunk);
    });

    child.on('error', (err) => {
      params.signal.removeEventListener('abort', onAbort);
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    child.on('close', (code) => {
      params.signal.removeEventListener('abort', onAbort);
      if (lineBuffer.trim()) processLine(lineBuffer);
      if (!settled) {
        settled = true;
        resolve({
          exitCode: code ?? 1,
          rawStdout,
          rawStderr,
          jsonObjects,
        });
      }
    });

    if (params.stdinText) {
      child.stdin?.write(params.stdinText, 'utf8');
    }
    child.stdin?.end();
  });
}
