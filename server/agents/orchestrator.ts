import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type {
  AgentHandoff,
  AgentId,
  AgentRouteConfig,
  AgentSlotError,
  AppSettings,
  AuditLogEntry,
  ChatMessage,
  ChatSession,
  CliAccountProvider,
  PlanStep,
  ProviderType,
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
import { runCliProviderMission, type CliRunOutput } from '../llm/cliRunner.js';
import type { PermissionGate } from '../security/permissions.js';
import { appendAuditLog, DEFAULT_AGENT_ROUTES } from '../store/storage.js';

interface RunArtifacts {
  plan: PlanStep[];
  handoffs: AgentHandoff[];
  toolTraces: ToolCallTrace[];
  screenshots: Array<{ label: string; dataUrl: string; filePath?: string }>;
  agentErrors: AgentSlotError[];
}

interface ParsedDelegation {
  plan?: Array<{ title: string; agent: AgentId; detail: string }>;
  delegations: Array<{ agent: Exclude<AgentId, 'orchestrator'>; task: string }>;
}

const SPECIALIST_TOOLS: Record<Exclude<AgentId, 'orchestrator'>, ToolSpec[]> = {
  file: fileTools,
  system: systemTools,
  browser: browserTools,
};

function isCliAccountProvider(provider: ProviderType): provider is CliAccountProvider {
  return provider === 'gemini_agy' || provider === 'codex' || provider === 'claude';
}

export function resolveAgentRoute(agent: AgentId, settings: AppSettings): AgentRouteConfig {
  const configured = settings.agentRoutes?.[agent];
  if (configured?.provider) {
    return {
      provider: configured.provider,
      slotId: isCliAccountProvider(configured.provider)
        ? configured.slotId || settings.activeSlots?.[configured.provider] || 'slot-1'
        : undefined,
      model: configured.model || settings.selectedModels?.[configured.provider] || DEFAULT_AGENT_ROUTES[agent].model,
    };
  }
  const fallback = DEFAULT_AGENT_ROUTES[agent];
  const prov = settings.provider || fallback.provider;
  return {
    provider: prov,
    slotId: isCliAccountProvider(prov) ? settings.activeSlots?.[prov] || 'slot-1' : undefined,
    model: settings.selectedModels?.[prov] || fallback.model,
  };
}

function resolveSlotLabelFromSettings(settings: AppSettings, provider: ProviderType, slotId?: string): string | undefined {
  if (!isCliAccountProvider(provider)) return undefined;
  const slots = settings.accountSlots?.[provider] || [];
  const hit = slots.find((s) => s.id === (slotId || 'slot-1'));
  return hit?.label || (slotId ? `Account (${slotId})` : 'Account 1 (Default)');
}

function settingsForRoute(settings: AppSettings, route: AgentRouteConfig): AppSettings {
  return {
    ...settings,
    provider: route.provider,
    ollamaModel: route.provider === 'ollama' ? route.model || settings.ollamaModel : settings.ollamaModel,
    geminiModel: route.provider === 'gemini_api' ? route.model || settings.geminiModel : settings.geminiModel,
    openaiModel:
      route.provider === 'openai_compatible' ? route.model || settings.openaiModel : settings.openaiModel,
  };
}

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

function buildCliOrchestratorPlanningPrompt(params: {
  session: ChatSession;
  prompt: string;
  settings: AppSettings;
}): string {
  const { session, prompt, settings } = params;
  const userName = settings.userName?.trim() || os.userInfo().username;
  const fileRoute = resolveAgentRoute('file', settings);
  const sysRoute = resolveAgentRoute('system', settings);
  const browserRoute = resolveAgentRoute('browser', settings);

  const priorMessages = session.messages
    .filter((m) => (!m.kind || m.kind === 'message') && m.content.trim())
    .slice(-6, -1);

  const historyBlock = priorMessages.length
    ? `\n[Recent Conversation]\n${priorMessages
        .map((m) => `${m.role === 'user' ? userName : 'Assistant'}: ${m.content.slice(0, 500)}`)
        .join('\n')}\n[End Recent Conversation]\n`
    : '';

  return `You are Nexus Agent (Orchestrator) in Nexus Agent OS on Windows.
User: ${userName}
Default Workspace: ${settings.defaultWorkspace}
Language rule: If user writes in Khmer or Romanized Khmer, respond in clear Khmer + simple English technical terms; otherwise match user's language.

You manage 3 Specialist Agents that run on their own separate accounts & models:
- "file" (File Agent · ${fileRoute.provider}/${fileRoute.slotId || 'api'} · ${fileRoute.model}): inspect/list/search/read/create/edit files & folders on this laptop.
- "system" (System Agent · ${sysRoute.provider}/${sysRoute.slotId || 'api'} · ${sysRoute.model}): PowerShell commands, CPU/RAM/disk/process checks, apps, screenshots.
- "browser" (Browser Agent · ${browserRoute.provider}/${browserRoute.slotId || 'api'} · ${browserRoute.model}): live web search, fetch web pages, URLs.

DECISION RULE:
1. If the user's request is a simple greeting, general question, or conceptual answer that does NOT need laptop files, PowerShell/system checks, or live web browsing — reply directly in plain text.
2. If the user's request asks to inspect/read/edit/list files or folders, run commands/system diagnostics, browse the web, OR explicitly mentions File Agent / System Agent / Browser Agent:
   DO NOT run tools yourself. Output ONLY a single fenced JSON block with tag \`nexus_delegate\` so Nexus Agent OS runs the assigned specialist(s) under their own accounts:

\`\`\`nexus_delegate
{
  "plan": [
    { "title": "Short step title", "agent": "file", "detail": "What specialist will do" }
  ],
  "delegations": [
    { "agent": "file", "task": "Concrete, self-contained instruction including relevant path/workspace" }
  ]
}
\`\`\`

Valid delegation agents are ONLY: "file", "system", "browser".${historyBlock}
Current user request:
${prompt}`;
}

/**
 * Safely extracts and validates a `nexus_delegate` JSON block from Orchestrator output.
 * Amendment 3: If missing or invalid JSON, returns null so Orchestrator output is treated as a direct reply (never fails the mission).
 */
export function parseNexusDelegation(rawText: string): ParsedDelegation | null {
  try {
    const fenced = rawText.match(/```nexus_delegate\s*([\s\S]*?)```/i);
    if (!fenced || !fenced[1]) return null;
    const parsed = JSON.parse(fenced[1].trim()) as {
      plan?: Array<{ title?: unknown; agent?: unknown; detail?: unknown }>;
      delegations?: Array<{ agent?: unknown; task?: unknown }>;
    };
    if (!parsed || !Array.isArray(parsed.delegations)) return null;

    const validSpecs = new Set(['file', 'system', 'browser']);
    const delegations = parsed.delegations
      .filter(
        (d) =>
          d &&
          typeof d.agent === 'string' &&
          validSpecs.has(d.agent) &&
          typeof d.task === 'string' &&
          d.task.trim().length > 0,
      )
      .map((d) => ({
        agent: d.agent as Exclude<AgentId, 'orchestrator'>,
        task: String(d.task).trim(),
      }));

    if (delegations.length === 0) return null;

    const plan = Array.isArray(parsed.plan)
      ? parsed.plan.map((p) => {
          const a = String(p?.agent || 'orchestrator');
          const validAgent: AgentId =
            a === 'file' || a === 'system' || a === 'browser' ? a : 'orchestrator';
          return {
            title: String(p?.title || 'Step'),
            agent: validAgent,
            detail: String(p?.detail || ''),
          };
        })
      : undefined;

    return { plan, delegations };
  } catch {
    return null;
  }
}

function mergeUsage(a?: TokenUsageStats, b?: TokenUsageStats): TokenUsageStats | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    contextWindow: Math.max(a.contextWindow, b.contextWindow),
    estimated: Boolean(a.estimated || b.estimated),
  };
}

