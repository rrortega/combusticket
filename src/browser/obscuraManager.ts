import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { IBrowserManager } from '../core/interfaces/IBrowserManager.js';

export interface ObscuraOptions {
  port?: number;
  stealth?: boolean;
  binaryPath?: string;
  verbose?: boolean;
}

export class ObscuraManager implements IBrowserManager {
  private port: number;
  private stealth: boolean;
  private binaryPath: string;
  private verbose: boolean;
  private process: ChildProcess | null = null;
  private startedByUs = false;

  constructor(options: ObscuraOptions = {}) {
    this.port = options.port || 9222;
    this.stealth = options.stealth ?? true;
    this.verbose = options.verbose ?? false;
    this.binaryPath =
      options.binaryPath || path.resolve(process.cwd(), 'obscura');
  }

  public getCdpUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  public async start(): Promise<string> {
    const isAlreadyRunning = await this.checkHealth();
    if (isAlreadyRunning) {
      if (this.verbose) {
        console.log(`[ObscuraManager] Found existing Obscura instance on port ${this.port}.`);
      }
      return this.getCdpUrl();
    }

    let execPath = this.binaryPath;
    let args: string[] = [];

    // On macOS, prefer obscura binary if present; otherwise fallback to system Chromium/Chrome (essential for Docker)
    const isObscuraExecutable = fs.existsSync(this.binaryPath) && process.platform === 'darwin';

    if (isObscuraExecutable) {
      args = ['serve', '--port', String(this.port), '--allow-private-network'];
      if (this.stealth) {
        args.push('--stealth');
      }
    } else {
      const systemChrome = this.findSystemChromium();
      if (!systemChrome) {
        throw new Error(
          `Browser binary not found. Neither Obscura at "${this.binaryPath}" nor system Chromium/Chrome was detected.`
        );
      }
      execPath = systemChrome;
      args = [
        '--headless=new',
        `--remote-debugging-port=${this.port}`,
        '--remote-debugging-address=127.0.0.1',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--hide-scrollbars',
        '--mute-audio',
      ];
      console.log(`[ObscuraManager] Launching system Chromium: ${execPath}`);
    }

    if (this.verbose) {
      console.log(`[ObscuraManager] Spawning process: ${execPath} ${args.join(' ')}`);
    }

    this.process = spawn(execPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });
    this.startedByUs = true;

    this.process.stderr?.on('data', (chunk: Buffer) => {
      if (this.verbose) {
        console.error(`[Obscura STDERR] ${chunk.toString().trim()}`);
      }
    });

    this.process.stdout?.on('data', (chunk: Buffer) => {
      if (this.verbose) {
        console.log(`[Obscura STDOUT] ${chunk.toString().trim()}`);
      }
    });

    this.process.on('error', (err: Error) => {
      console.error('[ObscuraManager] Process failed to spawn:', err);
    });

    this.process.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      if (this.verbose) {
        console.log(`[ObscuraManager] Process exited with code=${code}, signal=${signal}`);
      }
      this.process = null;
      this.startedByUs = false;
    });

    // Wait for healthcheck to succeed
    const ready = await this.waitForReady(15000);
    if (!ready) {
      this.stop();
      throw new Error(`Obscura did not start listening on port ${this.port} within timeout`);
    }

    return this.getCdpUrl();
  }

  public async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${this.port}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async waitForReady(timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.checkHealth()) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  }

  public async stop(): Promise<void> {
    if (this.startedByUs && this.process) {
      const proc = this.process;
      this.process = null;
      this.startedByUs = false;

      await new Promise<void>((resolve) => {
        let finished = false;
        const done = () => {
          if (!finished) {
            finished = true;
            resolve();
          }
        };

        proc.once('exit', done);
        try {
          proc.kill('SIGTERM');
        } catch {
          done();
        }

        // Force kill if not exited after 2.5 seconds
        setTimeout(() => {
          try {
            proc.kill('SIGKILL');
          } catch {}
          done();
        }, 2500);
      });

      // Confirm port is released
      const startWait = Date.now();
      while (Date.now() - startWait < 2000) {
        if (!(await this.checkHealth())) break;
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }

  private findSystemChromium(): string | null {
    const custom = process.env.CHROME_BIN || process.env.CHROMIUM_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
    if (custom && fs.existsSync(custom)) {
      return custom;
    }

    const candidates = [
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ];

    for (const c of candidates) {
      if (fs.existsSync(c)) {
        return c;
      }
    }

    return null;
  }
}
