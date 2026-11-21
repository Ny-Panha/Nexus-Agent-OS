import type { AppSettings } from '../../shared/types.js';
import type { ToolSpec } from '../tools/types.js';

export interface LlmToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface LlmMessage {
  role: 'user' | 'assistant' | 'tool';
  text?: string;
  toolCalls?: LlmToolCall[];
  toolCallId?: string;
  toolName?: string;
  imageBase64?: string;
  imageMimeType?: string;
}

export interface LlmResponse {
  text: string;
  toolCalls: LlmToolCall[];
}

function sanitizeSchemaForGemini(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(sanitizeSchemaForGemini);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (k === 'additionalProperties') continue;
    out[k] = sanitizeSchemaForGemini(v);
  }
  return out;
}

async function callGemini(params: {
  settings: AppSettings;
  systemPrompt: string;
  messages: LlmMessage[];
  tools: ToolSpec[];
  signal?: AbortSignal;
}): Promise<LlmResponse> {
  const { settings, systemPrompt, messages, tools, signal } = params;
  if (!settings.geminiApiKey.trim()) {
    throw new Error(
      'Missing Gemini API Key. Open Settings (⚙️) to add your Gemini API key, or switch Provider to Ollama (Local Free).',
    );
  }

  const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      const parts: Array<Record<string, unknown>> = [];
      if (msg.text) parts.push({ text: msg.text });
      if (msg.imageBase64 && msg.imageMimeType) {
        parts.push({
          inlineData: {
            mimeType: msg.imageMimeType,
            data: msg.imageBase64,
          },
        });
      }
      contents.push({ role: 'user', parts });
    } else if (msg.role === 'assistant') {
      const parts: Array<Record<string, unknown>> = [];
      if (msg.text) parts.push({ text: msg.text });
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          parts.push({
            functionCall: {
              name: tc.name,
              args: tc.args,
            },
          });
        }
      }
      contents.push({ role: 'model', parts });
    } else if (msg.role === 'tool') {
      const parts: Array<Record<string, unknown>> = [
        {
          functionResponse: {
            name: msg.toolName || 'tool',
            response: { result: msg.text || '' },
          },
        },
      ];
      if (msg.imageBase64 && msg.imageMimeType) {
        parts.push({
          inlineData: {
            mimeType: msg.imageMimeType,
            data: msg.imageBase64,
          },
        });
      }
      const prev = contents[contents.length - 1];
      if (prev && prev.role === 'user' && prev.parts.every((p) => 'functionResponse' in p || 'inlineData' in p)) {
        prev.parts.push(...parts);
      } else {
        contents.push({ role: 'user', parts });
      }
    }
  }

  const body: Record<string, unknown> = {
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    contents,
    generationConfig: {
      temperature: 0.25,
    },
  };

  if (tools.length > 0) {
    body.tools = [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: sanitizeSchemaForGemini(t.parameters),
        })),
      },
    ];
  }

  const model = encodeURIComponent(settings.geminiModel || 'gemini-2.5-flash');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(settings.geminiApiKey.trim())}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${errText.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          functionCall?: { name: string; args?: Record<string, unknown> };
        }>;
      };
    }>;
  };

  const parts = data.candidates?.[0]?.content?.parts || [];
  const texts: string[] = [];
  const toolCalls: LlmToolCall[] = [];

  parts.forEach((p, idx) => {
    if (p.text) texts.push(p.text);
    if (p.functionCall) {
      toolCalls.push({
        id: `gem-${Date.now()}-${idx}`,
        name: p.functionCall.name,
        args: p.functionCall.args || {},
      });
    }
  });

  return {
    text: texts.join('\n').trim(),
    toolCalls,
  };
}

async function callOllama(params: {
  settings: AppSettings;
  systemPrompt: string;
  messages: LlmMessage[];
  tools: ToolSpec[];
  signal?: AbortSignal;
}): Promise<LlmResponse> {
  const { settings, systemPrompt, messages, tools, signal } = params;
  const baseUrl = (settings.ollamaBaseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const ollamaMessages: Array<Record<string, unknown>> = [
    { role: 'system', content: systemPrompt },
  ];

  for (const msg of messages) {
    if (msg.role === 'user') {
      const m: Record<string, unknown> = { role: 'user', content: msg.text || '' };
      if (msg.imageBase64) m.images = [msg.imageBase64];
      ollamaMessages.push(m);
    } else if (msg.role === 'assistant') {
      const m: Record<string, unknown> = { role: 'assistant', content: msg.text || '' };
      if (msg.toolCalls?.length) {
        m.tool_calls = msg.toolCalls.map((tc) => ({
          function: { name: tc.name, arguments: tc.args },
        }));
      }
      ollamaMessages.push(m);
    } else if (msg.role === 'tool') {
      ollamaMessages.push({
        role: 'tool',
        content: msg.text || '',
      });
    }
  }

  const body: Record<string, unknown> = {
    model: settings.ollamaModel || 'qwen2.5:7b',
    messages: ollamaMessages,
    stream: false,
  };

  if (tools.length > 0) {
    body.tools = tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `Ollama error (${res.status}): ${errText.slice(0, 400)}. Make sure Ollama is running and model "${settings.ollamaModel}" supports tools.`,
    );
  }

  const data = (await res.json()) as {
    message?: {
      content?: string;
      tool_calls?: Array<{ function?: { name: string; arguments?: Record<string, unknown> } }>;
    };
  };

  const toolCalls: LlmToolCall[] = (data.message?.tool_calls || [])
    .filter((tc) => tc.function?.name)
    .map((tc, idx) => ({
      id: `oll-${Date.now()}-${idx}`,
      name: tc.function!.name,
      args: tc.function!.arguments || {},
    }));

  return {
    text: (data.message?.content || '').trim(),
    toolCalls,
  };
}

