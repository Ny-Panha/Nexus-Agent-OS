import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { ToolSpec } from './types.js';

function resolveUserPath(rawPath: string | undefined, defaultWorkspace: string): string {
  if (!rawPath || rawPath.trim() === '' || rawPath.trim() === '.') {
    return defaultWorkspace;
  }
  let p = rawPath.trim();
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) {
    p = path.join(os.homedir(), p.slice(1));
  } else if (/^(desktop|documents|downloads)$/i.test(p)) {
    p = path.join(os.homedir(), p[0].toUpperCase() + p.slice(1).toLowerCase());
  }
  return path.isAbsolute(p) ? path.normalize(p) : path.resolve(defaultWorkspace, p);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const fileTools: ToolSpec[] = [
  {
    name: 'list_directory',
    description:
      'List files and folders inside a directory on the laptop. Supports paths like "Desktop", "Downloads", "~", or full paths like "C:\\Users\\...".',
    parameters: {
      type: 'object',
      properties: {
        dirPath: {
          type: 'string',
          description: 'Directory path to inspect. Defaults to current workspace if omitted.',
        },
        maxEntries: {
          type: 'number',
          description: 'Maximum number of entries to return (default 80, max 200).',
        },
      },
    },
    assessRisk: () => ({ risk: 'read', reason: 'Read directory listing' }),
    execute: async (args, ctx) => {
      const target = resolveUserPath(String(args.dirPath || ''), ctx.defaultWorkspace);
      const maxEntries = Math.min(Math.max(Number(args.maxEntries) || 80, 1), 200);
      const entries = await fs.readdir(target, { withFileTypes: true });
      const lines: string[] = [`Directory: ${target} (${entries.length} items)`];

      for (const entry of entries.slice(0, maxEntries)) {
        const full = path.join(target, entry.name);
        try {
          const stat = await fs.stat(full);
          const kind = entry.isDirectory() ? '[DIR] ' : '[FILE]';
          const size = entry.isDirectory() ? '' : ` (${formatBytes(stat.size)})`;
          const modified = stat.mtime.toISOString().slice(0, 16).replace('T', ' ');
          lines.push(`${kind} ${entry.name}${size}  |  ${modified}`);
        } catch {
          lines.push(`[ITEM] ${entry.name}`);
        }
      }
      if (entries.length > maxEntries) {
        lines.push(`... and ${entries.length - maxEntries} more items.`);
      }
      return { text: lines.join('\n') };
    },
  },
  {
    name: 'read_file',
    description: 'Read text contents of a file on the laptop with optional line range.',
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Full or relative path to the file.',
        },
        startLine: {
          type: 'number',
          description: '1-based start line (default 1).',
        },
        endLine: {
          type: 'number',
          description: '1-based inclusive end line (default 200).',
        },
      },
      required: ['filePath'],
    },
    assessRisk: () => ({ risk: 'read', reason: 'Read file content' }),
    execute: async (args, ctx) => {
      const target = resolveUserPath(String(args.filePath), ctx.defaultWorkspace);
      const stat = await fs.stat(target);
      if (stat.size > 2 * 1024 * 1024) {
        return {
          text: `File ${target} is large (${formatBytes(stat.size)}). Reading first 200 lines.`,
        };
      }
      const raw = await fs.readFile(target, 'utf8');
      const allLines = raw.split(/\r?\n/);
      const start = Math.max(Number(args.startLine) || 1, 1);
      const end = Math.min(Number(args.endLine) || start + 199, allLines.length);
      const slice = allLines.slice(start - 1, end);
      const numbered = slice.map((line, i) => `${start + i}: ${line}`).join('\n');
      return {
        text: `File: ${target} (lines ${start}-${end} of ${allLines.length})\n\n${numbered.slice(0, 14000)}`,
      };
    },
  },
  {
    name: 'search_files',
    description:
      'Recursively search for files by filename substring (and optionally text content) inside a directory.',
    parameters: {
      type: 'object',
      properties: {
        dirPath: {
          type: 'string',
          description: 'Root directory to search.',
        },
        query: {
          type: 'string',
          description: 'Case-insensitive filename or content query to search for.',
        },
        searchContent: {
          type: 'boolean',
          description: 'When true, also inspect text files (<512KB) for matching lines.',
        },
        maxResults: {
          type: 'number',
          description: 'Max matches to return (default 40).',
        },
      },
      required: ['query'],
    },
    assessRisk: () => ({ risk: 'read', reason: 'Search files in directory' }),
    execute: async (args, ctx) => {
      const root = resolveUserPath(String(args.dirPath || ''), ctx.defaultWorkspace);
      const query = String(args.query || '').toLowerCase();
      const searchContent = Boolean(args.searchContent);
      const maxResults = Math.min(Math.max(Number(args.maxResults) || 40, 1), 100);

      const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', '.next', '$RECYCLE.BIN', 'Windows']);
      const matches: string[] = [];

      async function walk(current: string, depth: number): Promise<void> {
        if (depth > 5 || matches.length >= maxResults || ctx.signal?.aborted) return;
        let entries;
        try {
          entries = await fs.readdir(current, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (matches.length >= maxResults) return;
          if (entry.isDirectory() && skipDirs.has(entry.name)) continue;
          const full = path.join(current, entry.name);
          if (entry.name.toLowerCase().includes(query)) {
            matches.push(`${entry.isDirectory() ? '[DIR] ' : '[NAME]'} ${full}`);
          } else if (searchContent && entry.isFile()) {
            try {
              const stat = await fs.stat(full);
              if (stat.size <= 512 * 1024) {
                const text = await fs.readFile(full, 'utf8');
                if (text.toLowerCase().includes(query)) {
                  const hitLine = text
                    .split(/\r?\n/)
                    .findIndex((l) => l.toLowerCase().includes(query));
                  matches.push(`[TEXT] ${full}:${hitLine + 1}`);
                }
              }
            } catch {
              // ignore unreadable binary files
            }
          }
          if (entry.isDirectory()) {
            await walk(full, depth + 1);
          }
        }
      }

      await walk(root, 0);
      if (matches.length === 0) {
        return { text: `No matches found for "${args.query}" under ${root}.` };
      }
      return { text: `Found ${matches.length} match(es) under ${root}:\n${matches.join('\n')}` };
    },
  },
  {
    name: 'write_file',
    description: 'Create a new file or overwrite an existing file with UTF-8 text content.',
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Destination path (e.g., "Desktop/report.md" or full path).',
        },
        content: {
          type: 'string',
          description: 'Complete text content to write.',
        },
      },
      required: ['filePath', 'content'],
    },
    assessRisk: (args) => ({
      risk: 'write',
      reason: `Create or overwrite file: ${String(args.filePath || '')}`,
    }),
    execute: async (args, ctx) => {
      const target = resolveUserPath(String(args.filePath), ctx.defaultWorkspace);
      const content = String(args.content ?? '');
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, 'utf8');
      return {
        text: `Successfully wrote ${content.length} characters to ${target}`,
        filePath: target,
      };
    },
  },
  {
    name: 'create_directory',
    description: 'Create a folder (including nested parent folders if needed).',
    parameters: {
      type: 'object',
      properties: {
        dirPath: {
          type: 'string',
          description: 'Folder path to create.',
        },
      },
      required: ['dirPath'],
    },
    assessRisk: (args) => ({
      risk: 'write',
      reason: `Create folder: ${String(args.dirPath || '')}`,
    }),
    execute: async (args, ctx) => {
      const target = resolveUserPath(String(args.dirPath), ctx.defaultWorkspace);
      await fs.mkdir(target, { recursive: true });
      return { text: `Created directory: ${target}` };
    },
  },
  {
    name: 'move_or_rename',
    description: 'Move or rename a file or folder on the laptop.',
    parameters: {
      type: 'object',
      properties: {
        sourcePath: { type: 'string', description: 'Existing file/folder path.' },
        targetPath: { type: 'string', description: 'New file/folder path.' },
      },
      required: ['sourcePath', 'targetPath'],
    },
    assessRisk: (args) => ({
      risk: 'write',
      reason: `Move/rename ${String(args.sourcePath || '')} -> ${String(args.targetPath || '')}`,
    }),
    execute: async (args, ctx) => {
      const src = resolveUserPath(String(args.sourcePath), ctx.defaultWorkspace);
      const dst = resolveUserPath(String(args.targetPath), ctx.defaultWorkspace);
      await fs.mkdir(path.dirname(dst), { recursive: true });
      await fs.rename(src, dst);
      return { text: `Moved ${src} -> ${dst}` };
    },
  },
  {
    name: 'delete_path',
    description: 'Permanently delete a file or folder. High risk — requires approval in Safe/Smart modes.',
    parameters: {
      type: 'object',
      properties: {
        targetPath: { type: 'string', description: 'File or folder path to delete.' },
      },
      required: ['targetPath'],
    },
    assessRisk: (args) => ({
      risk: 'danger',
      reason: `Permanently delete path: ${String(args.targetPath || '')}`,
    }),
    execute: async (args, ctx) => {
      const target = resolveUserPath(String(args.targetPath), ctx.defaultWorkspace);
      const normalized = path.resolve(target).toLowerCase();
      const forbidden = ['c:\\', 'c:\\windows', 'c:\\program files', os.homedir().toLowerCase()];
      if (forbidden.includes(normalized)) {
        throw new Error(`Refused to delete critical system/root path: ${target}`);
      }
      await fs.rm(target, { recursive: true, force: true });
      return { text: `Deleted path: ${target}` };
    },
  },
];
