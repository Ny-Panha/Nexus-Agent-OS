import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SystemTelemetry, ToolRisk } from '../../shared/types.js';
import { getScreenshotsDir } from '../store/storage.js';
import type { ToolSpec } from './types.js';

const execFileAsync = promisify(execFile);

async function runPowerShellRaw(
  command: string,
  options?: { cwd?: string; timeoutMs?: number; signal?: AbortSignal },
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
    {
      cwd: options?.cwd || process.cwd(),
      timeout: options?.timeoutMs ?? 25000,
      maxBuffer: 4 * 1024 * 1024,
      signal: options?.signal,
    },
  );
  return {
    stdout: (stdout || '').trim(),
    stderr: (stderr || '').trim(),
  };
}

const DANGER_PATTERNS = [
  /\b(remove-item|del|erase|rd|rmdir|rm)\b/i,
  /\b(format-volume|format\s+[a-z]:|clear-disk|shutdown|restart-computer|stop-computer)\b/i,
  /\b(stop-process|taskkill|kill)\b/i,
  /\b(reg\s+delete|reg\s+add|set-executionpolicy|netsh|bcdedit|diskpart)\b/i,
  /\b(invoke-expression|iex)\b/i,
];

const READONLY_PATTERNS = [
  /^\s*(get-childitem|gci|dir|ls|pwd|get-location|whoami|hostname|ipconfig|systeminfo|get-process|get-service|get-psdrive|get-date|get-computerinfo|git\s+(status|log|branch|diff)|node\s+-v|npm\s+-v|python\s+--version|where\.exe|get-content|type|cat)\b/i,
];

export function classifyPowerShellRisk(command: string): { risk: ToolRisk; reason: string } {
  const trimmed = command.trim();
  if (DANGER_PATTERNS.some((rx) => rx.test(trimmed))) {
    return { risk: 'danger', reason: `Potentially destructive PowerShell command: ${trimmed.slice(0, 120)}` };
  }
  const hasPipeWrite = /[>|]/.test(trimmed) && /\b(out-file|set-content|add-content|remove-item|stop-process)\b/i.test(trimmed);
  if (!hasPipeWrite && READONLY_PATTERNS.some((rx) => rx.test(trimmed))) {
    return { risk: 'read', reason: `Read-only PowerShell command: ${trimmed.slice(0, 120)}` };
  }
  return { risk: 'write', reason: `Execute PowerShell command: ${trimmed.slice(0, 120)}` };
}

export async function collectSystemTelemetry(defaultWorkspace: string): Promise<SystemTelemetry> {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMemPercent = Math.round(((totalMem - freeMem) / totalMem) * 100);

  let drives: SystemTelemetry['drives'] = [];
  let topProcesses: SystemTelemetry['topProcesses'] = [];

  try {
    const psScript = `
$drives = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -ne $null -or $_.Free -ne $null } | ForEach-Object {
  [PSCustomObject]@{
    name = $_.Name
    freeGb = [math]::Round($_.Free / 1GB, 1)
    usedGb = [math]::Round($_.Used / 1GB, 1)
    totalGb = [math]::Round(($_.Used + $_.Free) / 1GB, 1)
  }
}
$procs = Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 8 | ForEach-Object {
  [PSCustomObject]@{
    name = $_.ProcessName
    pid = $_.Id
    cpuSec = if ($_.CPU) { [math]::Round($_.CPU, 1) } else { 0 }
    memMb = [math]::Round($_.WorkingSet64 / 1MB, 1)
  }
}
[PSCustomObject]@{ drives = @($drives); topProcesses = @($procs) } | ConvertTo-Json -Depth 4 -Compress
`;
    const { stdout } = await runPowerShellRaw(psScript, { timeoutMs: 8000 });
    if (stdout) {
      const parsed = JSON.parse(stdout) as {
        drives?: SystemTelemetry['drives'];
        topProcesses?: SystemTelemetry['topProcesses'];
      };
      drives = Array.isArray(parsed.drives) ? parsed.drives : [];
      topProcesses = Array.isArray(parsed.topProcesses) ? parsed.topProcesses : [];
    }
  } catch {
    // Fallback gracefully if PowerShell query times out
  }

  return {
    hostname: os.hostname(),
    username: os.userInfo().username,
    platform: os.platform(),
    osRelease: os.release(),
    arch: os.arch(),
    cpuModel: cpus[0]?.model?.trim() || 'Unknown CPU',
    cpuCores: cpus.length,
    totalMemoryGb: Number((totalMem / 1024 ** 3).toFixed(1)),
    freeMemoryGb: Number((freeMem / 1024 ** 3).toFixed(1)),
    usedMemoryPercent: usedMemPercent,
    uptimeHours: Number((os.uptime() / 3600).toFixed(1)),
    homeDir: os.homedir(),
    desktopDir: path.join(os.homedir(), 'Desktop'),
    cwd: defaultWorkspace,
    drives,
    topProcesses,
    timestamp: new Date().toISOString(),
  };
}

