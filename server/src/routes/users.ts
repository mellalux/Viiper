import { Router } from 'express';
import type { Db } from '../db.js';
import type { Sessions } from '../auth/sessions.js';
import { HttpError, ROLES, toPublic, users, type Role } from '../auth/users.js';
import type { Audit } from '../audit.js';
import { requireRole } from '../middleware.js';

/** Account management; admins only. */
export function userRoutes(db: Db, sessions: Sessions, audit: Audit): Router {
  const router = Router();
  const accounts = users(db);
  router.use(requireRole('admin'));

  const idOf = (raw: string | string[] | undefined) => {
    const id = Number(raw);
    const user = Number.isInteger(id) ? accounts.byId(id) : undefined;
    if (!user) throw new HttpError(404, 'Sellist kasutajat pole.');
    return user;
  };

  router.get('/', (_req, res) => void res.json({ users: accounts.list() }));

  router.post('/', async (req, res) => {
    const { username, password, role } = req.body ?? {};
    const user = await accounts.create(username, password, role ?? 'editor');
    audit.log(req, 'user_create', user.username, { role: user.role });
    res.status(201).json({ user: toPublic(user) });
  });

  router.patch('/:id', async (req, res) => {
    const user = idOf(req.params.id);
    const { role, disabled, password } = req.body ?? {};
    if (role !== undefined && !ROLES.includes(role)) throw new HttpError(400, 'Roll peab olema "admin" või "editor".');
    if (disabled !== undefined && typeof disabled !== 'boolean') throw new HttpError(400, '"disabled" peab olema true või false.');
    const losesAdmin = user.role === 'admin' && !user.disabled && ((role !== undefined && role !== 'admin') || disabled === true);
    if (losesAdmin && accounts.activeAdmins() <= 1) throw new HttpError(409, 'Viimast aktiivset administraatorit ei saa eemaldada ega keelata.');
    if (user.id === req.user!.id && disabled === true) throw new HttpError(409, 'Iseennast ei saa keelata.');
    if (password !== undefined) await accounts.setPassword(user.id, password);
    if (role !== undefined) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role as Role, user.id);
    if (disabled !== undefined) db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, user.id);
    if (password !== undefined || disabled === true) sessions.destroyAllOf(user.id, user.id === req.user!.id ? req.sessionToken : undefined);
    audit.log(req, 'user_update', user.username, { ...(role !== undefined && { role }), ...(disabled !== undefined && { disabled }), ...(password !== undefined && { password: 'uus parool' }) });
    res.json({ user: toPublic(accounts.byId(user.id)!) });
  });

  router.delete('/:id', (req, res) => {
    const user = idOf(req.params.id);
    if (user.id === req.user!.id) throw new HttpError(409, 'Iseennast ei saa kustutada.');
    if (user.role === 'admin' && !user.disabled && accounts.activeAdmins() <= 1) throw new HttpError(409, 'Viimast aktiivset administraatorit ei saa kustutada.');
    audit.log(req, 'user_delete', user.username);
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id); // sessions go with it; the history keeps the signs' edits without a name
    res.json({ ok: true });
  });

  return router;
}
