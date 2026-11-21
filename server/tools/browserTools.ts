import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import type { ToolSpec } from './types.js';

const execFileAsync = promisify(execFile);

function stripHtmlToText(html: string): { title: string; text: string; links: string[] } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim() : '';

  const links: string[] = [];
  const linkRegex = /<a\s+[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(html)) !== null && links.length < 15) {
    const label = decodeEntities(m[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (label && m[1]) {
      links.push(`${label} -> ${m[1]}`);
    }
  }

  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<(br|p|div|li|h[1-6]|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  const text = decodeEntities(cleaned)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { title, text, links };
}

function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

async function findInstalledBrowserExe(): Promise<string | null> {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // continue
    }
  }
  return null;
}

export const browserTools: ToolSpec[] = [
  {
    name: 'web_search',
    description: 'Search the live web using DuckDuckGo and return top results with titles, snippets, and URLs.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string.' },
        maxResults: { type: 'number', description: 'Number of results (default 6, max 12).' },
      },
      required: ['query'],
    },
    assessRisk: () => ({ risk: 'read', reason: 'Search web via DuckDuckGo' }),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim();
      const maxResults = Math.min(Math.max(Number(args.maxResults) || 6, 1), 12);
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
        },
        signal: ctx.signal,
      });
      if (!res.ok) {
        throw new Error(`Search request failed with HTTP ${res.status}`);
      }
      const html = await res.text();
      const results: string[] = [];
      const itemRegex =
        /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>|class="result__snippet"[^>]*>([\s\S]*?)<\/div>)/gi;

      let match: RegExpExecArray | null;
      while ((match = itemRegex.exec(html)) !== null && results.length < maxResults) {
        let href = decodeEntities(match[1]);
        const uddg = href.match(/uddg=([^&]+)/);
        if (uddg) {
          href = decodeURIComponent(uddg[1]);
        }
        const title = decodeEntities(match[2].replace(/<[^>]+>/g, '')).trim();
        const snippet = decodeEntities((match[3] || match[4] || '').replace(/<[^>]+>/g, ''))
          .replace(/\s+/g, ' ')
          .trim();
        results.push(`${results.length + 1}. ${title}\n   URL: ${href}\n   ${snippet}`);
      }

      if (results.length === 0) {
        const fallback = stripHtmlToText(html).text.slice(0, 3000);
        return { text: `Search query: "${query}"\n\n${fallback}` };
      }

      return { text: `Web search results for "${query}":\n\n${results.join('\n\n')}` };
    },
  },
  {
    name: 'fetch_webpage',
    description: 'Fetch a web URL and extract its readable title, main text content, and key links.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'HTTP or HTTPS URL to fetch.' },
        renderJs: {
          type: 'boolean',
          description: 'If true, render JavaScript using local headless Chrome/Edge before extracting text.',
        },
      },
      required: ['url'],
    },
    assessRisk: () => ({ risk: 'read', reason: 'Fetch webpage content' }),
    execute: async (args, ctx) => {
      const targetUrl = String(args.url || '').trim();
      if (!/^https?:\/\//i.test(targetUrl)) {
        throw new Error('URL must start with http:// or https://');
      }

      let html = '';
      if (args.renderJs) {
        const exe = await findInstalledBrowserExe();
        if (exe) {
          const { stdout } = await execFileAsync(
            exe,
            ['--headless=new', '--disable-gpu', '--dump-dom', targetUrl],
            { timeout: 20000, maxBuffer: 5 * 1024 * 1024, signal: ctx.signal },
          );
          html = stdout;
        }
      }

      if (!html) {
        const res = await fetch(targetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
          },
          signal: ctx.signal,
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} fetching ${targetUrl}`);
        }
        html = await res.text();
      }

      const parsed = stripHtmlToText(html);
      const out = [
        `URL: ${targetUrl}`,
        parsed.title ? `Title: ${parsed.title}` : '',
        `\nContent:\n${parsed.text.slice(0, 9000)}`,
        parsed.links.length ? `\nLinks:\n${parsed.links.slice(0, 10).join('\n')}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      return { text: out };
    },
  },
  {
    name: 'open_url_in_browser',
    description: 'Open a live URL directly in the user’s Windows browser.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to open in browser.' },
      },
      required: ['url'],
    },
    assessRisk: (args) => ({
      risk: 'write',
      reason: `Open URL in Windows browser: ${String(args.url || '')}`,
    }),
    execute: async (args, ctx) => {
      const url = String(args.url || '').trim();
      if (!/^https?:\/\//i.test(url)) {
        throw new Error('URL must start with http:// or https://');
      }
      const escaped = url.replace(/'/g, "''");
      await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', `Start-Process '${escaped}'`],
        { signal: ctx.signal },
      );
      return { text: `Opened in default browser: ${url}` };
    },
  },
];
