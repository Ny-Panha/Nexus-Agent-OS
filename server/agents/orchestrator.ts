import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type {
  AgentHandoff,
  AgentId,
  AppSettings,
  AuditLogEntry,
  ChatMessage,
  ChatSession,
  PlanStep,
  ServerWsEvent,
  TargetMode,
  TokenUsageStats,
  ToolCallTrace,
} from '../../shared/types.js';
import { fileTools } from '../tools/fileTools.js';
import { systemTools } from '../tools/systemTools.js';
import { browserTools } from '../tools/browserTools.js';
import type { ToolSpec } from '../tools/types.js';
import { generateWithTools, type LlmMessage } from '../llm/client.js';
import { runCliProviderMission } from '../llm/cliRunner.js';
import type { PermissionGate } from '../security/permissions.js';
import { appendAuditLog } from '../store/storage.js';

interface RunArtifacts {
  plan: PlanStep[];
  handoffs: AgentHandoff[];
  toolTraces: ToolCallTrace[];
  screenshots: Array<{ label: string; dataUrl: string; filePath?: string }>;
}

const SPECIALIST_TOOLS: Record<Exclude<AgentId, 'orchestrator'>, ToolSpec[]> = {
  file: fileTools,
  system: systemTools,
  browser: browserTools,
};

function buildSpecialistPrompt(agent: Exclude<AgentId, 'orchestrator'>, settings: AppSettings): string {
  const envInfo = `Laptop Environment:
- OS: Windows (${os.platform()} ${os.release()}, ${os.arch()})
- User: ${settings.userName || os.userInfo().username}
- Home: ${os.homedir()}
- Desktop: ${path.join(os.homedir(), 'Desktop')}
- Default Workspace: ${settings.defaultWorkspace}`;

  const common = `You are a specialist sub-agent inside Nexus Agent OS running directly on the user's Windows laptop.
${envInfo}
Rules:
- Use your tools to inspect real data before answering. Never guess file contents or system metrics.
- Be concise, accurate, and practical.
- If a tool call is denied by the user, acknowledge it respectfully and do not retry the denied action.
- Match the user's language (if Khmer or Romanized Khmer, respond in clear Khmer + simple English technical terms).`;

  if (agent === 'file') {
    return `${common}
Role: File Agent — expert in inspecting directories, searching code/documents, reading files, organizing folders, and creating/editing files on this laptop.`;
  }
  if (agent === 'system') {
    return `${common}
Role: System Agent — expert in Windows PowerShell, running scripts/commands, launching applications, diagnosing CPU/RAM/disk/processes, clipboard operations, and capturing desktop screenshots.`;
  }
  return `${common}
Role: Browser Agent — expert in live web research, fetching and parsing web pages, inspecting rendered DOM, and opening links in the user's browser.`;
}

function buildOrchestratorPrompt(settings: AppSettings): string {
  return `You are Nexus Agent (Orchestrator / មេក្រុម) of Nexus Agent OS — a local multi-agent desktop system running directly on the user's Windows laptop.
Environment:
- OS: Windows (${os.platform()} ${os.release()})
- User: ${settings.userName || os.userInfo().username}
- Home: ${os.homedir()}
- Desktop: ${path.join(os.homedir(), 'Desktop')}
- Default Workspace: ${settings.defaultWorkspace}
- Safety Mode: ${settings.safetyMode}

Your Specialist Team:
1. File Agent (delegate_to_file_agent): list/search/read/write/move/delete files & folders anywhere on the laptop.
2. System Agent (delegate_to_system_agent): PowerShell commands, launch apps, CPU/RAM/disk/process audit, clipboard, desktop screenshot.
3. Browser Agent (delegate_to_browser_agent): live web search, fetch & parse web pages, JS DOM dump, open browser URLs.

How to work:
- For simple greetings or questions needing no laptop/web actions, answer directly.
- For real tasks, FIRST call create_plan with clear, short steps showing which agents will work.
- Delegate actual laptop/web work to your specialist agents (use delegate_parallel when independent agents can work simultaneously).
- After specialists return their results, synthesize a clean, practical final answer for the user.
- Language: If the user writes in Khmer or Romanized Khmer (e.g. "nh jg...", "mer oy..."), reply in clear Khmer with simple English technical terms. Otherwise reply in the user's language.`;
}

