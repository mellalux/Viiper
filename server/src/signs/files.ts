import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db.js';
import { serializeLimits, serializeSigns } from './format.js';
import { readData, seedFromFiles } from './store.js';
import type { Obj } from './validate.js';

// The client's data files (client/src/data): the first content of the database, the offline fallback the site is bundled with,
// and what `npm run export` writes back so the signs can live in git too.

const FILES = { fingerspelling: 'fingerspelling.json', words: 'words.json', limits: 'limits.json' } as const;

export const hasDataFiles = (dir: string) => Object.values(FILES).every((f) => fs.existsSync(path.join(dir, f)));

const readJson = (file: string): Obj => JSON.parse(fs.readFileSync(file, 'utf8'));

/** Seed an empty database from the JSON files. Returns how many signs were added. */
export function seedFromDir(db: Db, dir: string): number {
  return seedFromFiles(db, {
    fingerspelling: readJson(path.join(dir, FILES.fingerspelling)),
    words: readJson(path.join(dir, FILES.words)),
    limits: readJson(path.join(dir, FILES.limits)),
  });
}

/** Write the database's signs into the JSON files (with the notes), each keeping its own line endings. Returns the files written. */
export function exportToDir(db: Db, dir: string): string[] {
  const data = readData(db, { notes: true });
  const out: [string, string][] = [
    [FILES.fingerspelling, serializeSigns(data.fingerspelling)],
    [FILES.words, serializeSigns(data.words)],
    [FILES.limits, serializeLimits(data.limits)],
  ];
  const written: string[] = [];
  for (const [name, text] of out) {
    const file = path.join(dir, name);
    const eol = fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('\r\n') ? '\r\n' : '\n';
    const next = text.replace(/\n/g, eol);
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === next) continue;
    fs.writeFileSync(file, next);
    written.push(name);
  }
  return written;
}
