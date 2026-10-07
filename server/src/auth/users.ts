import type { Db } from '../db.js';
import { hashPassword, passwordProblem } from './password.js';

export type Role = 'admin' | 'editor';
export const ROLES: readonly Role[] = ['admin', 'editor'];

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: Role;
  disabled: number;
  created_at: string;
  last_login_at: string | null;
}

/** What the API shows of a user (never the hash). */
export interface PublicUser {
  id: number;
  username: string;
  role: Role;
  disabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export const toPublic = (u: UserRow): PublicUser => ({
  id: u.id,
  username: u.username,
  role: u.role,
  disabled: !!u.disabled,
  createdAt: u.created_at,
  lastLoginAt: u.last_login_at,
});

const USERNAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,31}$/;

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

export function usernameProblem(name: unknown): string | null {
  if (typeof name !== 'string' || !USERNAME.test(name)) return 'Kasutajanimi: 3–32 märki (tähed A–Z, numbrid, _ . -), algab tähe või numbriga.';
  return null;
}

export const users = (db: Db) => ({
  byId: (id: number) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined,
  byName: (name: string) => db.prepare('SELECT * FROM users WHERE username = ?').get(name) as UserRow | undefined,
  list: () => (db.prepare('SELECT * FROM users ORDER BY username').all() as UserRow[]).map(toPublic),
  activeAdmins: () => (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0").get() as { n: number }).n,

  async create(username: unknown, password: unknown, role: unknown): Promise<UserRow> {
    const problem = usernameProblem(username) ?? passwordProblem(password);
    if (problem) throw new HttpError(400, problem);
    if (!ROLES.includes(role as Role)) throw new HttpError(400, 'Roll peab olema "admin" või "editor".');
    if (this.byName(username as string)) throw new HttpError(409, 'Selline kasutajanimi on juba olemas.');
    const hash = await hashPassword(password as string);
    const info = db
      .prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
      .run(username as string, hash, role as Role, new Date().toISOString());
    return this.byId(Number(info.lastInsertRowid))!;
  },

  async setPassword(id: number, password: unknown): Promise<void> {
    const problem = passwordProblem(password);
    if (problem) throw new HttpError(400, problem);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password as string), id);
  },
});