export async function captureDesktopScreenshot(): Promise<{
  filePath: string;
  base64: string;
  dataUrl: string;
  sizeKb: number;
}> {
  const dir = getScreenshotsDir();
  await fs.mkdir(dir, { recursive: true });
  const filename = `screen-${Date.now()}.png`;
  const outPath = path.join(dir, filename);
  const escaped = outPath.replace(/'/g, "''");

  const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bmp)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bmp.Save('${escaped}', [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bmp.Dispose()
Write-Output 'OK'
`;
  await runPowerShellRaw(ps, { timeoutMs: 12000 });
  const buf = await fs.readFile(outPath);
  const base64 = buf.toString('base64');
  return {
    filePath: outPath,
    base64,
    dataUrl: `data:image/png;base64,${base64}`,
    sizeKb: Math.round(buf.length / 1024),
  };
}

export const systemTools: ToolSpec[] = [
  {
    name: 'get_system_info',
    description:
      'Collect real-time Windows laptop specs, CPU, RAM usage, drives/disk space, user paths, and top memory-consuming processes.',
    parameters: {
      type: 'object',
      properties: {},
    },
    assessRisk: () => ({ risk: 'read', reason: 'Read local system telemetry' }),
    execute: async (_args, ctx) => {
      const info = await collectSystemTelemetry(ctx.defaultWorkspace);
      return { text: JSON.stringify(info, null, 2) };
    },
  },
  {
    name: 'list_processes',
    description: 'List currently running Windows applications and processes with PID, CPU seconds, and RAM (MB).',
    parameters: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          description: 'Optional case-insensitive filter on process name (e.g. "chrome", "node", "code").',
        },
        limit: {
          type: 'number',
          description: 'Max processes to return (default 20).',
        },
      },
    },
    assessRisk: () => ({ risk: 'read', reason: 'Inspect running Windows processes' }),
    execute: async (args, ctx) => {
      const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 60);
      const filter = String(args.filter || '').replace(/'/g, "''");
      const whereClause = filter ? `| Where-Object { $_.ProcessName -like '*${filter}*' }` : '';
      const ps = `Get-Process ${whereClause} | Sort-Object WorkingSet64 -Descending | Select-Object -First ${limit} ProcessName, Id, @{Name='MemMB';Expression={[math]::Round($_.WorkingSet64/1MB,1)}}, MainWindowTitle | Format-Table -AutoSize | Out-String -Width 180`;
      const { stdout } = await runPowerShellRaw(ps, { signal: ctx.signal });
      return { text: stdout || 'No matching processes found.' };
    },
  },
  {
    name: 'run_powershell',
    description:
      'Execute a real PowerShell command on this Windows laptop and return stdout/stderr. Use for dev tools, git, system tasks, networking, or automation.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Exact PowerShell command to execute.',
        },
        cwd: {
          type: 'string',
          description: 'Optional working directory.',
        },
      },
      required: ['command'],
    },
    assessRisk: (args) => classifyPowerShellRisk(String(args.command || '')),
    execute: async (args, ctx) => {
      const command = String(args.command || '');
      const cwd = args.cwd ? String(args.cwd) : ctx.defaultWorkspace;
      try {
        const { stdout, stderr } = await runPowerShellRaw(command, {
          cwd,
          timeoutMs: 30000,
          signal: ctx.signal,
        });
        const combined = [
          stdout ? `STDOUT:\n${stdout}` : '',
          stderr ? `STDERR:\n${stderr}` : '',
        ]
          .filter(Boolean)
          .join('\n\n');
        return { text: (combined || '(Command completed with no output)').slice(0, 14000) };
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; message?: string };
        const details = [e.message, e.stdout, e.stderr].filter(Boolean).join('\n');
        throw new Error(details.slice(0, 6000));
      }
    },
  },
  {
    name: 'open_app_or_path',
    description:
      'Launch a Windows application, file, or folder (e.g. "notepad", "calc", "code", "explorer", or a file path).',
    parameters: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Application executable name, file path, or folder path to open.',
        },
        arguments: {
          type: 'string',
          description: 'Optional CLI arguments to pass to the application.',
        },
      },
      required: ['target'],
    },
    assessRisk: (args) => ({
      risk: 'write',
      reason: `Launch Windows app/path: ${String(args.target || '')}`,
    }),
    execute: async (args, ctx) => {
      const target = String(args.target || '').replace(/'/g, "''");
      const extraArgs = args.arguments ? String(args.arguments).replace(/'/g, "''") : '';
      const cmd = extraArgs
        ? `Start-Process -FilePath '${target}' -ArgumentList '${extraArgs}'`
        : `Start-Process -FilePath '${target}'`;
      await runPowerShellRaw(cmd, { cwd: ctx.defaultWorkspace, signal: ctx.signal });
      return { text: `Launched: ${args.target}${args.arguments ? ` ${args.arguments}` : ''}` };
    },
  },
  {
    name: 'capture_screenshot',
    description:
      'Capture a full screenshot of the current Windows laptop screen, save it locally, and attach it so the AI and user can view it.',
    parameters: {
      type: 'object',
      properties: {},
    },
    assessRisk: () => ({ risk: 'read', reason: 'Capture desktop screen image' }),
    execute: async () => {
      const shot = await captureDesktopScreenshot();
      return {
        text: `Captured desktop screenshot (${shot.sizeKb} KB) saved at ${shot.filePath}`,
        imageDataUrl: shot.dataUrl,
        imageBase64: shot.base64,
        imageMimeType: 'image/png',
        filePath: shot.filePath,
      };
    },
  },
  {
    name: 'get_clipboard',
    description: 'Read current plain text stored in the Windows clipboard.',
    parameters: {
      type: 'object',
      properties: {},
    },
    assessRisk: () => ({ risk: 'read', reason: 'Read Windows clipboard text' }),
    execute: async (_args, ctx) => {
      const { stdout } = await runPowerShellRaw('Get-Clipboard -Raw', { signal: ctx.signal });
      return { text: stdout ? stdout.slice(0, 8000) : '(Clipboard is empty or non-text)' };
    },
  },
  {
    name: 'set_clipboard',
    description: 'Write plain text to the Windows clipboard.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to copy into clipboard.' },
      },
      required: ['text'],
    },
    assessRisk: () => ({ risk: 'write', reason: 'Overwrite Windows clipboard text' }),
    execute: async (args, ctx) => {
      const val = String(args.text ?? '').replace(/'/g, "''");
      await runPowerShellRaw(`Set-Clipboard -Value '${val}'`, { signal: ctx.signal });
      return { text: `Copied ${String(args.text ?? '').length} characters to Windows clipboard.` };
    },
  },
];
