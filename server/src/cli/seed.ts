// npm run seed: fill an EMPTY database from client/src/data/*.json (the server does this on start too; this shows what happened).
import { loadConfig } from '../config.js';
import { openDb } from '../db.js';
import { hasDataFiles, seedFromDir } from '../signs/files.js';

const config = loadConfig();
if (!hasDataFiles(config.dataDir)) {
  console.error(`No data files in ${config.dataDir}`);
  process.exit(1);
}
const db = openDb(config.dbPath);
const n = seedFromDir(db, config.dataDir);
console.log(n ? `Seeded ${n} signs from ${config.dataDir} into ${config.dbPath}` : 'The database has signs already; nothing seeded.');
db.close();
