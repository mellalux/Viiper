import { Router, type Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import type { Db } from '../db.js';
import type { Config } from '../config.js';
import type { Sessions } from '../auth/sessions.js';
import { dummyHash, verifyPassword } from '../auth/password.js';
import { HttpError, toPublic, users } from '../auth/users.js';
import { cookieName, requireUser } from '../middleware.js';

export function authRoutes(db: Db, config: Config, sessions: Sessions): Router {
  const router = Router();
  const accounts = users(db);

  const setCookie = (res: Response, token: string, expires: Date) =>
    res.cookie(cookieName(config), token, { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, path: '/', expires });

  // wrong guesses are counted per IP and per IP + account; a correct login does not count
  const tooMany = (_req: unknown, res: Response) => void res.status(429).json({ error: 'Liiga palju sisselogimiskatseid, proovi hiljem uuesti.' });
  const limits = [
    rateLimit({ windowMs: 15 * 60_000, limit: config.loginMaxPerIp, skipSuccessfulRequests: true, standardHeaders: 'draft-7', legacyHeaders: false, handler: tooMany }),
    rateLimit({
      windowMs: 15 * 60_000,
      limit: config.loginMaxFailsPerAccount,
      skipSuccessfulRequests: true,
      standardHeaders: false,
      legacyHeaders: false,
      keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}|${String(req.body?.username ?? '').toLowerCase()}`,
      handler: tooMany,
    }),
  ];

  router.post('/login', ...limits, async (req, res) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string') throw new HttpError(400, 'Sisesta kasutajanimi ja parool.');
    const user = accounts.byName(username);
    const ok = await verifyPassword(password, user && !user.disabled ? user.password_hash : await dummyHash());
    if (!user || user.disabled || !ok) throw new HttpError(401, 'Vale kasutajanimi või parool.');
    const { token, expires } = sessions.create(user.id);
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), user.id);
    sessions.purgeExpired();
    setCookie(res, token, expires);
    res.json({ user: toPublic(user) });
  });

  router.post('/logout', (req, res) => {
    if (req.sessionToken) sessions.destroy(req.sessionToken);
    res.clearCookie(cookieName(config), { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, path: '/' });
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ user: req.user ? toPublic(req.user) : null });
  });

  // change one's own password; every other session of the account is signed out
  router.post('/password', requireUser, async (req, res) => {
    const { current, next } = req.body ?? {};
    const user = req.user!;
    if (typeof current !== 'string' || !(await verifyPassword(current, user.password_hash))) throw new HttpError(403, 'Praegune parool on vale.');
    await accounts.setPassword(user.id, next);
    sessions.destroyAllOf(user.id, req.sessionToken);
    res.json({ ok: true });
  });

  return router;
}