function summarizeArgs(args: Record<string, unknown>): string {
  const raw = JSON.stringify(args);
  return raw.length > 220 ? `${raw.slice(0, 220)}…` : raw;
}

function isCliAccountProvider(provider: AppSettings['provider']): boolean {
  return provider === 'gemini_agy' || provider === 'codex' || provider === 'claude';
}

export class MultiAgentRunner {
  private activeRuns = new Map<string, AbortController>();
  private emit: (event: ServerWsEvent) => void;
  private permissions: PermissionGate;

  constructor(params: {
    emit: (event: ServerWsEvent) => void;
    permissions: PermissionGate;
  }) {
    this.emit = params.emit;
    this.permissions = params.permissions;
  }

  public isRunning(sessionId: string): boolean {
    return this.activeRuns.has(sessionId);
  }

  public stopRun(sessionId: string): boolean {
    const controller = this.activeRuns.get(sessionId);
    if (!controller) return false;
    controller.abort();
    this.permissions.denyAllForSession(sessionId);
    this.activeRuns.delete(sessionId);
    this.resetAgentStates();
    return true;
  }

  private resetAgentStates(): void {
    (['orchestrator', 'file', 'system', 'browser'] as AgentId[]).forEach((agent) => {
      this.emit({ type: 'agent_state', agent, state: 'idle' });
    });
  }

  public async runMission(params: {
    session: ChatSession;
    prompt: string;
    target: TargetMode;
    settings: AppSettings;
  }): Promise<ChatMessage> {
    const { session, prompt, target, settings } = params;
    const runId = randomUUID();
    const controller = new AbortController();
    this.activeRuns.set(session.id, controller);

    const artifacts: RunArtifacts = {
      plan: [],
      handoffs: [],
      toolTraces: [],
      screenshots: [],
    };

    this.emit({ type: 'run_started', sessionId: session.id, runId, target });

    try {
      const responderAgent: AgentId = target === 'auto' ? 'orchestrator' : target;

      // Account-based CLI providers (Gemini Antigravity, Codex ChatGPT, Claude Code)
      if (isCliAccountProvider(settings.provider)) {
        const cliResult = await runCliProviderMission({
          session,
          prompt,
          target,
          settings,
          emit: this.emit,
          signal: controller.signal,
        });

        if (cliResult.needsAttention) {
          this.emit({ type: 'agent_state', agent: responderAgent, state: 'error', detail: 'Needs sign-in' });
          const attnMsg: ChatMessage = {
            id: randomUUID(),
            role: 'assistant',
            kind: 'needs_attention',
            agent: responderAgent,
            provider: settings.provider,
            model: cliResult.modelUsed,
            content: cliResult.needsAttention.message,
            actionCta: cliResult.needsAttention.action,
            createdAt: new Date().toISOString(),
          };
          this.emit({ type: 'run_finished', sessionId: session.id, runId, message: attnMsg });
          return attnMsg;
        }

        const assistantMessage: ChatMessage = {
          id: randomUUID(),
          role: 'assistant',
          kind: 'message',
          agent: responderAgent,
          provider: settings.provider,
          model: cliResult.modelUsed,
          content: cliResult.text,
          createdAt: new Date().toISOString(),
          toolTraces: cliResult.toolTraces.length ? cliResult.toolTraces : undefined,
          usage: cliResult.usage,
        };

        this.emit({ type: 'agent_state', agent: responderAgent, state: 'done' });
        this.emit({
          type: 'run_finished',
          sessionId: session.id,
          runId,
          message: assistantMessage,
        });
        return assistantMessage;
      }

      // Native Local AI (Ollama) / optional API multi-agent tool-calling loop
      const effectiveSettings: AppSettings = {
        ...settings,
        ollamaModel: settings.selectedModels?.ollama || settings.ollamaModel,
        geminiModel: settings.selectedModels?.gemini_api || settings.geminiModel,
        openaiModel: settings.selectedModels?.openai_compatible || settings.openaiModel,
      };

      const historyContext: LlmMessage[] = session.messages
        .filter((m) => (!m.kind || m.kind === 'message') && m.content.trim())
        .slice(-9, -1)
        .map((m) => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          text: m.content,
        }));
      historyContext.push({ role: 'user', text: prompt });

