import type { Db } from '../db.js';
import { HttpError } from '../auth/users.js';
import { SIGN_FIELDS, buildLimits, canon, checkDef, checkSignName, checkTweaks, isObject, type Json, type Obj } from './validate.js';

// The signs are kept as documents: one row per sign holding its definition and its bone tweaks as JSON. The API hands them out in
// the shape of the client's data files (fingerspelling.json, words.json, limits.json), so the client reads either.

export interface SignRow {
  key: string;
  kind: 'letter' | 'word';
  position: number;
  def: string;
  tweaks: string | null;
  version: number;
}
interface SettingRow {
  key: string;
  value: string;
  version: number;
}

export interface SignData {
  fingerspelling: { signs: Obj; global: Obj };
  words: { aliases: Obj; signs: Obj };
  limits: Obj;
  /** Save counter of every sign and of "*global" and "*limits": what an edit is based on (see applyChanges). */
  versions: Record<string, number>;
}

const now = () => new Date().toISOString();

const stripNotes = (v: Json): Json => {
  if (Array.isArray(v)) return v.map(stripNotes);
  if (isObject(v)) return Object.fromEntries(Object.entries(v).filter(([k, x]) => !(k === 'note' && typeof x === 'string')).map(([k, x]) => [k, stripNotes(x)]));
  return v;
};

export function readData(db: Db, { notes }: { notes: boolean }): SignData {
  const signs: Record<'letter' | 'word', Obj> = { letter: {}, word: {} };
  const versions: Record<string, number> = {};
  const rows = db.prepare('SELECT key, kind, def, tweaks, version FROM signs ORDER BY kind, position').all() as SignRow[];
  for (const r of rows) {
    const sign: Obj = JSON.parse(r.def);
    if (r.tweaks) sign.tweaks = JSON.parse(r.tweaks);
    signs[r.kind][r.key] = sign;
    versions[r.key] = r.version;
  }
  const settings = new Map((db.prepare('SELECT key, value, version FROM settings').all() as SettingRow[]).map((s) => [s.key, s]));
  const setting = (key: string): Obj => {
    const s = settings.get(key);
    versions[`*${key}`] = s?.version ?? 0;
    return s ? JSON.parse(s.value) : {};
  };
  const data: SignData = {
    fingerspelling: { signs: signs.letter, global: setting('global') },
    words: { aliases: setting('aliases'), signs: signs.word },
    limits: setting('limits'),
    versions,
  };
  return notes ? data : { ...(stripNotes(data as unknown as Json) as unknown as SignData), versions };
}

/** What the editor sends: the signs it changed, each with the version it started from, and optionally the global tweaks and the limits. */
export interface Changes {
  signs?: Record<string, { create?: boolean; base?: number | null; def?: unknown; tweaks?: unknown }>;
  global?: { tweaks: unknown; base: number };
  limits?: { base: number; bones: unknown; finger?: unknown };
}

const readSetting = (db: Db, key: string) => db.prepare('SELECT value, version FROM settings WHERE key = ?').get(key) as { value: string; version: number } | undefined;

/** The definition fields of a sign, in the order they are written. */
const pickDef = (def: Obj): Obj => Object.fromEntries(SIGN_FIELDS.filter((f) => def[f] !== undefined).map((f) => [f, def[f] as Json]));

/**
 * Save the changes in one transaction. A sign (or the global tweaks, or the limits) that someone else saved since `base` is a conflict:
 * nothing is written then and the answer is 409 with the names of the conflicting ones. Returns the new versions of what was saved.
 */
