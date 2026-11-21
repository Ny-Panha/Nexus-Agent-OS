import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fsSync from 'node:fs';
import os from 'node:os';
import type {
  AgentId,
  AppSettings,
  AuditLogEntry,
  ChatSession,
  EffortLevel,
  ModelOption,
  NeedsAttentionAction,
  ProviderType,
  ServerWsEvent,
  TargetMode,
  TokenUsageStats,
  ToolCallTrace,
} from '../../shared/types.js';
import { appendAuditLog } from '../store/storage.js';
import { getSingleProviderStatus, resolveBinaryPath } from './providerRegistry.js';

export interface CliRunOutput {
  text: string;
  toolTraces: ToolCallTrace[];
  usage?: TokenUsageStats;
  modelUsed: string;
  needsAttention?: {
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
}): string {
  const { session, prompt, target, settings, includeHistory } = params;
  const userName = settings.userName?.trim() || os.userInfo().username;

  if (!includeHistory) {
    // Warm persistent worker already holds prior turns in memory!
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

function mapProviderTitle(provider: ProviderType): string {
  if (provider === 'claude') return 'Claude Code';
  if (provider === 'codex') return 'Codex (ChatGPT)';
  if (provider === 'gemini_agy') return 'Gemini (Antigravity)';
  if (provider === 'ollama') return 'Local AI';
  return provider;
}

/**
 * Resolves a base model + effort level into an exact valid `agy` model ID so
 * `--model` and `--effort` NEVER conflict (e.g., gemini-3.8-flash + max -> gemini-3.8-flash-high).
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

  // If model already encodes an effort suffix, never pass --effort alongside it
  if (suffixRe.test(selectedModel)) {
    return { modelId: selectedModel, passEffortFlag: false };
  }

  return { modelId: matched?.id || selectedModel || 'gemini-3.8-flash-medium', passEffortFlag: false };
}

// ---------------------------------------------------------------------------
// Warm Persistent `agy` Worker Pool (eliminates 20s cold-start on follow-up turns)
// ---------------------------------------------------------------------------
interface WarmAgyWorker {
  key: string;
  sessionId: string;
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
    safetyMode: AppSettings['safetyMode'];
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
  binary: string;
  workspace: string;
  modelId: string;
  safetyMode: AppSettings['safetyMode'];
}): { worker: WarmAgyWorker; isNew: boolean } {
  const key = `${params.sessionId}::${params.modelId}::${params.safetyMode}`;
  const existing = warmAgyPool.get(key);
  if (existing && !existing.child.killed && existing.child.exitCode === null && !existing.busy) {
    if (existing.idleTimer) clearTimeout(existing.idleTimer);
    existing.lastUsedAt = Date.now();
    return { worker: existing, isNew: false };
  }

  // Close any previous worker for the same session with a different model/mode
  disposeWarmWorkersForSession(params.sessionId);

  const args: string[] = [
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--model',
    params.modelId,
  ];
  if (params.safetyMode === 'read_only') {
    args.push('--mode', 'plan');
  } else if (params.safetyMode === 'full_auto') {
    args.push('--dangerously-skip-permissions');
  } else {
    args.push('--mode', 'accept-edits');
  }
  args.push('-p=');

  const child = spawn(params.binary, args, {
    cwd: params.workspace,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  const worker: WarmAgyWorker = {
    key,
    sessionId: params.sessionId,
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
        turn.emit({
          type: 'stream_delta',
          sessionId: worker.sessionId,
          agent: turn.activeAgent,
          delta: stepUpd.text_delta,
        });
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

      // If result returned status ERROR (e.g. quota reached), surface it as error
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

export async function runCliProviderMission(params: {
  session: ChatSession;
  prompt: string;
  target: TargetMode;
  settings: AppSettings;
  emit: (event: ServerWsEvent) => void;
  signal: AbortSignal;
}): Promise<CliRunOutput> {
  const { session, prompt, target, settings, emit, signal } = params;
  const provider = settings.provider;
  const activeAgent: AgentId = target === 'auto' ? 'orchestrator' : target;
  const status = await getSingleProviderStatus(provider, settings, false);
  const binary = status?.binaryPath || (await resolveBinaryPath(provider));

  const selectedModel =
    settings.selectedModels?.[provider] ||
    status?.defaultModel ||
    (provider === 'claude' ? 'sonnet' : provider === 'codex' ? 'default' : 'gemini-3.8-flash');

  if (!binary || !status?.installed) {
    return {
      text: `${mapProviderTitle(provider)} CLI is not installed on this computer.`,
      toolTraces: [],
      modelUsed: selectedModel,
      needsAttention: {
        message: `${mapProviderTitle(provider)} CLI is not installed on this computer. Switch to a signed-in provider or open AI Accounts in Settings.`,
        action: {
          type: 'open_settings',
          provider,
          label: 'Open AI Accounts',
        },
      },
    };
  }

  if (!status.signedIn) {
    return {
      text: status.error || `${mapProviderTitle(provider)} is not signed in.`,
      toolTraces: [],
      modelUsed: selectedModel,
      needsAttention: {
        message:
          status.error ||
          `${mapProviderTitle(provider)} profile is not signed in. Sign in with your account, then retry your message.`,
        action: {
          type: 'login',
          provider,
          label: status.loginActionLabel || `Sign in to ${mapProviderTitle(provider)}`,
        },
      },
    };
  }

  const workspace = safeWorkspaceDir(settings.defaultWorkspace);
  const toolTraces: ToolCallTrace[] = [];

  if (provider === 'gemini_agy') {
    const resolved = resolveAgyModelVariant(selectedModel, settings.effort, status.models);
    emit({
      type: 'agent_state',
      agent: activeAgent,
      state: 'thinking',
      detail: `Gemini · ${resolved.modelId}`,
    });

    try {
      return await runWarmAgyTurn({
        binary,
        workspace,
        session,
        prompt,
        target,
        modelId: resolved.modelId,
        settings,
        activeAgent,
        toolTraces,
        emit,
        signal,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // Automatic fallback if selected Antigravity model hits individual quota (429 RESOURCE_EXHAUSTED)
      if (/quota reached|RESOURCE_EXHAUSTED|429/i.test(errMsg)) {
        const fallbackCandidates = ['gemini-4-argon', 'gemini-4-hydrogen', 'gemini-4-neon', 'gpt-oss-120b'];
        const currentBase = resolved.modelId.replace(/-(low|medium|high|xhigh|max)$/i, '');
        const nextBase = fallbackCandidates.find(
          (c) => c !== currentBase && status.models.some((m) => m.id === c),
        );
        if (nextBase) {
          const fallbackResolved = resolveAgyModelVariant(nextBase, settings.effort, status.models);
          emit({
            type: 'assistant_note',
            sessionId: session.id,
            agent: activeAgent,
            text: `Quota reached on ${resolved.modelId} — automatically switching to ${fallbackResolved.modelId}...`,
          });
          return runWarmAgyTurn({
            binary,
            workspace,
            session,
            prompt,
            target,
            modelId: fallbackResolved.modelId,
            settings,
            activeAgent,
            toolTraces,
            emit,
            signal,
          });
        }
      }
      throw err;
    }
  }

  emit({
    type: 'agent_state',
    agent: activeAgent,
    state: 'thinking',
    detail: `${mapProviderTitle(provider)} · ${selectedModel}`,
  });

  const fullPrompt = buildConversationPrompt({
    session,
    prompt,
    target,
    settings,
    includeHistory: true,
  });

  if (provider === 'codex') {
    return runCodexCli({
      binary,
      workspace,
      fullPrompt,
      model: selectedModel,
      settings,
      sessionId: session.id,
      activeAgent,
      toolTraces,
      emit,
      signal,
    });
  }

  if (provider === 'claude') {
    return runClaudeCli({
      binary,
      workspace,
      fullPrompt,
      model: selectedModel,
      settings,
      sessionId: session.id,
      activeAgent,
      toolTraces,
      emit,
      signal,
    });
  }

  throw new Error(`Unsupported CLI provider: ${provider}`);
}

async function runWarmAgyTurn(params: {
  binary: string;
  workspace: string;
  session: ChatSession;
  prompt: string;
  target: TargetMode;
  modelId: string;
  settings: AppSettings;
  activeAgent: AgentId;
  toolTraces: ToolCallTrace[];
  emit: (event: ServerWsEvent) => void;
  signal: AbortSignal;
}): Promise<CliRunOutput> {
  const { binary, workspace, session, prompt, target, modelId, settings, activeAgent, toolTraces, emit, signal } =
    params;

  const { worker, isNew } = getOrCreateWarmAgyWorker({
    sessionId: session.id,
    binary,
    workspace,
    modelId,
    safetyMode: settings.safetyMode,
  });

  const messageText = buildConversationPrompt({
    session,
    prompt,
    target,
    settings,
    includeHistory: isNew,
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
    if (/sign in|login|auth|unauthorized|credential/i.test(result.error)) {
      return {
        text: result.error,
        toolTraces,
        modelUsed: modelId,
        needsAttention: {
          message: result.error.slice(0, 320),
          action: { type: 'login', provider: 'gemini_agy', label: 'Sign in with Google' },
        },
      };
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

  await recordCliAudit(session.id, activeAgent, `gemini_agy:${modelId}`, Date.now() - startedAt, finalText, emit);

  return { text: finalText, toolTraces, usage, modelUsed: modelId };
}

async function runCodexCli(params: {
  binary: string;
  workspace: string;
  fullPrompt: string;
  model: string;
  settings: AppSettings;
  sessionId: string;
  activeAgent: AgentId;
  toolTraces: ToolCallTrace[];
  emit: (event: ServerWsEvent) => void;
  signal: AbortSignal;
}): Promise<CliRunOutput> {
  const { binary, workspace, fullPrompt, model, settings, sessionId, activeAgent, toolTraces, emit, signal } = params;

  const args: string[] = ['exec', '--skip-git-repo-check', '--ephemeral', '-C', workspace, '--json'];
  if (model && model !== 'default') {
    args.push('-m', model);
  }
  const effortMap: Record<string, string> = {
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'high',
    max: 'high',
  };
  args.push('-c', `model_reasoning_effort="${effortMap[settings.effort] || 'medium'}"`);

  if (settings.safetyMode === 'read_only') {
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
    stdinText: fullPrompt,
    signal,
    onJsonEvent: (ev) => {
      const evType = String(ev.type || '');
      const item = ev.item as Record<string, unknown> | undefined;

      if (evType === 'item.completed' && item) {
        const itemType = String(item.type || '');
        if (itemType === 'agent_message' && typeof item.text === 'string') {
          agentMessages.push(item.text);
          emit({ type: 'stream_delta', sessionId, agent: activeAgent, delta: item.text });
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
    const errMsg = lastErrorText || res.rawStderr || 'Codex execution failed.';
    if (/sign in|login|auth|unauthorized|not logged in/i.test(errMsg)) {
      return {
        text: errMsg,
        toolTraces,
        modelUsed: model,
        needsAttention: {
          message: errMsg.slice(0, 320),
          action: { type: 'login', provider: 'codex', label: 'Sign in with ChatGPT' },
        },
      };
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

  await recordCliAudit(sessionId, activeAgent, `codex:${model}`, Date.now() - startedAt, text, emit);

  return { text: text || 'Done.', toolTraces, usage, modelUsed: model };
}

async function runClaudeCli(params: {
  binary: string;
  workspace: string;
  fullPrompt: string;
  model: string;
  settings: AppSettings;
  sessionId: string;
  activeAgent: AgentId;
  toolTraces: ToolCallTrace[];
  emit: (event: ServerWsEvent) => void;
  signal: AbortSignal;
}): Promise<CliRunOutput> {
  const { binary, workspace, fullPrompt, model, settings, sessionId, activeAgent, toolTraces, emit, signal } = params;

  const args: string[] = ['-p', '--output-format', 'stream-json', '--verbose'];
  if (model && model !== 'default') {
    args.push('--model', model);
  }
  if (settings.effort) {
    args.push('--effort', settings.effort);
  }

  if (settings.safetyMode === 'read_only') {
    args.push('--permission-mode', 'plan');
  } else if (settings.safetyMode === 'full_auto') {
    args.push('--dangerously-skip-permissions');
  } else {
    args.push('--permission-mode', 'acceptEdits');
  }

  const startedAt = Date.now();
  let finalText = '';
  let usage: TokenUsageStats | undefined;

  const res = await spawnJsonStream({
    binary,
    args,
    cwd: workspace,
    stdinText: fullPrompt,
    signal,
    onJsonEvent: (ev) => {
      const evType = String(ev.type || '');
      if (evType === 'assistant' && ev.message && typeof ev.message === 'object') {
        const msg = ev.message as { content?: Array<Record<string, unknown>> };
        for (const block of msg.content || []) {
          if (block.type === 'text' && typeof block.text === 'string') {
            finalText = block.text;
            emit({ type: 'stream_delta', sessionId, agent: activeAgent, delta: block.text });
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
    if (/login|auth|not logged in|sign in/i.test(errMsg)) {
      return {
        text: errMsg,
        toolTraces,
        modelUsed: model,
        needsAttention: {
          message: errMsg.slice(0, 320),
          action: { type: 'login', provider: 'claude', label: 'Sign in with Claude' },
        },
      };
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

  await recordCliAudit(sessionId, activeAgent, `claude:${model}`, Date.now() - startedAt, finalText, emit);

  return { text: finalText.trim() || 'Done.', toolTraces, usage, modelUsed: model };
}

async function recordCliAudit(
  sessionId: string,
  agent: AgentId,
  toolName: string,
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
    argsPreview: 'CLI account turn',
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
        env: { ...process.env },
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