      let finalContent = '';

      if (target === 'auto' || target === 'orchestrator') {
        finalContent = await this.runOrchestratorLoop({
          sessionId: session.id,
          messages: historyContext,
          settings: effectiveSettings,
          artifacts,
          signal: controller.signal,
        });
      } else {
        finalContent = await this.runSpecialistLoop({
          sessionId: session.id,
          agent: target,
          taskMessages: historyContext,
          settings: effectiveSettings,
          artifacts,
          signal: controller.signal,
        });
      }

      const estimatedInput = Math.ceil(
        historyContext.reduce((acc, m) => acc + (m.text?.length || 0), 0) / 4,
      );
      const usage: TokenUsageStats = {
        inputTokens: estimatedInput,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: Math.max(1, Math.ceil(finalContent.length / 4)),
        contextWindow: settings.provider === 'ollama' ? 32_768 : 128_000,
        estimated: true,
      };

      const assistantMessage: ChatMessage = {
        id: randomUUID(),
        role: 'assistant',
        kind: 'message',
        agent: responderAgent,
        provider: settings.provider,
        model:
          settings.provider === 'ollama'
            ? effectiveSettings.ollamaModel
            : settings.provider === 'gemini_api'
              ? effectiveSettings.geminiModel
              : effectiveSettings.openaiModel,
        content: finalContent || 'Mission completed.',
        createdAt: new Date().toISOString(),
        plan: artifacts.plan.length ? artifacts.plan : undefined,
        handoffs: artifacts.handoffs.length ? artifacts.handoffs : undefined,
        toolTraces: artifacts.toolTraces.length ? artifacts.toolTraces : undefined,
        screenshots: artifacts.screenshots.length ? artifacts.screenshots : undefined,
        usage,
      };

      this.emit({
        type: 'run_finished',
        sessionId: session.id,
        runId,
        message: assistantMessage,
      });

