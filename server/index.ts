import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import {
  AGENT_ROSTER,
  type ChatMessage,
  type ProviderType,
  type ServerWsEvent,
  type TargetMode,
} from '../shared/types.js';
import {
  appendSessionSystemMessage,
  createSession,
  deleteCustomPreset,
  deleteSession,
  getOrCreateSession,
  getStorageStats,
  loadAuditLogs,
  loadPresets,
  loadSessions,
  loadSettings,
  saveCustomPreset,
  saveSettings,
  togglePinMessage,
  updateSession,
} from './store/storage.js';
import { PermissionGate } from './security/permissions.js';
import { MultiAgentRunner } from './agents/orchestrator.js';
import { captureDesktopScreenshot, collectSystemTelemetry } from './tools/systemTools.js';
import { listOllamaModels, testProviderConnection } from './llm/client.js';
import {
  getAllProviderStatuses,
  invalidateProviderCache,
  triggerProviderLogin,
  triggerProviderLogout,
} from './llm/providerRegistry.js';
import { disposeAllWarmWorkers, disposeWarmWorkersForSession } from './llm/cliRunner.js';

const PORT = Number(process.env.NEXUS_PORT || 4310);
const SERVE_STATIC = process.env.NEXUS_SERVE_STATIC === '1';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(event: ServerWsEvent): void {
  const payload = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

wss.on('connection', (socket) => {
  const welcome: ServerWsEvent = {
    type: 'connected',
    timestamp: new Date().toISOString(),
  };
  socket.send(JSON.stringify(welcome));
});

const permissions = new PermissionGate({
  onApprovalRequired: (approval) => {
    broadcast({ type: 'approval_required', approval });
  },
  onApprovalResolved: (approvalId, approved) => {
    broadcast({ type: 'approval_resolved', approvalId, approved });
  },
});

const runner = new MultiAgentRunner({
  emit: broadcast,
  permissions,
});

// Health & Meta
app.get('/api/health', async (_req, res) => {
  const settings = await loadSettings();
  res.json({
    ok: true,
    name: 'Nexus Agent OS',
    version: '2.0.0',
    provider: settings.provider,
    safetyMode: settings.safetyMode,
    pendingApprovals: permissions.listPending().length,
  });
});

app.get('/api/agents', (_req, res) => {
  res.json({ agents: AGENT_ROSTER });
});

// Account-based AI Providers (Claude Code, Codex, Gemini Antigravity, Local AI)
app.get('/api/providers/status', async (req, res) => {
  try {
    const force = req.query.refresh === '1';
    const settings = await loadSettings();
    const providers = await getAllProviderStatuses(settings, force);
    res.json({ providers });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to inspect providers' });
  }
});

app.post('/api/providers/:id/login', async (req, res) => {
  const providerSchema = z.enum(['gemini_agy', 'codex', 'claude', 'ollama']);
  const parsed = providerSchema.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({ ok: false, message: 'Unsupported provider for CLI login.' });
    return;
  }
  const settings = await loadSettings();
  const result = await triggerProviderLogin(parsed.data as ProviderType, settings);
  const refreshedSettings = await loadSettings();
  const providers = await getAllProviderStatuses(refreshedSettings, true);
  res.json({ ...result, providers });
});

app.post('/api/providers/:id/logout', async (req, res) => {
  const providerSchema = z.enum(['gemini_agy', 'codex', 'claude', 'ollama']);
  const parsed = providerSchema.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({ ok: false, message: 'Unsupported provider for logout.' });
    return;
  }
  if (parsed.data === 'gemini_agy') {
    disposeAllWarmWorkers();
  }
  const settings = await loadSettings();
  const result = await triggerProviderLogout(parsed.data as ProviderType, settings);
  const refreshedSettings = await loadSettings();
  const providers = await getAllProviderStatuses(refreshedSettings, true);
  res.json({ ...result, providers });
});

app.post('/api/providers/refresh', async (_req, res) => {
  invalidateProviderCache();
  const settings = await loadSettings();
  const providers = await getAllProviderStatuses(settings, true);
  res.json({ ok: true, providers });
});

