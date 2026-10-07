import crypto from 'node:crypto';
import type { Db } from '../db.js';
import type { UserRow } from './users.js';

const DAY = 86_400_000;
const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export const sessions = (db: Db, days: number) => {
  const ttl = days * DAY;
  return {
    /** Start a session; returns the token for the cookie (only its hash is stored). */
    create(userId: number): { token: string; expires: Date } {
      const token = crypto.randomBytes(32).toString('base64url');
      const now = Date.now();
      const expires = new Date(now + ttl);
      db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
        hashToken(token), userId, new Date(now).toISOString(), expires.toISOString(),
      );
      return { token, expires };
    },

    /** The user a token belongs to, or undefined when it is unknown, expired or the account is disabled. */
    find(token: string): UserRow | undefined {
      const id = hashToken(token);
      const row = db
        .prepare('SELECT u.*, s.expires_at AS s_expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND u.disabled = 0')
        .get(id) as (UserRow & { s_expires: string }) | undefined;
      if (!row) return undefined;
      const left = Date.parse(row.s_expires) - Date.now();
      if (left <= 0) {
        db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
        return undefined;
      }
      // sliding expiry: a session in use stays alive, written at most once a day
      if (left < ttl - DAY) db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(new Date(Date.now() + ttl).toISOString(), id);
      return row;
    },

    destroy: (token: string) => void db.prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(token)),
    destroyAllOf: (userId: number, exceptToken?: string) =>
      void db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, exceptToken ? hashToken(exceptToken) : ''),
    purgeExpired: () => void db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString()),
  };
};

export type Sessions = ReturnType<typeof sessions>;