      return assistantMessage;
    } catch (err) {
      const errorMsg = controller.signal.aborted
        ? 'Mission stopped by user.'
        : err instanceof Error
          ? err.message
          : String(err);

      const isOllamaDown =
        settings.provider === 'ollama' && /fetch failed|ECONNREFUSED|not reachable|Ollama/i.test(errorMsg);

      const failedMessage: ChatMessage = {
        id: randomUUID(),
        role: 'assistant',
        kind: isOllamaDown ? 'needs_attention' : 'message',
        agent: target === 'auto' ? 'orchestrator' : target,
        provider: settings.provider,
        content: isOllamaDown
          ? 'Local AI (Ollama) is not running right now. Start Ollama locally to chat offline for free.'
          : errorMsg,
        error: isOllamaDown ? undefined : errorMsg,
        actionCta: isOllamaDown
          ? {
              type: 'start_ollama',
              provider: 'ollama',
              label: 'Start Local AI (Ollama)',
            }
          : undefined,
        createdAt: new Date().toISOString(),
        plan: artifacts.plan.length ? artifacts.plan : undefined,
        handoffs: artifacts.handoffs.length ? artifacts.handoffs : undefined,
        toolTraces: artifacts.toolTraces.length ? artifacts.toolTraces : undefined,
        screenshots: artifacts.screenshots.length ? artifacts.screenshots : undefined,
      };

      this.emit({ type: 'run_finished', sessionId: session.id, runId, message: failedMessage });
      return failedMessage;
    } finally {
      this.activeRuns.delete(session.id);
      this.resetAgentStates();
    }
  }

  private async runOrchestratorLoop(params: {
    sessionId: string;
    messages: LlmMessage[];
    settings: AppSettings;
    artifacts: RunArtifacts;
    signal: AbortSignal;
  }): Promise<string> {
    const { sessionId, settings, artifacts, signal } = params;
    const conversation: LlmMessage[] = [...params.messages];

    const delegateSingle = async (
      to: Exclude<AgentId, 'orchestrator'>,
      task: string,
      extraContext?: string,
    ): Promise<string> => {
      const handoff: AgentHandoff = {
        id: randomUUID(),
        from: 'orchestrator',
        to,
        task,
        status: 'running',
        startedAt: new Date().toISOString(),
      };
      artifacts.handoffs.push(handoff);
      this.emit({ type: 'handoff_event', sessionId, handoff });

      const planStep = artifacts.plan.find((s) => s.agent === to && s.status === 'pending');
      if (planStep) {
        planStep.status = 'in_progress';
        this.emit({ type: 'plan_updated', sessionId, steps: [...artifacts.plan] });
      }

      try {
        const promptText = extraContext
          ? `Task from Orchestrator:\n${task}\n\nAdditional Context:\n${extraContext}`
          : `Task from Orchestrator:\n${task}`;

        const report = await this.runSpecialistLoop({
          sessionId,
          agent: to,
          taskMessages: [{ role: 'user', text: promptText }],
          settings,
          artifacts,
          signal,
        });

        handoff.status = 'completed';
        handoff.summary = report.slice(0, 320);
        handoff.finishedAt = new Date().toISOString();
        this.emit({ type: 'handoff_event', sessionId, handoff });

        if (planStep) {
          planStep.status = 'completed';
          this.emit({ type: 'plan_updated', sessionId, steps: [...artifacts.plan] });
        }

        return `[${to.toUpperCase()} AGENT REPORT]\n${report}`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        handoff.status = 'error';
        handoff.summary = msg;
        handoff.finishedAt = new Date().toISOString();
        this.emit({ type: 'handoff_event', sessionId, handoff });
        if (planStep) {
          planStep.status = 'failed';
          this.emit({ type: 'plan_updated', sessionId, steps: [...artifacts.plan] });
        }
        return `[${to.toUpperCase()} AGENT ERROR]\n${msg}`;
      }
    };

    const orchestratorTools: ToolSpec[] = [
      {
        name: 'create_plan',
        description: 'Publish a visible multi-agent workflow plan to the user interface before executing tasks.',
        parameters: {
          type: 'object',
          properties: {
            steps: {
              type: 'array',
              description: 'Ordered list of workflow steps.',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Short step title.' },
                  agent: {
                    type: 'string',
                    description: 'Assigned agent.',
                    enum: ['orchestrator', 'file', 'system', 'browser'],
                  },
                  detail: { type: 'string', description: 'What this agent will do.' },
                },
                required: ['title', 'agent', 'detail'],
              },
            },
          },
          required: ['steps'],
        },
        assessRisk: () => ({ risk: 'read', reason: 'Publish workflow plan' }),
        execute: async (args) => {
          const rawSteps = Array.isArray(args.steps) ? args.steps : [];
          artifacts.plan = rawSteps.map((s) => {
            const obj = s as Record<string, unknown>;
            const a = String(obj.agent || 'orchestrator');
            const validAgent: AgentId =
              a === 'file' || a === 'system' || a === 'browser' ? a : 'orchestrator';
            return {
              id: randomUUID(),
              title: String(obj.title || 'Step'),
              agent: validAgent,
              detail: String(obj.detail || ''),
              status: 'pending',
            };
          });
          this.emit({ type: 'plan_updated', sessionId, steps: [...artifacts.plan] });
          return { text: `Workflow plan created with ${artifacts.plan.length} steps.` };
        },
      },
      {
        name: 'delegate_to_file_agent',
        description:
          'Delegate a file/folder operation (list, search, read, write, organize, move, delete) to the File Agent.',
        parameters: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'Clear instruction for File Agent.' },
            context: { type: 'string', description: 'Optional context or data from earlier agents.' },
          },
          required: ['task'],
        },
        assessRisk: () => ({ risk: 'read', reason: 'Delegate to File Agent' }),
        execute: async (args) => ({
          text: await delegateSingle('file', String(args.task || ''), args.context ? String(args.context) : undefined),
        }),
      },
      {
        name: 'delegate_to_system_agent',
        description:
          'Delegate a Windows system task (PowerShell, apps, CPU/RAM/disk/process check, clipboard, screenshot) to the System Agent.',
        parameters: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'Clear instruction for System Agent.' },
            context: { type: 'string', description: 'Optional context from earlier steps.' },
          },
          required: ['task'],
        },
        assessRisk: () => ({ risk: 'read', reason: 'Delegate to System Agent' }),
        execute: async (args) => ({
          text: await delegateSingle('system', String(args.task || ''), args.context ? String(args.context) : undefined),
        }),
      },
      {
        name: 'delegate_to_browser_agent',
        description:
          'Delegate a web task (search, fetch/parse web page, inspect JS DOM, open URL) to the Browser Agent.',
        parameters: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'Clear instruction for Browser Agent.' },
            context: { type: 'string', description: 'Optional context from earlier steps.' },
          },
          required: ['task'],
        },
        assessRisk: () => ({ risk: 'read', reason: 'Delegate to Browser Agent' }),
        execute: async (args) => ({
          text: await delegateSingle('browser', String(args.task || ''), args.context ? String(args.context) : undefined),
        }),
      },
      {
        name: 'delegate_parallel',
        description:
          'Run multiple specialist agents concurrently (in parallel) when their tasks are independent.',
        parameters: {
          type: 'object',
          properties: {
            tasks: {
              type: 'array',
              description: 'List of independent specialist assignments to execute in parallel.',
              items: {
                type: 'object',
                properties: {
                  agent: { type: 'string', description: 'Target specialist.', enum: ['file', 'system', 'browser'] },
                  task: { type: 'string', description: 'Task description.' },
                },
                required: ['agent', 'task'],
              },
            },
          },
          required: ['tasks'],
        },
        assessRisk: () => ({ risk: 'read', reason: 'Delegate tasks in parallel' }),
        execute: async (args) => {
          const items = Array.isArray(args.tasks) ? args.tasks : [];
          const results = await Promise.all(
            items.map((item) => {
              const obj = item as Record<string, unknown>;
              const a = String(obj.agent || 'system');
              const target: Exclude<AgentId, 'orchestrator'> =
                a === 'file' || a === 'browser' ? a : 'system';
              return delegateSingle(target, String(obj.task || ''));
            }),
          );
          return { text: results.join('\n\n---\n\n') };
        },
      },
    ];

    const systemPrompt = buildOrchestratorPrompt(settings);
    const maxSteps = Math.max(settings.maxToolSteps || 10, 4);

    for (let step = 0; step < maxSteps; step++) {
      if (signal.aborted) throw new Error('Mission aborted');

      this.emit({
        type: 'agent_state',
        agent: 'orchestrator',
        state: 'thinking',
        detail: step === 0 ? 'Planning mission...' : 'Reviewing specialist reports...',
      });

      const response = await generateWithTools({
        settings,
        systemPrompt,
        messages: conversation,
        tools: orchestratorTools,
        signal,
      });

      if (response.text && response.toolCalls.length > 0) {
        this.emit({
          type: 'assistant_note',
          sessionId,
          agent: 'orchestrator',
          text: response.text,
        });
      }

      if (response.toolCalls.length === 0) {
        artifacts.plan.forEach((p) => {
          if (p.agent === 'orchestrator' && p.status !== 'completed') {
            p.status = 'completed';
          }
        });
        if (artifacts.plan.length) {
          this.emit({ type: 'plan_updated', sessionId, steps: [...artifacts.plan] });
        }
        this.emit({ type: 'agent_state', agent: 'orchestrator', state: 'done' });
        return response.text;
      }

      conversation.push({
        role: 'assistant',
        text: response.text,
        toolCalls: response.toolCalls,
      });

      for (const tc of response.toolCalls) {
        const tool = orchestratorTools.find((t) => t.name === tc.name);
        if (!tool) {
          conversation.push({
            role: 'tool',
            toolCallId: tc.id,
            toolName: tc.name,
            text: `Unknown orchestration tool: ${tc.name}`,
          });
          continue;
        }
        this.emit({
          type: 'agent_state',
          agent: 'orchestrator',
          state: 'running_tool',
          detail: tc.name,
        });
        const out = await tool.execute(tc.args, {
          defaultWorkspace: settings.defaultWorkspace,
          signal,
        });
        conversation.push({
          role: 'tool',
          toolCallId: tc.id,
          toolName: tc.name,
          text: out.text,
        });
      }
    }

    this.emit({ type: 'agent_state', agent: 'orchestrator', state: 'done' });
    return 'Reached maximum orchestration steps. Review the activity log for completed actions.';
  }

  private async runSpecialistLoop(params: {
    sessionId: string;
    agent: Exclude<AgentId, 'orchestrator'>;
    taskMessages: LlmMessage[];
    settings: AppSettings;
    artifacts: RunArtifacts;
    signal: AbortSignal;
  }): Promise<string> {
    const { sessionId, agent, settings, artifacts, signal } = params;
    const tools = SPECIALIST_TOOLS[agent];
    const conversation: LlmMessage[] = [...params.taskMessages];
    const systemPrompt = buildSpecialistPrompt(agent, settings);
    const maxSteps = Math.min(Math.max(settings.maxToolSteps || 8, 3), 12);

    for (let step = 0; step < maxSteps; step++) {
      if (signal.aborted) throw new Error('Mission aborted');

      this.emit({
        type: 'agent_state',
        agent,
        state: 'thinking',
        detail: `Step ${step + 1}`,
      });

      const response = await generateWithTools({
        settings,
        systemPrompt,
        messages: conversation,
        tools,
        signal,
      });

      if (response.toolCalls.length === 0) {
        this.emit({ type: 'agent_state', agent, state: 'done' });
        return response.text;
      }

      conversation.push({
        role: 'assistant',
        text: response.text,
        toolCalls: response.toolCalls,
      });

      for (const tc of response.toolCalls) {
        const tool = tools.find((t) => t.name === tc.name);
        if (!tool) {
          conversation.push({
            role: 'tool',
            toolCallId: tc.id,
            toolName: tc.name,
            text: `Unknown tool: ${tc.name}`,
          });
          continue;
        }

        const { risk, reason } = tool.assessRisk(tc.args);
        const started = Date.now();
        const trace: ToolCallTrace = {
          id: randomUUID(),
          sessionId,
          agent,
          toolName: tool.name,
          args: tc.args,
          risk,
          status: 'running',
          startedAt: new Date().toISOString(),
        };
        artifacts.toolTraces.push(trace);

        if (this.permissions.isBlockedInReadOnly(settings.safetyMode, risk)) {
          trace.status = 'denied';
          trace.error = 'Blocked in Read-only permission mode';
          trace.finishedAt = new Date().toISOString();
          trace.durationMs = Date.now() - started;
          this.emit({ type: 'tool_event', sessionId, trace: { ...trace } });
          conversation.push({
            role: 'tool',
            toolCallId: tc.id,
            toolName: tc.name,
            text: 'READ-ONLY MODE ACTIVE. Do not modify files or run mutating commands; present a plan instead.',
          });
          continue;
        }

        let decision: AuditLogEntry['decision'] = 'auto_allowed';
        if (this.permissions.needsApproval(settings.safetyMode, risk, sessionId, tool.name)) {
          trace.status = 'pending_approval';
          this.emit({ type: 'tool_event', sessionId, trace: { ...trace } });
          this.emit({
            type: 'agent_state',
            agent,
            state: 'waiting_approval',
            detail: `Waiting approval for ${tool.name}`,
          });

          const approved = await this.permissions.requestApproval({
            sessionId,
            agent,
            toolName: tool.name,
            args: tc.args,
            risk,
            reason,
            signal,
          });

          if (!approved) {
            decision = 'user_denied';
            trace.status = 'denied';
            trace.error = 'Denied by user in Safety Gate';
            trace.finishedAt = new Date().toISOString();
            trace.durationMs = Date.now() - started;
            this.emit({ type: 'tool_event', sessionId, trace: { ...trace } });

            const entry: AuditLogEntry = {
              id: randomUUID(),
              timestamp: trace.finishedAt,
              sessionId,
              agent,
              toolName: tool.name,
              risk,
              decision,
              argsPreview: summarizeArgs(tc.args),
              status: 'denied',
              durationMs: trace.durationMs,
              summary: 'User denied action',
            };
            await appendAuditLog(entry);
            this.emit({ type: 'audit_entry', entry });

            conversation.push({
              role: 'tool',
              toolCallId: tc.id,
              toolName: tc.name,
              text: 'PERMISSION DENIED BY USER. Do not retry this exact action; explain to the user or propose a safer alternative.',
            });
            continue;
          }
          decision = 'user_allowed';
        }

        trace.status = 'running';
        this.emit({ type: 'tool_event', sessionId, trace: { ...trace } });
        this.emit({
          type: 'agent_state',
          agent,
          state: 'running_tool',
          detail: tool.name,
        });

        try {
          const result = await tool.execute(tc.args, {
            defaultWorkspace: settings.defaultWorkspace,
            signal,
          });
          trace.status = 'completed';
          trace.output = result.text;
          trace.imageDataUrl = result.imageDataUrl;
          trace.finishedAt = new Date().toISOString();
          trace.durationMs = Date.now() - started;
          this.emit({ type: 'tool_event', sessionId, trace: { ...trace } });

          if (result.imageDataUrl) {
            artifacts.screenshots.push({
              label: `${agent}:${tool.name}`,
              dataUrl: result.imageDataUrl,
              filePath: result.filePath,
            });
          }

          const entry: AuditLogEntry = {
            id: randomUUID(),
            timestamp: trace.finishedAt,
            sessionId,
            agent,
            toolName: tool.name,
            risk,
            decision,
            argsPreview: summarizeArgs(tc.args),
            status: 'completed',
            durationMs: trace.durationMs,
            summary: result.text.slice(0, 140),
          };
          await appendAuditLog(entry);
          this.emit({ type: 'audit_entry', entry });

          conversation.push({
            role: 'tool',
            toolCallId: tc.id,
            toolName: tc.name,
            text: result.text,
            imageBase64: result.imageBase64,
            imageMimeType: result.imageMimeType,
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          trace.status = 'error';
          trace.error = errMsg;
          trace.finishedAt = new Date().toISOString();
          trace.durationMs = Date.now() - started;
          this.emit({ type: 'tool_event', sessionId, trace: { ...trace } });

          const entry: AuditLogEntry = {
            id: randomUUID(),
            timestamp: trace.finishedAt,
            sessionId,
            agent,
            toolName: tool.name,
            risk,
            decision,
            argsPreview: summarizeArgs(tc.args),
            status: 'error',
            durationMs: trace.durationMs,
            summary: errMsg.slice(0, 140),
          };
          await appendAuditLog(entry);
          this.emit({ type: 'audit_entry', entry });

          conversation.push({
            role: 'tool',
            toolCallId: tc.id,
            toolName: tc.name,
            text: `TOOL ERROR: ${errMsg}`,
          });
        }
      }
    }

    this.emit({ type: 'agent_state', agent, state: 'done' });
    return 'Specialist reached maximum tool steps. Check activity logs for details.';
  }
}