// Settings
app.get('/api/settings', async (_req, res) => {
  const settings = await loadSettings();
  res.json({ settings });
});

app.put('/api/settings', async (req, res) => {
  try {
    const schema = z.object({
      provider: z
        .enum(['gemini_agy', 'codex', 'claude', 'ollama', 'gemini_api', 'openai_compatible'])
        .optional(),
      effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
      selectedModels: z.record(z.string()).optional(),
      userName: z.string().max(60).optional(),
      language: z.enum(['en', 'km']).optional(),
      theme: z
        .enum(['midnight', 'angkor', 'tonle_sap', 'royal_lacquer', 'forest', 'sakura', 'sunset', 'cyberpunk'])
        .optional(),
      glassOpacity: z.number().min(72).max(100).optional(),
      textSize: z.enum(['small', 'default', 'large']).optional(),
      safetyMode: z.enum(['read_only', 'smart', 'safe', 'full_auto']).optional(),
      defaultWorkspace: z.string().optional(),
      maxToolSteps: z.number().int().min(2).max(20).optional(),
      ollamaBaseUrl: z.string().optional(),
      ollamaModel: z.string().optional(),
      geminiApiKey: z.string().optional(),
      geminiModel: z.string().optional(),
      openaiBaseUrl: z.string().optional(),
      openaiApiKey: z.string().optional(),
      openaiModel: z.string().optional(),
    });
    const parsed = schema.parse(req.body);
    const settings = await saveSettings(parsed);
    res.json({ settings });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid settings' });
  }
});

app.post('/api/settings/test', async (req, res) => {
  const current = await loadSettings();
  const merged = { ...current, ...(req.body || {}) };
  if (merged.provider === 'gemini_agy' || merged.provider === 'codex' || merged.provider === 'claude') {
    const statuses = await getAllProviderStatuses(merged, true);
    const hit = statuses.find((s) => s.id === merged.provider);
    res.json({
      ok: Boolean(hit?.signedIn),
      message: hit?.signedIn
        ? `${hit.name} signed in (${hit.models.length} models ready).`
        : hit?.error || `${merged.provider} is not signed in.`,
    });
    return;
  }
  const result = await testProviderConnection(merged);
  res.json(result);
});

app.get('/api/ollama/models', async (_req, res) => {
  try {
    const settings = await loadSettings();
    const models = await listOllamaModels(settings.ollamaBaseUrl);
    res.json({ ok: true, models });
  } catch (err) {
    res.json({ ok: false, models: [], error: err instanceof Error ? err.message : 'Ollama unreachable' });
  }
});

// Sessions
app.get('/api/sessions', async (_req, res) => {
  const sessions = await loadSessions();
  res.json({ sessions });
});

app.post('/api/sessions', async (req, res) => {
  const title = typeof req.body?.title === 'string' ? req.body.title : 'New Mission';
  const session = await createSession(title);
  res.json({ session });
});

