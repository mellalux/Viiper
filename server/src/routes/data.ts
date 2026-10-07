import { Router } from 'express';
import type { Db } from '../db.js';
import { applyChanges, history, readData } from '../signs/store.js';
import { requireUser } from '../middleware.js';

export function dataRoutes(db: Db): Router {
  const router = Router();

  // Public: what the site shows (the signs, the aliases, the limits). Notes are for people reading the data: only editors get them.
  router.get('/data', (req, res) => {
    res.set('Cache-Control', 'no-cache'); // always revalidate (the ETag makes that cheap); an edit shows at once
    res.vary('Cookie');
    res.json(readData(db, { notes: !!req.user }));
  });

  // Signed-in users: save changes; see data/store.ts (applyChanges) for the body
  router.put('/data', requireUser, (req, res) => {
    const versions = applyChanges(db, req.user!.id, req.body);
    res.json({ versions });
  });

  // the saves of one sign (or "*global", "*limits"), newest first
  router.get('/history/:target', requireUser, (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    res.json({ history: history(db, String(req.params.target), limit) });
  });

  return router;
}
