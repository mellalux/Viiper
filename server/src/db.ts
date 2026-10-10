import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

// Each entry upgrades the schema by one version (PRAGMA user_version). Never edit one that has shipped: add a new one.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin', 'editor')),
    disabled      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    last_login_at TEXT
  );

  -- the id is the SHA-256 of the cookie's token, so a leaked database cannot be used to sign in
  CREATE TABLE sessions (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  -- one row per sign (letter or word): "def" holds the sign's definition (curl, motion, ... and the note), "tweaks" its bone tweaks;
  -- both are JSON in the same shape as the client's data files. "version" counts the saves (for edit conflicts).
  CREATE TABLE signs (
    key        TEXT PRIMARY KEY,
    kind       TEXT NOT NULL CHECK (kind IN ('letter', 'word')),
    position   INTEGER NOT NULL,
    def        TEXT NOT NULL,
    tweaks     TEXT,
    version    INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  );

  -- what is not a sign: "aliases" (typed form -> sign), "global" (the body's tweaks), "limits" (bone and finger rotation limits)
  CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    version    INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  );

  -- every save: the state a sign (or "*global", "*limits") was saved into
  CREATE TABLE history (
    id      INTEGER PRIMARY KEY,
    target  TEXT NOT NULL,
    version INTEGER NOT NULL,
    data    TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    at      TEXT NOT NULL
  );
  CREATE INDEX history_target ON history(target, id);
  `,
  `
  -- who did what (sign-ins, account changes, saves); the user name is copied in so a row survives its account
  CREATE TABLE audit (
    id       INTEGER PRIMARY KEY,
    at       TEXT NOT NULL,
    user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    username TEXT,
    action   TEXT NOT NULL,
    target   TEXT,
    detail   TEXT,
    ip       TEXT
  );
  CREATE INDEX audit_at ON audit(at);
  `,
];

export function openDb(file: string): Db {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  cacheStatements(db);
  return db;
}

/**
 * Every statement is prepared once and reused. The code prepares its (fixed) SQL where it runs, and a statement thrown away after each
 * request is destroyed by the garbage collector, which has crashed node on some hosts inside better-sqlite3's Statement destructor
 * ("Assertion failed: (env) != nullptr"). Cached statements are only freed when the database is closed.
 */
function cacheStatements(db: Db): void {
  const prepare = db.prepare.bind(db) as (sql: string) => Database.Statement;
  const cache = new Map<string, Database.Statement>();
  db.prepare = ((sql: string) => {
    let statement = cache.get(sql);
    if (!statement) cache.set(sql, (statement = prepare(sql)));
    return statement;
  }) as Db['prepare'];
}

function migrate(db: Db): void {
  const from = db.pragma('user_version', { simple: true }) as number;
  for (let v = from; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
