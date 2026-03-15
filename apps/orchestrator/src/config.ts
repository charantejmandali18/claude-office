import { z } from 'zod';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env from monorepo root if env vars aren't already set
function loadDotenv(): void {
  // Walk up from this file to find the monorepo root .env
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    dir = resolve(dir, '..');
    try {
      const envContent = readFileSync(resolve(dir, '.env'), 'utf-8');
      for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
      return;
    } catch {
      // No .env here, keep walking
    }
  }
}

loadDotenv();

const envSchema = z.object({
  DATABASE_URL: z.string().startsWith('postgresql://'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  // Note: Claude Agent SDK uses Claude Code auth (CLI login), not an API key
  RIGELHQ_ADAPTER: z.enum(['claude', 'mock']).default('mock'),
  RIGELHQ_MAX_CONCURRENT_AGENTS: z.coerce.number().default(5),
  RIGELHQ_TOKEN_BUDGET_DAILY: z.coerce.number().default(1_000_000),
  RIGELHQ_ORCHESTRATOR_PORT: z.coerce.number().default(4000),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(): Config {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.format());
    process.exit(1);
  }
  return result.data;
}