async function callOpenAiCompatible(params: {
  settings: AppSettings;
  systemPrompt: string;
  messages: LlmMessage[];
  tools: ToolSpec[];
  signal?: AbortSignal;
}): Promise<LlmResponse> {
  const { settings, systemPrompt, messages, tools, signal } = params;
  const baseUrl = (settings.openaiBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  if (!settings.openaiApiKey.trim() && baseUrl.includes('api.openai.com')) {
    throw new Error('Missing OpenAI API Key in Settings.');
  }

  const oaiMessages: Array<Record<string, unknown>> = [
    { role: 'system', content: systemPrompt },
  ];

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (msg.imageBase64 && msg.imageMimeType) {
        oaiMessages.push({
          role: 'user',
          content: [
            { type: 'text', text: msg.text || 'Inspect attached image' },
            {
              type: 'image_url',
              image_url: { url: `data:${msg.imageMimeType};base64,${msg.imageBase64}` },
            },
          ],
        });
      } else {
        oaiMessages.push({ role: 'user', content: msg.text || '' });
      }
    } else if (msg.role === 'assistant') {
      const m: Record<string, unknown> = { role: 'assistant', content: msg.text || null };
      if (msg.toolCalls?.length) {
        m.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.args || {}),
          },
        }));
      }
      oaiMessages.push(m);
    } else if (msg.role === 'tool') {
      oaiMessages.push({
        role: 'tool',
        tool_call_id: msg.toolCallId || 'tool-call',
        content: msg.text || '',
      });
    }
  }

  const body: Record<string, unknown> = {
    model: settings.openaiModel || 'gpt-4o-mini',
    messages: oaiMessages,
    temperature: 0.25,
  };

  if (tools.length > 0) {
    body.tools = tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (settings.openaiApiKey.trim()) {
    headers.Authorization = `Bearer ${settings.openaiApiKey.trim()}`;
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI-compatible API error (${res.status}): ${errText.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          id?: string;
          function?: { name: string; arguments?: string };
        }>;
      };
    }>;
  };

  const message = data.choices?.[0]?.message;
  const toolCalls: LlmToolCall[] = (message?.tool_calls || [])
    .filter((tc) => tc.function?.name)
    .map((tc, idx) => {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        parsedArgs = {};
      }
      return {
        id: tc.id || `oai-${Date.now()}-${idx}`,
        name: tc.function!.name,
        args: parsedArgs,
      };
    });

  return {
    text: (message?.content || '').trim(),
    toolCalls,
  };
}

export async function generateWithTools(params: {
  settings: AppSettings;
  systemPrompt: string;
  messages: LlmMessage[];
  tools: ToolSpec[];
  signal?: AbortSignal;
}): Promise<LlmResponse> {
  if (params.settings.provider === 'ollama') {
    return callOllama(params);
  }
  if (params.settings.provider === 'openai_compatible') {
    return callOpenAiCompatible(params);
  }
  return callGemini(params);
}

export async function listOllamaModels(ollamaBaseUrl: string): Promise<string[]> {
  const baseUrl = (ollamaBaseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) {
    throw new Error(`Ollama not reachable (${res.status})`);
  }
  const data = (await res.json()) as { models?: Array<{ name: string }> };
  return (data.models || []).map((m) => m.name);
}

export async function testProviderConnection(settings: AppSettings): Promise<{ ok: boolean; message: string }> {
  try {
    if (settings.provider === 'ollama') {
      const models = await listOllamaModels(settings.ollamaBaseUrl);
      if (models.length === 0) {
        return {
          ok: true,
          message: 'Connected to Ollama, but no models are downloaded yet. Run `ollama pull qwen2.5:7b` in terminal.',
        };
      }
      return {
        ok: true,
        message: `Connected to Ollama (${models.length} local model${models.length > 1 ? 's' : ''}: ${models.slice(0, 4).join(', ')}).`,
      };
    }

    const res = await generateWithTools({
      settings,
      systemPrompt: 'Reply briefly with OK.',
      messages: [{ role: 'user', text: 'Ping' }],
      tools: [],
      signal: AbortSignal.timeout(12000),
    });
    return {
      ok: true,
      message: `Connected successfully! Model replied: "${res.text.slice(0, 80) || 'OK'}"`,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
