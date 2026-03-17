import fs from 'fs';
import path from 'path';
import os from 'os';
import type { EventBus } from './event-bus.js';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const TEAMS_DIR = path.join(CLAUDE_DIR, 'teams');
const TASKS_DIR = path.join(CLAUDE_DIR, 'tasks');

export class FileWatcher {
  private watchers: fs.FSWatcher[] = [];

  constructor(private eventBus: EventBus) {}

  start(): void {
    this.watchDir(TEAMS_DIR, 'team');
    this.watchDir(TASKS_DIR, 'task');
  }

  stop(): void {
    for (const w of this.watchers) {
      w.close();
    }
    this.watchers = [];
  }

  private watchDir(dir: string, type: 'team' | 'task'): void {
    if (!fs.existsSync(dir)) {
      console.log(`[FileWatcher] Directory does not exist, skipping: ${dir}`);
      return;
    }

    try {
      const watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        this.handleChange(type, dir, filename).catch(() => {});
      });
      watcher.on('error', (err) => {
        console.warn(`[FileWatcher] Watcher error for ${dir}:`, (err as NodeJS.ErrnoException).code ?? err);
      });
      this.watchers.push(watcher);
      console.log(`[FileWatcher] Watching ${type} directory: ${dir}`);
    } catch (err) {
      console.warn(`[FileWatcher] Failed to watch ${dir}:`, (err as NodeJS.ErrnoException).code ?? err);
    }
  }

  private async handleChange(type: 'team' | 'task', dir: string, filename: string): Promise<void> {
    const fullPath = path.join(dir, filename);
    if (!fs.existsSync(fullPath)) return;

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const data = JSON.parse(content);

      if (type === 'team' && filename.endsWith('config.json')) {
        console.log(`[FileWatcher] Team config updated:`, data.name ?? 'unknown');
        // Could emit team roster updates
      } else if (type === 'task') {
        console.log(`[FileWatcher] Task updated: ${data.id ?? filename} — ${data.status ?? 'unknown'}`);
        // Could emit task status confirmations
      }
    } catch {
      // File might be partially written, ignore parse errors
    }
  }
}
