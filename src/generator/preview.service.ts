import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { conversionStorage } from './storage.js';
import { generateNextConfig } from './codegen/project-template.js';
import { repairGeneratedTsx } from './codegen/repair-generated-tsx.js';

export type PreviewStatus = 'INSTALLING' | 'BUILDING' | 'STARTING' | 'READY' | 'FAILED' | 'STOPPED';
export interface PreviewRecord {
  conversionId: string;
  status: PreviewStatus;
  url?: string;
  logs: string[];
  errorMessage?: string;
  updatedAt: string;
}
export class PreviewBusyError extends Error {}

/** Deliberately excludes API_KEY, DATABASE_URL, NODE_OPTIONS and npm auth configuration. */
export function previewEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA']) {
    if (source[key]) env[key] = source[key];
  }
  return { ...env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false' };
}

async function availablePort(): Promise<number> {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('No preview port available')));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

interface Session {
  record: PreviewRecord;
  child?: ChildProcess;
  stopped: boolean;
  expiry?: ReturnType<typeof setTimeout>;
}

export class SitePreviewService {
  private sessions = new Map<string, Session>();
  private active?: Session;

  get(id: string): PreviewRecord | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    return { ...session.record, logs: [...session.record.logs] };
  }

  start(id: string): PreviewRecord {
    // Validate before assigning any runtime state or constructing filesystem paths.
    conversionStorage.getProjectDir(id);
    if (this.active && !this.active.stopped) {
      if (this.active.record.conversionId === id) return this.get(id)!;
      throw new PreviewBusyError('Another site preview is active. Stop it before starting this project.');
    }
    const session: Session = {
      record: { conversionId: id, status: 'INSTALLING', logs: [], updatedAt: new Date().toISOString() },
      stopped: false,
    };
    this.sessions.set(id, session);
    this.active = session;
    // Limit retained sessions and log memory independently of the number of conversions.
    for (const oldId of this.sessions.keys()) {
      if (this.sessions.size <= 20) break;
      if (oldId !== id) this.sessions.delete(oldId);
    }
    session.expiry = setTimeout(() => { void this.stop(id); }, 30 * 60 * 1000);
    session.expiry.unref();
    void this.run(session).catch(async (error: unknown) => {
      if (session.stopped) return;
      session.record.status = 'FAILED';
      session.record.errorMessage = error instanceof Error ? error.message : String(error);
      this.log(session, session.record.errorMessage);
      await this.terminate(session);
      session.stopped = true;
      clearTimeout(session.expiry);
      if (this.active === session) this.active = undefined;
    });
    return this.get(id)!;
  }

  async stop(id: string): Promise<PreviewRecord | null> {
    const session = this.sessions.get(id);
    if (!session) return null;
    session.stopped = true;
    clearTimeout(session.expiry);
    await this.terminate(session);
    session.record.status = 'STOPPED';
    delete session.record.url;
    this.log(session, 'Preview stopped.');
    if (this.active === session) this.active = undefined;
    return this.get(id);
  }

  async close(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.stop(id)));
  }

  private log(session: Session, text: string): void {
    const clean = text.replace(/\u001b\[[0-9;]*m/g, '').slice(0, 4000);
    session.record.logs.push(clean);
    if (session.record.logs.length > 150) session.record.logs.splice(0, session.record.logs.length - 150);
    session.record.updatedAt = new Date().toISOString();
  }

  private async terminate(session: Session): Promise<void> {
    const child = session.child;
    if (!child?.pid || child.exitCode !== null) return;
    if (process.platform === 'win32') {
      await new Promise<void>((resolve) => {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', env: previewEnvironment() });
        killer.once('error', () => { child.kill(); resolve(); });
        killer.once('close', () => resolve());
      });
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }
  }

  private command(session: Session, args: string[], cwd: string, timeoutMs: number, server = false): Promise<void> {
    return new Promise((resolve, reject) => {
      if (session.stopped) return reject(new Error('Preview stopped'));
      const child = spawn(process.execPath, args, {
        cwd, env: previewEnvironment(), windowsHide: true,
        detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
      });
      session.child = child;
      let timedOut = false;
      const timer = server ? undefined : setTimeout(() => {
        timedOut = true;
        void this.terminate(session);
      }, timeoutMs);
      child.stdout?.on('data', (chunk: Buffer) => this.log(session, chunk.toString()));
      child.stderr?.on('data', (chunk: Buffer) => this.log(session, chunk.toString()));
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('close', (code) => {
        clearTimeout(timer);
        if (session.child === child) session.child = undefined;
        if (session.stopped) return reject(new Error('Preview stopped'));
        if (server) {
          session.record.status = 'FAILED';
          session.record.errorMessage = `Preview server exited (code ${code}).`;
          session.stopped = true;
          clearTimeout(session.expiry);
          delete session.record.url;
          this.log(session, session.record.errorMessage);
          if (this.active === session) this.active = undefined;
          return;
        }
        if (timedOut) return reject(new Error('Preview command timed out. See build logs.'));
        code === 0 ? resolve() : reject(new Error(`Preview command failed (code ${code}). See build logs.`));
      });
      if (server) child.once('spawn', resolve);
    });
  }

  private async run(session: Session): Promise<void> {
    const id = session.record.conversionId;
    const source = conversionStorage.getProjectDir(id);
    const workspace = path.join(conversionStorage.getConversionDir(id), 'preview-workspace');
    await fs.mkdir(workspace, { recursive: true });
    // Copy only generated artifacts. Never read a source .env, npm credentials,
    // existing dependency tree, build output, or symbolic link into the runtime.
    await fs.cp(source, workspace, {
      recursive: true,
      filter: async (file) => {
        const name = path.basename(file);
        if (name.startsWith('.env') || ['.npmrc', 'node_modules', '.next', '.git'].includes(name)) return false;
        return !(await fs.lstat(file)).isSymbolicLink();
      },
    });
    // Existing conversions predate transformer fixes; repair their runtime copy
    // without disabling strict checks or changing the previously downloaded ZIP.
    const repairDirectory = async (directory: string): Promise<void> => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (['node_modules', '.next', '.git'].includes(entry.name)) continue;
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await repairDirectory(file);
        else if (entry.name.endsWith('.tsx')) {
          const original = await fs.readFile(file, 'utf8');
          const repaired = repairGeneratedTsx(original, file);
          if (repaired !== original) await fs.writeFile(file, repaired);
        }
      }
    };
    await repairDirectory(workspace);
    await fs.writeFile(path.join(workspace, 'next.config.mjs'), generateNextConfig('localhost'));
    if (session.stopped) return;
    const npmCandidates = [
      path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      path.resolve(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      ...(process.env.APPDATA ? [path.join(process.env.APPDATA, 'npm', 'node_modules', 'npm', 'bin', 'npm-cli.js')] : []),
    ];
    let npmCli: string | undefined;
    for (const candidate of npmCandidates) {
      try { await fs.access(candidate); npmCli = candidate; break; } catch { /* next candidate */ }
    }
    if (!npmCli) throw new Error('Cannot locate npm-cli.js for this Node installation. Install Node with npm.');
    const blankConfig = path.join(conversionStorage.getConversionDir(id), 'preview-npmrc');
    await fs.writeFile(blankConfig, 'ignore-scripts=true\naudit=false\nfund=false\n');
    await fs.writeFile(`${blankConfig}-global`, '');
    this.log(session, 'Installing dependencies in an isolated project copy (lifecycle scripts disabled).');
    await this.command(session, [npmCli, 'install', '--include=dev', '--ignore-scripts', '--no-audit', '--no-fund', `--userconfig=${blankConfig}`, `--globalconfig=${blankConfig}-global`], workspace, 5 * 60 * 1000);
    if (session.stopped) return;
    session.record.status = 'BUILDING';
    this.log(session, 'Building the generated Next.js application.');
    const nextCli = path.join(workspace, 'node_modules', 'next', 'dist', 'bin', 'next');
    await this.command(session, [nextCli, 'build'], workspace, 5 * 60 * 1000);
    if (session.stopped) return;
    const port = await availablePort();
    const origin = `http://127.0.0.1:${port}`;
    const appDirectory = await fs.stat(path.join(workspace, 'src/app')).then(() => path.join(workspace, 'src/app'), () => path.join(workspace, 'app'));
    const findEntry = async (directory: string, segments: string[] = []): Promise<string | undefined> => {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      if (entries.some((entry) => entry.name === 'page.tsx')) return '/' + segments.join('/');
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory() || entry.name.startsWith('@') || entry.name.includes('[')) continue;
        const route = await findEntry(path.join(directory, entry.name), entry.name.startsWith('(') ? segments : [...segments, entry.name]);
        if (route) return route;
      }
      return undefined;
    };
    const entryRoute = await findEntry(appDirectory);
    if (!entryRoute) throw new Error('Generated project has no static page route to preview.');
    const url = origin + entryRoute;
    session.record.status = 'STARTING';
    this.log(session, 'Starting loopback-only preview server.');
    await this.command(session, [nextCli, 'start', '--hostname', '127.0.0.1', '--port', String(port)], workspace, 0, true);
    for (let attempt = 0; attempt < 60; attempt++) {
      if (session.stopped) return;
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(2000), redirect: 'manual' });
        await response.body?.cancel();
        if (response.status >= 200 && response.status < 400) {
          session.record.status = 'READY';
          session.record.url = url;
          this.log(session, 'Built-site preview ready. Automatically stops after 30 minutes.');
          return;
        }
      } catch { /* server still starting */ }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('Preview server did not become ready. See build logs.');
  }
}

export const sitePreviewService = new SitePreviewService();
