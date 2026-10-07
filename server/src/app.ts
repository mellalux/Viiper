import path from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { sessions as makeSessions } from './auth/sessions.js';
import { errorHandler, guardChanges, loadSession, notFound } from './middleware.js';
import { authRoutes } from './routes/auth.js';
import { dataRoutes } from './routes/data.js';
import { userRoutes } from './routes/users.js';

export function createApp(config: Config, db: Db): Express {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);

  app.use(
    helmet({
      // the page builds its panels with inline <style>, and three.js reads textures from blob: / data: URLs
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'wasm-unsafe-eval'"], // the Meshopt decoder that unpacks the model is WebAssembly
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'", 'data:', 'blob:'],
          workerSrc: ["'self'", 'blob:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.secureCookies ? [] : null, // only where the site is served over https
        },
      },
      hsts: config.production,
    }),
  );

  const sessions = makeSessions(db, config.sessionDays);
  // who is asking and where from is settled before any body is read; the data save is the only big request
  app.use('/api', cookieParser(), loadSession(sessions, config), guardChanges(config));
  app.use('/api/data', express.json({ limit: '2mb' }));
  app.use('/api', express.json({ limit: '16kb' }));

  app.get('/api/health', (_req, res) => void res.json({ ok: true }));
  app.use('/api/auth', authRoutes(db, config, sessions));
  app.use('/api/users', userRoutes(db, sessions));
  app.use('/api', dataRoutes(db));
  app.use('/api', notFound);

  if (config.clientDist) {
    const dist = path.resolve(config.clientDist);
    // the bundle's file names carry a hash, so they can be cached for good; the page itself is always revalidated
    app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }));
    app.use(express.static(dist, { maxAge: '1h', setHeaders: (res, file) => file.endsWith('.html') && res.setHeader('Cache-Control', 'no-cache') }));
    app.get(/^(?!\/api\/).*/, (_req, res) => void res.sendFile(path.join(dist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
