import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { HttpError, type Role, type UserRow } from './auth/users.js';
import type { Sessions } from './auth/sessions.js';
import type { Config } from './config.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: UserRow;
    sessionToken?: string;
  }
}

export const cookieName = (config: Config) => (config.secureCookies ? '__Host-viiper_sid' : 'viiper_sid');

/** Looks the session cookie up on every request; `req.user` is set when it belongs to an active account. */
export const loadSession =
  (sessions: Sessions, config: Config): RequestHandler =>
  (req, _res, next) => {
    const token = req.cookies?.[cookieName(config)];
    if (typeof token === 'string' && token) {
      const user = sessions.find(token);
      if (user) {
        req.user = user;
        req.sessionToken = token;
      }
    }
    next();
  };

/**
 * Cross-site request forgery: the session cookie is SameSite=Lax already; on top of that every change must be JSON (which a
 * foreign page cannot send without a CORS preflight, and the API grants none) and come from this site when the browser says where from.
 */
export const guardChanges =
  (config: Config): RequestHandler =>
  (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    if (!req.is('application/json')) return void res.status(415).json({ error: 'Oodati Content-Type: application/json.' });
    const origin = req.get('origin');
    if (origin) {
      let host: string | null = null;
      try {
        host = new URL(origin).host;
      } catch {}
      if (host !== req.get('host') && !config.allowedOrigins.includes(origin)) return void res.status(403).json({ error: 'Päring tuli teiselt saidilt.' });
    }
    next();
  };

export const requireUser: RequestHandler = (req, res, next) => {
  if (!req.user) return void res.status(401).json({ error: 'Pead sisse logima.' });
  next();
};

export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, res, next) => {
    if (!req.user) return void res.status(401).json({ error: 'Pead sisse logima.' });
    if (!roles.includes(req.user.role)) return void res.status(403).json({ error: 'Selleks pole õigust.' });
    next();
  };

export const notFound: RequestHandler = (_req, res) => void res.status(404).json({ error: 'Not found' });

export const errorHandler: ErrorRequestHandler = (err, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message, ...err.extra });
  if (err?.type === 'entity.parse.failed') return void res.status(400).json({ error: 'Vigane JSON.' });
  if (err?.type === 'entity.too.large') return void res.status(413).json({ error: 'Päring on liiga suur.' });
  if (typeof err?.status === 'number' && err.status >= 400 && err.status < 500) return void res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Serveri viga.' });
};
