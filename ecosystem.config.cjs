// pm2: npm run build && pm2 start ecosystem.config.cjs   (then: pm2 save && pm2 startup, once per host)
// Reload after an update: npm ci && npm run build && pm2 reload viiper
//
// Secrets (ADMIN_USER / ADMIN_PASSWORD) are not kept here: set them in the shell for the first start only, e.g.
//   ADMIN_USER=meelis ADMIN_PASSWORD=... pm2 start ecosystem.config.cjs --update-env
module.exports = {
  apps: [
    {
      name: 'viiper',
      cwd: __dirname,
      script: 'server/dist/index.js',
      // one process: SQLite is a single file and the login rate limits are kept in memory, so do not use cluster mode
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '300M',
      kill_timeout: 6000, // the server closes the database on SIGINT/SIGTERM
      pmx: false, // as in LifeSimu: pm2's module auto-instrumentation has crashed apps on the FreeBSD host
      // Only what is set here goes in. PORT, HOST, DB_PATH ... come from the .env file in this folder (the server reads it itself),
      // or, when the host hands them out as real environment variables (Elkdata: ELKDATA_APP_IP, PORT), from those.
      env: {
        NODE_ENV: 'production',
        TRUST_PROXY: '1', // behind Apache / nginx / Caddy; remove when the port is exposed directly
        ...(process.env.PORT && { PORT: process.env.PORT }),
        ...((process.env.ELKDATA_APP_IP || process.env.HOST) && { HOST: process.env.ELKDATA_APP_IP || process.env.HOST }),
      },
    },
  ],
};