app.post('/api/sessions/:id/handoff', async (req, res) => {
  const schema = z.object({
    fromProvider: z.string().min(1),
    toProvider: z.string().min(1),
    text: z.string().min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid handoff divider payload' });
    return;
  }
  const msg: ChatMessage = {
    id: randomUUID(),
    role: 'system',
    kind: 'handoff_divider',
    content: parsed.data.text,
    createdAt: new Date().toISOString(),
  };
  const updated = await appendSessionSystemMessage(req.params.id, msg);
  if (!updated) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json({ session: updated, message: msg });
});

app.post('/api/sessions/:id/pin', async (req, res) => {
  const messageId = String(req.body?.messageId || '');
  if (!messageId) {
    res.status(400).json({ error: 'messageId required' });
    return;
  }
  const updated = await togglePinMessage(req.params.id, messageId);
  if (!updated) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json({ session: updated });
});

app.delete('/api/sessions/:id', async (req, res) => {
  runner.stopRun(req.params.id);
  disposeWarmWorkersForSession(req.params.id);
  await deleteSession(req.params.id);
  res.json({ ok: true });
});

// Presets
app.get('/api/presets', async (_req, res) => {
  const presets = await loadPresets();
  res.json({ presets });
});

app.post('/api/presets', async (req, res) => {
  try {
    const schema = z.object({
      name: z.string().min(2).max(80),
      khmerLabel: z.string().max(100).default(''),
      description: z.string().max(260).default(''),
      target: z.enum(['auto', 'orchestrator', 'file', 'system', 'browser']).default('auto'),
      prompt: z.string().min(3),
      agentsInvolved: z
        .array(z.enum(['orchestrator', 'file', 'system', 'browser']))
        .default(['orchestrator']),
    });
    const parsed = schema.parse(req.body);
    const preset = await saveCustomPreset(parsed);
    res.json({ preset });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid preset' });
  }
});

app.delete('/api/presets/:id', async (req, res) => {
  await deleteCustomPreset(req.params.id);
  res.json({ ok: true });
});

// Run Multi-Agent Mission
app.post('/api/chat/run', async (req, res) => {
  try {
    const schema = z.object({
      sessionId: z.string().optional(),
      prompt: z.string().min(1),
      target: z.enum(['auto', 'orchestrator', 'file', 'system', 'browser']).default('auto'),
    });
    const { sessionId, prompt, target } = schema.parse(req.body);
    const session = await getOrCreateSession(sessionId);

    if (runner.isRunning(session.id)) {
      res.status(409).json({ error: 'A mission is already running in this session.' });
      return;
    }

    const userMsg: ChatMessage = {
      id: randomUUID(),
      role: 'user',
      kind: 'message',
      content: prompt.trim(),
      createdAt: new Date().toISOString(),
    };

    const realUserCount = session.messages.filter((m) => m.role === 'user').length;
    if (realUserCount === 0) {
      session.title = prompt.trim().slice(0, 48);
    }
    session.messages.push(userMsg);
    await updateSession(session);

    const settings = await loadSettings();

    res.json({
      accepted: true,
      sessionId: session.id,
      userMessage: userMsg,
    });

    void runner
      .runMission({
        session,
        prompt: prompt.trim(),
        target: target as TargetMode,
        settings,
      })
      .then(async (assistantMessage) => {
        session.messages.push(assistantMessage);
        await updateSession(session);
      });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Bad request' });
  }
});

app.post('/api/chat/stop', (req, res) => {
  const sessionId = String(req.body?.sessionId || '');
  const stopped = runner.stopRun(sessionId);
  res.json({ ok: stopped });
});

// Permissions & Approvals
app.get('/api/approvals', (_req, res) => {
  res.json({ approvals: permissions.listPending() });
});

app.post('/api/approvals/:id', (req, res) => {
  const approved = Boolean(req.body?.approved);
  const remember = Boolean(req.body?.rememberForSession);
  const resolved = permissions.resolveApproval(req.params.id, approved, remember);
  res.json({ ok: resolved });
});

// Audit Log, Storage & Laptop Telemetry
app.get('/api/audit', async (_req, res) => {
  const logs = await loadAuditLogs();
  res.json({ logs });
});

app.get('/api/storage/stats', async (_req, res) => {
  const stats = await getStorageStats();
  res.json({ stats });
});

app.get('/api/system/telemetry', async (_req, res) => {
  try {
    const settings = await loadSettings();
    const telemetry = await collectSystemTelemetry(settings.defaultWorkspace);
    res.json({ telemetry });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Telemetry failed' });
  }
});

app.post('/api/system/screenshot', async (_req, res) => {
  try {
    const shot = await captureDesktopScreenshot();
    res.json({
      ok: true,
      filePath: shot.filePath,
      sizeKb: shot.sizeKb,
      dataUrl: shot.dataUrl,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Screenshot failed' });
  }
});

if (SERVE_STATIC) {
  const distDir = path.resolve(process.cwd(), 'dist');
  app.use(express.static(distDir));
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[Nexus Agent OS v2] Local server running at http://127.0.0.1:${PORT}`);
});