function summarizeArgs(args: Record<string, unknown>): string {
  const raw = JSON.stringify(args);
  return raw.length > 220 ? `${raw.slice(0, 220)}…` : raw;
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

  private resetAgentStates(preserveErrors?: Set<AgentId>): void {
    (['orchestrator', 'file', 'system', 'browser'] as AgentId[]).forEach((agent) => {
      if (preserveErrors?.has(agent)) return;
      this.emit({ type: 'agent_state', agent, state: 'idle' });
    });
  }

  private async runSpecialistOnAssignedRoute(params: {
    session: ChatSession;
    agent: Exclude<AgentId, 'orchestrator'>;
    task: string;
    extraContext?: string;
    settings: AppSettings;
    artifacts: RunArtifacts;
    signal: AbortSignal;
    streamToChat?: boolean;
  }): Promise<{ report: string; usage?: TokenUsageStats; errorObj?: AgentSlotError; route: AgentRouteConfig; slotLabel?: string; modelUsed: string }> {
    const { session, agent, task, extraContext, settings, artifacts, signal, streamToChat = false } = params;
    const route = resolveAgentRoute(agent, settings);
    const slotLabel = resolveSlotLabelFromSettings(settings, route.provider, route.slotId);

    const promptText = extraContext
      ? `Task from Orchestrator:\n${task}\n\nAdditional Context:\n${extraContext}`
      : `Task from Orchestrator:\n${task}`;

    if (isCliAccountProvider(route.provider)) {
      const specialistPrompt = `${buildSpecialistPrompt(agent, settings)}\n\n${promptText}`;
      const cliOut = await runCliProviderMission({
        session,
        prompt: promptText,
        target: agent,
        agentId: agent,
        route,
        settings,
        customPrompt: specialistPrompt,
        planningOnly: false,
        streamToChat,
        emit: this.emit,
        signal,
      });

      if (cliOut.toolTraces.length) {
        artifacts.toolTraces.push(...cliOut.toolTraces);
      }

      if (cliOut.needsAttention) {
        const errObj: AgentSlotError = {
          agent,
          provider: cliOut.provider,
          slotId: cliOut.slotId,
          slotLabel: cliOut.slotLabel,
          model: cliOut.modelUsed,
          reason: cliOut.needsAttention.reason,
          message: cliOut.needsAttention.message,
          action: cliOut.needsAttention.action,
        };
        return {
          report: `[${agent.toUpperCase()} AGENT ${cliOut.needsAttention.reason.toUpperCase()}] ${cliOut.needsAttention.message}`,
          usage: cliOut.usage,
          errorObj: errObj,
          route,
          slotLabel: cliOut.slotLabel,
          modelUsed: cliOut.modelUsed,
        };
      }

      return {
        report: cliOut.text,
        usage: cliOut.usage,
        route,
        slotLabel: cliOut.slotLabel,
        modelUsed: cliOut.modelUsed,
      };
    }

    // Native API-key / Ollama specialist tool-calling loop
    const effectiveSettings = settingsForRoute(settings, route);
    const text = await this.runSpecialistLoop({
      sessionId: session.id,
      agent,
      taskMessages: [{ role: 'user', text: promptText }],
      settings: effectiveSettings,
      artifacts,
      signal,
    });
    return {
      report: text,
      route,
      slotLabel,
      modelUsed: route.model,
    };
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
      agentErrors: [],
    };
    const erroredAgents = new Set<AgentId>();

    this.emit({ type: 'run_started', sessionId: session.id, runId, target });

    const responderAgent: AgentId = target === 'auto' ? 'orchestrator' : target;
    const primaryRoute = resolveAgentRoute(responderAgent, settings);
    const primarySlotLabel = resolveSlotLabelFromSettings(settings, primaryRoute.provider, primaryRoute.slotId);

    try {
      // -----------------------------------------------------------------------
      // Case 1: User targeted a specialist directly (file / system / browser)
      // -----------------------------------------------------------------------
      if (target !== 'auto' && target !== 'orchestrator') {
        if (isCliAccountProvider(primaryRoute.provider)) {
          const cliResult = await runCliProviderMission({
            session,
            prompt,
            target,
            agentId: target,
            route: primaryRoute,
            settings,
            streamToChat: true,
            emit: this.emit,
            signal: controller.signal,
          });

          if (cliResult.needsAttention) {
            erroredAgents.add(target);
            this.emit({
              type: 'agent_state',
              agent: target,
              state: 'error',
              detail: cliResult.needsAttention.reason === 'quota_exceeded' ? 'Quota reached' : 'Needs sign-in',
            });
            const attnMsg: ChatMessage = {
              id: randomUUID(),
              role: 'assistant',
              kind: 'needs_attention',
              agent: target,
              provider: cliResult.provider,
              slotId: cliResult.slotId,
              slotLabel: cliResult.slotLabel,
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
            agent: target,
            provider: cliResult.provider,
            slotId: cliResult.slotId,
            slotLabel: cliResult.slotLabel,
            model: cliResult.modelUsed,
            content: cliResult.text,
            createdAt: new Date().toISOString(),
            toolTraces: cliResult.toolTraces.length ? cliResult.toolTraces : undefined,
            usage: cliResult.usage,
          };
          this.emit({ type: 'agent_state', agent: target, state: 'done' });
          this.emit({ type: 'run_finished', sessionId: session.id, runId, message: assistantMessage });
          return assistantMessage;
        }

        // Direct specialist via API / Ollama
        const effectiveSettings = settingsForRoute(settings, primaryRoute);
        const historyContext: LlmMessage[] = session.messages
          .filter((m) => (!m.kind || m.kind === 'message') && m.content.trim())
          .slice(-9, -1)
          .map((m) => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            text: m.content,
          }));
        historyContext.push({ role: 'user', text: prompt });

        const finalContent = await this.runSpecialistLoop({
          sessionId: session.id,
          agent: target,
          taskMessages: historyContext,
          settings: effectiveSettings,
          artifacts,
          signal: controller.signal,
        });

        const assistantMessage: ChatMessage = {
          id: randomUUID(),
          role: 'assistant',
          kind: 'message',
          agent: target,
          provider: primaryRoute.provider,
          model: primaryRoute.model,
          content: finalContent || 'Mission completed.',
          createdAt: new Date().toISOString(),
          toolTraces: artifacts.toolTraces.length ? artifacts.toolTraces : undefined,
          screenshots: artifacts.screenshots.length ? artifacts.screenshots : undefined,
        };
        this.emit({ type: 'run_finished', sessionId: session.id, runId, message: assistantMessage });
        return assistantMessage;
      }

      // -----------------------------------------------------------------------
      // Case 2: Orchestrator mode (auto / orchestrator) on CLI account engine
      // -----------------------------------------------------------------------
      if (isCliAccountProvider(primaryRoute.provider)) {
        const planPrompt = buildCliOrchestratorPlanningPrompt({ session, prompt, settings });
        this.emit({
          type: 'assistant_note',
          sessionId: session.id,
          agent: 'orchestrator',
          text: `Orchestrator (${primaryRoute.provider} · ${primarySlotLabel || primaryRoute.slotId}) planning...`,
        });

        const planTurn: CliRunOutput = await runCliProviderMission({
          session,
          prompt,
          target: 'orchestrator',
          agentId: 'orchestrator',
          route: primaryRoute,
          settings,
          customPrompt: planPrompt,
          planningOnly: true,
          streamToChat: false,
          emit: this.emit,
          signal: controller.signal,
        });

        if (planTurn.needsAttention) {
          erroredAgents.add('orchestrator');
          this.emit({
            type: 'agent_state',
            agent: 'orchestrator',
            state: 'error',
            detail: planTurn.needsAttention.reason === 'quota_exceeded' ? 'Quota reached' : 'Needs sign-in',
          });
          const attnMsg: ChatMessage = {
            id: randomUUID(),
            role: 'assistant',
            kind: 'needs_attention',
            agent: 'orchestrator',
            provider: planTurn.provider,
            slotId: planTurn.slotId,
            slotLabel: planTurn.slotLabel,
            model: planTurn.modelUsed,
            content: planTurn.needsAttention.message,
            actionCta: planTurn.needsAttention.action,
            createdAt: new Date().toISOString(),
          };
          this.emit({ type: 'run_finished', sessionId: session.id, runId, message: attnMsg });
          return attnMsg;
        }

        if (planTurn.toolTraces.length) {
          artifacts.toolTraces.push(...planTurn.toolTraces);
        }

        // Amendment 3: If nexus_delegate block is missing or fails to parse, treat output as direct reply!
        const parsedDelegation = parseNexusDelegation(planTurn.text);
        if (!parsedDelegation) {
          const directMsg: ChatMessage = {
            id: randomUUID(),
            role: 'assistant',
            kind: 'message',
            agent: 'orchestrator',
            provider: planTurn.provider,
            slotId: planTurn.slotId,
            slotLabel: planTurn.slotLabel,
            model: planTurn.modelUsed,
            content: planTurn.text,
            createdAt: new Date().toISOString(),
            toolTraces: artifacts.toolTraces.length ? artifacts.toolTraces : undefined,
            usage: planTurn.usage,
          };
          this.emit({ type: 'agent_state', agent: 'orchestrator', state: 'done' });
          this.emit({ type: 'run_finished', sessionId: session.id, runId, message: directMsg });
          return directMsg;
        }

        // Publish plan steps
        artifacts.plan = (
          parsedDelegation.plan && parsedDelegation.plan.length > 0
            ? parsedDelegation.plan
            : parsedDelegation.delegations.map((d) => ({
                title: `Run ${d.agent} agent`,
                agent: d.agent as AgentId,
                detail: d.task.slice(0, 120),
              }))
        ).map((s) => ({
          id: randomUUID(),
          title: s.title,
          agent: s.agent,
          detail: s.detail,
          status: 'pending' as const,
        }));
        this.emit({ type: 'plan_updated', sessionId: session.id, steps: [...artifacts.plan] });

        let totalUsage = planTurn.usage;
        const specialistReports: string[] = [];

        // Execute delegated specialists sequentially as a staged pipeline
        // (Forwarding context from completed specialists so dependent steps like
        // File Agent -> System Agent have confirmed paths, reports, and findings)
        for (const del of parsedDelegation.delegations) {
          const specRoute = resolveAgentRoute(del.agent, settings);
          const specSlotLabel = resolveSlotLabelFromSettings(settings, specRoute.provider, specRoute.slotId);

          let enrichedTask = del.task;
          if (specialistReports.length > 0) {
            enrichedTask += `\n\n[Findings & Context from Previous Specialist Agent(s)]:\n` + specialistReports.join('\n\n---\n\n');
          }

          const handoff: AgentHandoff = {
            id: randomUUID(),
            from: 'orchestrator',
            to: del.agent,
            task: del.task,
            status: 'running',
            provider: specRoute.provider,
            slotId: specRoute.slotId,
            slotLabel: specSlotLabel,
            model: specRoute.model,
            startedAt: new Date().toISOString(),
          };
          artifacts.handoffs.push(handoff);
          this.emit({ type: 'handoff_event', sessionId: session.id, handoff });

          const planStep = artifacts.plan.find((s) => s.agent === del.agent && s.status === 'pending');
          if (planStep) {
            planStep.status = 'in_progress';
            this.emit({ type: 'plan_updated', sessionId: session.id, steps: [...artifacts.plan] });
          }

          try {
            const out = await this.runSpecialistOnAssignedRoute({
              session,
              agent: del.agent,
              task: enrichedTask,
              settings,
              artifacts,
              signal: controller.signal,
              streamToChat: false,
            });

            handoff.model = out.modelUsed;
            if (out.slotLabel) handoff.slotLabel = out.slotLabel;

            if (out.errorObj) {
              erroredAgents.add(del.agent);
              artifacts.agentErrors.push(out.errorObj);
              handoff.status = 'error';
              handoff.summary = out.errorObj.message.slice(0, 260);
              handoff.errorAction = out.errorObj.action;
              handoff.finishedAt = new Date().toISOString();
              this.emit({ type: 'handoff_event', sessionId: session.id, handoff });
              this.emit({
                type: 'agent_state',
                agent: del.agent,
                state: 'error',
                detail: out.errorObj.reason === 'quota_exceeded' ? 'Quota reached' : 'Needs sign-in',
              });
              if (planStep) {
                planStep.status = 'failed';
                this.emit({ type: 'plan_updated', sessionId: session.id, steps: [...artifacts.plan] });
              }
              specialistReports.push(
                `[${del.agent.toUpperCase()} AGENT ERROR (${specRoute.provider}/${specSlotLabel || specRoute.slotId || 'api'})]\n${out.errorObj.message}`,
              );
              totalUsage = mergeUsage(totalUsage, out.usage);
              continue;
            }

            handoff.status = 'completed';
            handoff.summary = out.report.slice(0, 320);
            handoff.finishedAt = new Date().toISOString();
            this.emit({ type: 'handoff_event', sessionId: session.id, handoff });
            this.emit({ type: 'agent_state', agent: del.agent, state: 'done' });
            if (planStep) {
              planStep.status = 'completed';
              this.emit({ type: 'plan_updated', sessionId: session.id, steps: [...artifacts.plan] });
            }
            specialistReports.push(
              `[${del.agent.toUpperCase()} AGENT REPORT (${specRoute.provider} · ${out.slotLabel || 'default'} · ${out.modelUsed})]\n${out.report}`,
            );
            totalUsage = mergeUsage(totalUsage, out.usage);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            erroredAgents.add(del.agent);
            const errObj: AgentSlotError = {
              agent: del.agent,
              provider: specRoute.provider,
              slotId: specRoute.slotId,
              slotLabel: specSlotLabel,
              model: specRoute.model,
              reason: 'error',
              message: msg,
              action: {
                type: isCliAccountProvider(specRoute.provider) ? 'login' : 'open_settings',
                provider: specRoute.provider,
                slotId: specRoute.slotId,
                slotLabel: specSlotLabel,
                agent: del.agent,
                reason: 'error',
                label: isCliAccountProvider(specRoute.provider)
                  ? `Check ${specRoute.provider} (${specSlotLabel || specRoute.slotId})`
                  : 'Open AI Settings',
              },
            };
            artifacts.agentErrors.push(errObj);
            handoff.status = 'error';
            handoff.summary = msg.slice(0, 260);
            handoff.errorAction = errObj.action;
            handoff.finishedAt = new Date().toISOString();
            this.emit({ type: 'handoff_event', sessionId: session.id, handoff });
            this.emit({ type: 'agent_state', agent: del.agent, state: 'error', detail: 'Error' });
            if (planStep) {
              planStep.status = 'failed';
              this.emit({ type: 'plan_updated', sessionId: session.id, steps: [...artifacts.plan] });
            }
            specialistReports.push(`[${del.agent.toUpperCase()} AGENT ERROR]\n${msg}`);
          }
        }

        // Hop 3: Orchestrator synthesizes final response on its own account/slot
        const synthesisPrompt = `You are Nexus Agent (Orchestrator).
The user asked:
${prompt}

Your specialist agents executed the task under their assigned accounts and returned these reports:
${specialistReports.join('\n\n---\n\n')}

Write a clear, concise final answer for the user based on the specialist report(s). If any specialist failed with an account/quota error, mention that briefly while still summarizing any successful specialist results. Match the user's language (Khmer + simple English technical terms if user wrote Khmer/Romanized Khmer). Do NOT output any nexus_delegate JSON block.`;

        let finalContent = '';
        try {
          const synthTurn = await runCliProviderMission({
            session,
            prompt,
            target: 'orchestrator',
            agentId: 'orchestrator',
            route: primaryRoute,
            settings,
            customPrompt: synthesisPrompt,
            planningOnly: true,
            streamToChat: true,
            emit: this.emit,
            signal: controller.signal,
          });
          totalUsage = mergeUsage(totalUsage, synthTurn.usage);
          finalContent = synthTurn.text || specialistReports.join('\n\n');
        } catch {
          // Graceful fallback: return specialist reports directly if synthesis hop fails
          finalContent = specialistReports.join('\n\n');
        }

        artifacts.plan.forEach((p) => {
          if (p.agent === 'orchestrator' && p.status !== 'completed') {
            p.status = 'completed';
          }
        });
        if (artifacts.plan.length) {
          this.emit({ type: 'plan_updated', sessionId: session.id, steps: [...artifacts.plan] });
        }

        const assistantMessage: ChatMessage = {
          id: randomUUID(),
          role: 'assistant',
          kind: 'message',
          agent: 'orchestrator',
          provider: planTurn.provider,
          slotId: planTurn.slotId,
          slotLabel: planTurn.slotLabel,
          model: planTurn.modelUsed,
          content: finalContent || 'Mission completed.',
          createdAt: new Date().toISOString(),
          plan: artifacts.plan.length ? artifacts.plan : undefined,
          handoffs: artifacts.handoffs.length ? artifacts.handoffs : undefined,
          toolTraces: artifacts.toolTraces.length ? artifacts.toolTraces : undefined,
          screenshots: artifacts.screenshots.length ? artifacts.screenshots : undefined,
          agentErrors: artifacts.agentErrors.length ? artifacts.agentErrors : undefined,
          usage: totalUsage,
        };

        this.emit({ type: 'agent_state', agent: 'orchestrator', state: 'done' });
        this.emit({ type: 'run_finished', sessionId: session.id, runId, message: assistantMessage });
        return assistantMessage;
      }

      // -----------------------------------------------------------------------
      // Case 3: Orchestrator on Native Local AI (Ollama) or API-key fallback
      // -----------------------------------------------------------------------
      const effectiveSettings = settingsForRoute(settings, primaryRoute);
      const historyContext: LlmMessage[] = session.messages
        .filter((m) => (!m.kind || m.kind === 'message') && m.content.trim())
        .slice(-9, -1)
        .map((m) => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          text: m.content,
        }));
      historyContext.push({ role: 'user', text: prompt });

      const finalContent = await this.runOrchestratorLoop({
        session,
        messages: historyContext,
        settings: effectiveSettings,
        fullSettings: settings,
        artifacts,
        erroredAgents,
        signal: controller.signal,
      });

      const estimatedInput = Math.ceil(
        historyContext.reduce((acc, m) => acc + (m.text?.length || 0), 0) / 4,
      );
      const usage: TokenUsageStats = {
        inputTokens: estimatedInput,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: Math.max(1, Math.ceil(finalContent.length / 4)),
        contextWindow: primaryRoute.provider === 'ollama' ? 32_768 : 128_000,
        estimated: true,
      };

      const assistantMessage: ChatMessage = {
        id: randomUUID(),
        role: 'assistant',
        kind: 'message',
        agent: responderAgent,
        provider: primaryRoute.provider,
        model: primaryRoute.model,
        content: finalContent || 'Mission completed.',
        createdAt: new Date().toISOString(),
        plan: artifacts.plan.length ? artifacts.plan : undefined,
        handoffs: artifacts.handoffs.length ? artifacts.handoffs : undefined,
        toolTraces: artifacts.toolTraces.length ? artifacts.toolTraces : undefined,
        screenshots: artifacts.screenshots.length ? artifacts.screenshots : undefined,
        agentErrors: artifacts.agentErrors.length ? artifacts.agentErrors : undefined,
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
        primaryRoute.provider === 'ollama' && /fetch failed|ECONNREFUSED|not reachable|Ollama/i.test(errorMsg);

      const failedMessage: ChatMessage = {
        id: randomUUID(),
        role: 'assistant',
        kind: isOllamaDown ? 'needs_attention' : 'message',
        agent: responderAgent,
        provider: primaryRoute.provider,
        slotId: primaryRoute.slotId,
        slotLabel: primarySlotLabel,
        model: primaryRoute.model,
        content: isOllamaDown
          ? 'Local AI (Ollama) is not running right now. Start Ollama locally to chat offline for free.'
          : errorMsg,
        error: isOllamaDown ? undefined : errorMsg,
        actionCta: isOllamaDown
          ? {
              type: 'start_ollama',
              provider: 'ollama',
              agent: responderAgent,
              label: 'Start Local AI (Ollama)',
            }
          : undefined,
        createdAt: new Date().toISOString(),
        plan: artifacts.plan.length ? artifacts.plan : undefined,
        handoffs: artifacts.handoffs.length ? artifacts.handoffs : undefined,
        toolTraces: artifacts.toolTraces.length ? artifacts.toolTraces : undefined,
        screenshots: artifacts.screenshots.length ? artifacts.screenshots : undefined,
        agentErrors: artifacts.agentErrors.length ? artifacts.agentErrors : undefined,
      };

      this.emit({ type: 'run_finished', sessionId: session.id, runId, message: failedMessage });
      return failedMessage;
    } finally {
      this.activeRuns.delete(session.id);
      this.resetAgentStates(erroredAgents);
    }
  }

  private async runOrchestratorLoop(params: {
    session: ChatSession;
    messages: LlmMessage[];
    settings: AppSettings;
    fullSettings: AppSettings;
    artifacts: RunArtifacts;
    erroredAgents: Set<AgentId>;
    signal: AbortSignal;
  }): Promise<string> {
    const { session, settings, fullSettings, artifacts, erroredAgents, signal } = params;
    const sessionId = session.id;
    const conversation: LlmMessage[] = [...params.messages];

    const delegateSingle = async (
      to: Exclude<AgentId, 'orchestrator'>,
      task: string,
      extraContext?: string,
    ): Promise<string> => {
      const specRoute = resolveAgentRoute(to, fullSettings);
      const specSlotLabel = resolveSlotLabelFromSettings(fullSettings, specRoute.provider, specRoute.slotId);
      const handoff: AgentHandoff = {
        id: randomUUID(),
        from: 'orchestrator',
        to,
        task,
        status: 'running',
        provider: specRoute.provider,
        slotId: specRoute.slotId,
        slotLabel: specSlotLabel,
        model: specRoute.model,
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
        const out = await this.runSpecialistOnAssignedRoute({
          session,
          agent: to,
          task,
          extraContext,
          settings: fullSettings,
          artifacts,
          signal,
        });

        handoff.model = out.modelUsed;
        if (out.slotLabel) handoff.slotLabel = out.slotLabel;

        if (out.errorObj) {
          erroredAgents.add(to);
          artifacts.agentErrors.push(out.errorObj);
          handoff.status = 'error';
          handoff.summary = out.errorObj.message.slice(0, 260);
          handoff.errorAction = out.errorObj.action;
          handoff.finishedAt = new Date().toISOString();
          this.emit({ type: 'handoff_event', sessionId, handoff });
          this.emit({ type: 'agent_state', agent: to, state: 'error', detail: out.errorObj.reason });
          if (planStep) {
            planStep.status = 'failed';
            this.emit({ type: 'plan_updated', sessionId, steps: [...artifacts.plan] });
          }
          return `[${to.toUpperCase()} AGENT ERROR]\n${out.errorObj.message}`;
        }

        handoff.status = 'completed';
        handoff.summary = out.report.slice(0, 320);
        handoff.finishedAt = new Date().toISOString();
        this.emit({ type: 'handoff_event', sessionId, handoff });

        if (planStep) {
          planStep.status = 'completed';
          this.emit({ type: 'plan_updated', sessionId, steps: [...artifacts.plan] });
        }

        return `[${to.toUpperCase()} AGENT REPORT]\n${out.report}`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        erroredAgents.add(to);
        handoff.status = 'error';
        handoff.summary = msg;
        handoff.finishedAt = new Date().toISOString();
        this.emit({ type: 'handoff_event', sessionId, handoff });
        this.emit({ type: 'agent_state', agent: to, state: 'error', detail: 'Error' });
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
          const errText = err instanceof Error ? err.message : String(err);
          trace.status = 'error';
          trace.error = errText;
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
            summary: errText.slice(0, 140),
          };
          await appendAuditLog(entry);
          this.emit({ type: 'audit_entry', entry });

          conversation.push({
            role: 'tool',
            toolCallId: tc.id,
            toolName: tc.name,
            text: `TOOL ERROR: ${errText}`,
          });
        }
      }
    }

    this.emit({ type: 'agent_state', agent, state: 'done' });
    return 'Specialist reached maximum steps.';
  }
}
