import { Router } from 'express';
import type { Db } from '../db.js';
import { applyChanges, history, readData } from '../signs/store.js';
import type { Audit } from '../audit.js';
import { requireRole, requireUser } from '../middleware.js';

export function dataRoutes(db: Db, audit: Audit): Router {
  const router = Router();

  // Public: what the site shows (the signs, the aliases, the limits). Notes are for people reading the data: only editors get them.
  router.get('/data', (req, res) => {
    res.set('Cache-Control', 'no-store'); // never kept by the browser or a proxy in front: an edit shows at once everywhere
    res.vary('Cookie');
    res.json(readData(db, { notes: !!req.user }));
  });

  // Signed-in users: save changes; see data/store.ts (applyChanges) for the body
  router.put('/data', requireUser, (req, res) => {
    const versions = applyChanges(db, req.user!.id, req.body);
    audit.log(req, 'sign_save', Object.keys(versions).join(', '), versions);
    res.json({ versions });
  });

  // the saves of one sign (or "*global", "*limits"), newest first
  router.get('/history/:target', requireUser, (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    res.json({ history: history(db, String(req.params.target), limit) });
  });

  // admins: the audit log, newest first (`before` = the id of the last row seen, for the next page)
  router.get('/audit', requireRole('admin'), (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const before = Number(req.query.before) || undefined;
    res.set('Cache-Control', 'no-store');
    res.json({ entries: audit.list(limit, before) });
  });

  return router;
}
