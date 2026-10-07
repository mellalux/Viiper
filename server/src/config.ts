import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(serverRoot, '..');

const env = process.env;
const production = env.NODE_ENV === 'production';

const int = (name: string, fallback: number): number => {
  const n = Number(env[name]);
  return env[name] !== undefined && Number.isInteger(n) && n >= 0 ? n : fallback;
};

export interface Config {
  production: boolean;
  port: number;
  /** SQLite file; ":memory:" for tests. */
  dbPath: string;
  /** The built frontend that is served in production (none in dev: Vite serves it and proxies /api here). */
  clientDist: string | null;
  /** The JSON files the database is seeded from when it is empty, and that `npm run export` writes. */
  dataDir: string;
  /** Cookie `Secure` flag; on by default in production (needs https, or http://localhost). */
  secureCookies: boolean;
  /** `app.set('trust proxy', ...)`: set when a reverse proxy sits in front (e.g. "1"), so the client's IP is read right. */
  trustProxy: string | null;
  sessionDays: number;
  /** Extra origins allowed to make changes (the page's own origin is always allowed). */
  allowedOrigins: string[];
  loginMaxPerIp: number;
  loginMaxFailsPerAccount: number;
}

export const loadConfig = (overrides: Partial<Config> = {}): Config => ({
  production,
  port: int('PORT', 3001),
  dbPath: env.DB_PATH ?? path.join(serverRoot, 'data', 'viiper.db'),
  clientDist: env.CLIENT_DIST ?? (production ? path.join(repoRoot, 'client', 'dist') : null),
  dataDir: env.DATA_DIR ?? path.join(repoRoot, 'client', 'src', 'data'),
  secureCookies: env.COOKIE_SECURE ? env.COOKIE_SECURE === '1' : production,
  trustProxy: env.TRUST_PROXY ?? null,
  sessionDays: int('SESSION_DAYS', 14),
  allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  loginMaxPerIp: int('LOGIN_MAX_PER_IP', 40),
  loginMaxFailsPerAccount: int('LOGIN_MAX_FAILS', 8),
  ...overrides,
});