export function applyChanges(db: Db, userId: number, body: unknown): Record<string, number> {
  if (!isObject(body)) throw new HttpError(400, 'Oodati objekti.');
  const changes = body as Changes;
  if (changes.signs !== undefined && !isObject(changes.signs)) throw new HttpError(400, '"signs" peab olema objekt.');

  const get = db.prepare('SELECT key, kind, position, def, tweaks, version FROM signs WHERE key = ?');
  const insert = db.prepare('INSERT INTO signs (key, kind, position, def, tweaks, version, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, 1, ?, ?)');
  const update = db.prepare('UPDATE signs SET def = ?, tweaks = ?, version = ?, updated_at = ?, updated_by = ? WHERE key = ?');
  const log = db.prepare('INSERT INTO history (target, version, data, user_id, at) VALUES (?, ?, ?, ?, ?)');
  const putSetting = db.prepare(
    'INSERT INTO settings (key, value, version, updated_at, updated_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, version = excluded.version, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
  );

  return db.transaction(() => {
    const at = now();
    const saved: Record<string, number> = {};
    const conflicts: string[] = [];

    for (const [key, ch] of Object.entries(changes.signs ?? {})) {
      if (!isObject(ch)) throw new HttpError(400, `Vigane muudatus märgile "${key}".`);
      const row = get.get(key) as SignRow | undefined;
      const hasDef = ch.def !== undefined;
      const hasTweaks = ch.tweaks !== undefined;
      if (hasDef) checkDef(ch.def);
      if (hasTweaks && ch.tweaks !== null) checkTweaks(ch.tweaks);
      const tweaks = isObject(ch.tweaks) && Object.keys(ch.tweaks).length ? ch.tweaks : null; // none left = the sign has no tweaks

      if (ch.create) {
        checkSignName(key);
        const aliases = readSetting(db, 'aliases');
        if (row || (aliases && key in JSON.parse(aliases.value))) throw new HttpError(409, `Märk "${key}" on juba olemas.`, { conflicts: [key] });
        const last = db.prepare("SELECT COALESCE(MAX(position), -1) AS p FROM signs WHERE kind = 'word'").get() as { p: number };
        const def = hasDef ? pickDef(ch.def as Obj) : {};
        insert.run(key, 'word', last.p + 1, JSON.stringify(def), tweaks ? JSON.stringify(tweaks) : null, at, userId);
        log.run(key, 1, JSON.stringify({ def, tweaks }), userId, at);
        saved[key] = 1;
        continue;
      }

      if (!row) throw new HttpError(400, `Tundmatu märk "${key}".`);
      if (ch.base !== row.version) {
        conflicts.push(key);
        continue;
      }
      const oldDef: Obj = JSON.parse(row.def);
      const oldTweaks: Obj | null = row.tweaks ? JSON.parse(row.tweaks) : null;
      const def = hasDef ? { ...(oldDef.note !== undefined && { note: oldDef.note }), ...pickDef(ch.def as Obj) } : oldDef;
      const nextTweaks = hasTweaks ? tweaks : oldTweaks;
      if (canon(def) === canon(oldDef) && canon(nextTweaks) === canon(oldTweaks)) {
        saved[key] = row.version; // nothing really changed
        continue;
      }
      const version = row.version + 1;
      update.run(JSON.stringify(def), nextTweaks ? JSON.stringify(nextTweaks) : null, version, at, userId, key);
      log.run(key, version, JSON.stringify({ def, tweaks: nextTweaks }), userId, at);
      saved[key] = version;
    }

    const setting = (name: string, base: unknown, next: Obj) => {
      const cur = readSetting(db, name);
      if ((cur?.version ?? 0) !== base) return void conflicts.push(`*${name}`);
      if (cur && canon(JSON.parse(cur.value)) === canon(next)) return void (saved[`*${name}`] = cur.version);
      const version = (cur?.version ?? 0) + 1;
      putSetting.run(name, JSON.stringify(next), version, at, userId);
      log.run(`*${name}`, version, JSON.stringify(next), userId, at);
      saved[`*${name}`] = version;
    };
    if (changes.global !== undefined) {
      if (!isObject(changes.global)) throw new HttpError(400, 'Vigane "global".');
      checkTweaks(changes.global.tweaks);
      setting('global', changes.global.base, changes.global.tweaks);
    }
    if (changes.limits !== undefined) {
      if (!isObject(changes.limits)) throw new HttpError(400, 'Vigased "limits".');
      const old = readSetting(db, 'limits');
      setting('limits', changes.limits.base, buildLimits(changes.limits, old ? JSON.parse(old.value) : {}));
    }

    if (conflicts.length) throw new HttpError(409, 'Keegi teine on neid vahepeal salvestanud.', { conflicts });
    return saved;
  })();
}

export interface HistoryEntry {
  version: number;
  at: string;
  by: string | null;
  data: Json;
}
export function history(db: Db, target: string, limit = 50): HistoryEntry[] {
  const rows = db
    .prepare('SELECT h.version, h.at, h.data, u.username AS by FROM history h LEFT JOIN users u ON u.id = h.user_id WHERE h.target = ? ORDER BY h.id DESC LIMIT ?')
    .all(target, limit) as { version: number; at: string; data: string; by: string | null }[];
  return rows.map((r) => ({ version: r.version, at: r.at, by: r.by, data: JSON.parse(r.data) }));
}

/** Fill an empty database from the client's JSON files. Does nothing when there are signs already. Returns how many signs were added. */
export function seedFromFiles(db: Db, files: { fingerspelling: Obj; words: Obj; limits: Obj }): number {
  const have = (db.prepare('SELECT COUNT(*) AS n FROM signs').get() as { n: number }).n;
  if (have) return 0;
  const at = now();
  const insert = db.prepare('INSERT INTO signs (key, kind, position, def, tweaks, version, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?)');
  const putSetting = db.prepare('INSERT INTO settings (key, value, version, updated_at) VALUES (?, ?, 1, ?)');
  let n = 0;
  db.transaction(() => {
    const add = (kind: 'letter' | 'word', signs: unknown) => {
      Object.entries(isObject(signs) ? signs : {}).forEach(([key, raw], position) => {
        const { tweaks, ...def } = raw as Obj;
        insert.run(key, kind, position, JSON.stringify(def), isObject(tweaks) && Object.keys(tweaks).length ? JSON.stringify(tweaks) : null, at);
        n++;
      });
    };
    add('letter', files.fingerspelling.signs);
    add('word', files.words.signs);
    putSetting.run('global', JSON.stringify(files.fingerspelling.global ?? {}), at);
    putSetting.run('aliases', JSON.stringify(files.words.aliases ?? {}), at);
    putSetting.run('limits', JSON.stringify(files.limits ?? {}), at);
  })();
  return n;
}
