import { createApp } from './app.js';
import { users } from './auth/users.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { hasDataFiles, seedFromDir } from './signs/files.js';

const config = loadConfig();
const db = openDb(config.dbPath);

// an empty database starts from the client's JSON files
if (hasDataFiles(config.dataDir)) {
  const n = seedFromDir(db, config.dataDir);
  if (n) console.log(`[server] seeded ${n} signs from ${config.dataDir}`);
}

// the first admin: from ADMIN_USER / ADMIN_PASSWORD (handy on a new host), or with `npm run user -- add NAME --role admin`
const accounts = users(db);
if (!accounts.list().length) {
  const { ADMIN_USER, ADMIN_PASSWORD } = process.env;
  if (ADMIN_USER && ADMIN_PASSWORD) {
    await accounts.create(ADMIN_USER, ADMIN_PASSWORD, 'admin');
    console.log(`[server] created the admin account "${ADMIN_USER}"`);
  } else {
    console.warn('[server] there are no accounts yet: npm run user -- add <name> --role admin');
  }
}

const app = createApp(config, db);
const server = app.listen(config.port, () => {
  console.log(`[server] http://localhost:${config.port} (${config.production ? 'production' : 'development'}, db ${config.dbPath})`);
});

const stop = () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
