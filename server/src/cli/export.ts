// npm run export: write the database's signs into client/src/data/*.json (fingerspelling, words, limits) in the compact layout,
// so they can be committed to git and are what the next client build is bundled with (the site's offline fallback).
import { loadConfig } from '../config.js';
import { openDb } from '../db.js';
import { exportToDir } from '../signs/files.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const written = exportToDir(db, config.dataDir);
console.log(written.length ? `Wrote ${written.join(', ')} to ${config.dataDir}` : 'The files are up to date.');
db.close();
