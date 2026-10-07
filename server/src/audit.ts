import type { Request } from 'express';
import type { Db } from './db.js';

/** What happened, in the audit log (the action names are shown to admins; the client translates them). */
export type AuditAction =
  | 'login' | 'login_failed' | 'login_blocked' | 'logout' | 'password_change'
  | 'user_create' | 'user_update' | 'user_delete'
  | 'sign_save';

export interface AuditEntry {
  id: number;
  at: string;
  username: string | null;
  action: string;
  target: string | null;
  detail: string | null;
  ip: string | null;
}

const KEEP_DAYS = 365;
const clip = (s: string | null | undefined, n: number) => (s == null ? null : s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Who did what, kept in the database. The user name is copied in, so the row stays readable after the account is deleted. */
export const audit = (db: Db) => {
  const insert = db.prepare('INSERT INTO audit (at, user_id, username, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?)');
  return {
    /** `req.user` is the actor; pass `as` for the one who is not signed in yet (a login) or for the command line. */
    log(req: Pick<Request, 'user' | 'ip'> | null, action: AuditAction, target?: string | null, detail?: unknown, as?: { id?: number; name: string }): void {
      const id = as?.id ?? req?.user?.id ?? null;
      const name = as?.name ?? req?.user?.username ?? null;
      const text = detail === undefined ? null : typeof detail === 'string' ? detail : JSON.stringify(detail);
      insert.run(new Date().toISOString(), id, clip(name, 64), action, clip(target, 200), clip(text, 1000), req?.ip ?? null);
    },
    list(limit: number, before?: number): AuditEntry[] {
      return db
        .prepare('SELECT id, at, username, action, target, detail, ip FROM audit WHERE (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?')
        .all(before ?? null, before ?? null, limit) as AuditEntry[];
    },
    prune: () => void db.prepare('DELETE FROM audit WHERE at < ?').run(new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString()),
  };
};
export type Audit = ReturnType<typeof audit>;
