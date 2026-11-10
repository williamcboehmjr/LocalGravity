import { spawn, ChildProcessWithoutNullStreams, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

export interface TerminalOutputListener {
  (chunk: string, stream: 'stdout' | 'stderr'): void;
}

export function resolveDefaultShell(): { bin: string; isPwsh: boolean } {
  if (os.platform() !== 'win32') {
    return { bin: process.env.SHELL || '/bin/zsh', isPwsh: false };
  }
  const candidates = [
    'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    `${process.env.LOCALAPPDATA || ''}\\Microsoft\\PowerShell\\pwsh.exe`,
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return { bin: c, isPwsh: true };
  }
  try {
    execSync('where pwsh', { stdio: 'ignore' });
    return { bin: 'pwsh.exe', isPwsh: true };
  } catch {}
  return { bin: 'powershell.exe', isPwsh: false };
}

export class SharedTerminalManager {
  private shellProc: ChildProcessWithoutNullStreams | null = null;
  private cwd: string;
  private listeners = new Set<TerminalOutputListener>();
  private ringBuffer: string[] = [];
  private maxBufferLines = 300;

  constructor(initialCwd: string) {
    this.cwd = initialCwd;
    this.ensureShellProcess();
  }

  public ensureShellProcess(): void {
    if (this.shellProc && !this.shellProc.killed) {
      return;
    }

    const isWin = os.platform() === 'win32';
    const resolved = resolveDefaultShell();
    const shellBin = resolved.bin;
    const shellArgs = isWin ? ['-NoLogo', '-NoExit'] : ['-i'];

    this.shellProc = spawn(shellBin, shellArgs, {
      cwd: this.cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const welcomeBanner = `\x1b[38;2;138;180;248m⚡ LocalGravity Shared Interactive Shell (${shellBin})\x1b[0m\r\n\x1b[90mWorking directory: ${this.cwd}\x1b[0m\r\n`;
    this.pushHistory(welcomeBanner);

    this.shellProc.stdout.on('data', (data: Buffer) => {
      const text = data.toString('utf-8');
      this.pushHistory(text);
      for (const listener of this.listeners) {
        listener(text, 'stdout');
      }
    });

    this.shellProc.stderr.on('data', (data: Buffer) => {
      const text = data.toString('utf-8');
      const colored = `\x1b[38;2;242;139;130m${text}\x1b[0m`;
      this.pushHistory(colored);
      for (const listener of this.listeners) {
        listener(colored, 'stderr');
      }
    });

    this.shellProc.on('exit', () => {
      this.shellProc = null;
    });
  }

  private pushHistory(text: string): void {
    this.ringBuffer.push(text);
    if (this.ringBuffer.length > this.maxBufferLines) {
      this.ringBuffer.shift();
    }
  }

  public getHistory(): string {
    return this.ringBuffer.join('');
  }

  public writeInput(input: string): void {
    this.ensureShellProcess();
    if (this.shellProc && !this.shellProc.killed) {
      this.shellProc.stdin.write(input);
    }
  }

  public setCwd(newCwd: string): void {
    this.cwd = newCwd;
    if (this.shellProc && !this.shellProc.killed) {
      const escaped = newCwd.replace(/"/g, '\\"');
      this.shellProc.stdin.write(`Set-Location "${escaped}"\r\n`);
    }
  }

  public onOutput(listener: TerminalOutputListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Executes a command for the agent (`run_terminal`), echoing live output to the shared xterm.js terminal
   * while capturing structured stdout, stderr, exitCode, and durationMs for `tool_executions`.
   */
  public async executeCommand(
    command: string,
    cwd?: string,
    timeoutMs = 30000,
    onLiveChunk?: (chunk: string, stream: 'stdout' | 'stderr') => void,
    abortSignal?: AbortSignal
  ): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
  }> {
    const startMs = performance.now();
    const targetCwd = cwd || this.cwd;
    const isWin = os.platform() === 'win32';
    const resolved = resolveDefaultShell();
    const shellBin = resolved.bin;

    // Command normalization: If using Windows PowerShell 5.1 (not pwsh), convert `&&` syntax into safe pipeline execution
    let normalizedCommand = command;
    if (isWin && !resolved.isPwsh && command.includes('&&')) {
      const parts = command.split('&&').map(p => p.trim());
      normalizedCommand = parts.join('; if ($?) { ') + ' }'.repeat(parts.length - 1);
    }
    const shellArgs = isWin ? ['-NoProfile', '-Command', normalizedCommand] : ['-c', command];

    // Echo command banner into shared interactive terminal
    const echoBanner = `\r\n\x1b[38;2;138;180;248m❯ [Agent] ${command}\x1b[0m\r\n`;
    this.pushHistory(echoBanner);
    for (const listener of this.listeners) {
      listener(echoBanner, 'stdout');
    }

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let finished = false;

      const child = spawn(shellBin, shellArgs, {
        cwd: targetCwd,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const onAbort = () => {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          try {
            if (isWin && child.pid) {
              spawn('taskkill', ['/pid', String(child.pid), '/f', '/t']);
            } else {
              child.kill('SIGTERM');
            }
          } catch {}
          resolve({
            stdout,
            stderr: (stderr ? stderr + '\n' : '') + '[Command aborted by user]',
            exitCode: 130,
            durationMs: Math.round(performance.now() - startMs),
          });
        }
      };

      if (abortSignal?.aborted) {
        onAbort();
        return;
      }
      abortSignal?.addEventListener('abort', onAbort, { once: true });

      const timer = setTimeout(() => {
        if (!finished) {
          finished = true;
          try {
            child.kill();
          } catch {}
          resolve({
            stdout,
            stderr: stderr + `\n[Command timed out after ${timeoutMs}ms]`,
            exitCode: 124,
            durationMs: Math.round(performance.now() - startMs),
          });
        }
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        stdout += text;
        this.pushHistory(text);
        onLiveChunk?.(text, 'stdout');
        for (const listener of this.listeners) {
          listener(text, 'stdout');
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        stderr += text;
        const colored = `\x1b[38;2;242;139;130m${text}\x1b[0m`;
        this.pushHistory(colored);
        onLiveChunk?.(text, 'stderr');
        for (const listener of this.listeners) {
          listener(colored, 'stderr');
        }
      });

      child.on('close', (code) => {
        abortSignal?.removeEventListener('abort', onAbort);
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          resolve({
            stdout,
            stderr,
            exitCode: code ?? 0,
            durationMs: Math.round(performance.now() - startMs),
          });
        }
      });

      child.on('error', (err) => {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          resolve({
            stdout,
            stderr: stderr + `\n${err.message}`,
            exitCode: 1,
            durationMs: Math.round(performance.now() - startMs),
          });
        }
      });
    });
  }

  public dispose(): void {
    if (this.shellProc && !this.shellProc.killed) {
      try {
        this.shellProc.kill();
      } catch {}
    }
  }
}
