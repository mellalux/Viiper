import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { users } from '../src/auth/users.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { exportToDir, seedFromDir } from '../src/signs/files.js';

const dataDir = loadConfig().dataDir;
const text = (f: string) => fs.readFileSync(path.join(dataDir, f), 'utf8');

const db = openDb(':memory:');
seedFromDir(db, dataDir);
const accounts = users(db);
await accounts.create('admin', 'correct horse battery', 'admin');
await accounts.create('editor', 'another long password', 'editor');

const server = createApp(loadConfig({ dbPath: ':memory:', clientDist: null, secureCookies: false }), db).listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => {
  server.close();
  db.close();
});

/** A tiny client with its own cookie jar. */
function client() {
  let cookie = '';
  const call = async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...(cookie && { Cookie: cookie }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0]!.endsWith('=') ? '' : set.split(';')[0]!;
    const json = (await res.json().catch(() => null)) as any;
    return { status: res.status, json, headers: res.headers };
  };
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, body: unknown = {}, headers?: Record<string, string>) => call('POST', url, body, headers),
    put: (url: string, body: unknown) => call('PUT', url, body),
    patch: (url: string, body: unknown) => call('PATCH', url, body),
    del: (url: string) => call('DELETE', url, {}),
  };
}
const login = async (name: string, password: string) => {
  const c = client();
  const res = await c.post('/api/auth/login', { username: name, password });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  return c;
};

describe('the data files round-trip through the database', () => {
  it('serves exactly what the JSON files hold (with notes for editors)', async () => {
    const editor = await login('editor', 'another long password');
    const { json } = await editor.get('/api/data');
    assert.deepEqual(json.fingerspelling, JSON.parse(text('fingerspelling.json')));
    assert.deepEqual(json.words, JSON.parse(text('words.json')));
    assert.deepEqual(json.limits, JSON.parse(text('limits.json')));
    assert.deepEqual(Object.keys(json.words.signs), Object.keys(JSON.parse(text('words.json')).signs)); // order is kept
  });

  it('exports files identical to the ones it was seeded from', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'viiper-export-'));
    try {
      for (const f of ['fingerspelling.json', 'words.json', 'limits.json']) fs.copyFileSync(path.join(dataDir, f), path.join(tmp, f));
      fs.writeFileSync(path.join(tmp, 'words.json'), '{}'); // damaged on purpose: the export must repair it
      const written = exportToDir(db, tmp);
      assert.deepEqual(written, ['words.json']);
      for (const f of ['fingerspelling.json', 'words.json', 'limits.json']) assert.equal(fs.readFileSync(path.join(tmp, f), 'utf8').replace(/\r\n/g, '\n'), text(f).replace(/\r\n/g, '\n'), f);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('public access', () => {
  it('lets anyone read the data, without notes', async () => {
    const res = await client().get('/api/data');
    assert.equal(res.status, 200);
    assert.ok(Object.keys(res.json.words.signs).length > 10);
    assert.ok(!JSON.stringify(res.json).includes('"note"'));
    assert.equal(typeof res.json.versions.TERE, 'number');
  });

  it('refuses anonymous saves, history and user lists', async () => {
    const c = client();
    assert.equal((await c.put('/api/data', {})).status, 401);
    assert.equal((await c.get('/api/history/TERE')).status, 401);
    assert.equal((await c.get('/api/users')).status, 401);
  });
});

describe('login', () => {
  it('rejects a wrong password and an unknown user alike', async () => {
    const a = await client().post('/api/auth/login', { username: 'admin', password: 'wrong wrong wrong' });
    const b = await client().post('/api/auth/login', { username: 'nobody', password: 'wrong wrong wrong' });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.json.error, b.json.error);
  });

  it('starts a session with an httpOnly cookie, ends it on logout, and the user name is case-insensitive', async () => {
    const c = client();
    const res = await c.post('/api/auth/login', { username: 'ADMIN', password: 'correct horse battery' });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('set-cookie') ?? '', /HttpOnly/i);
    assert.match(res.headers.get('set-cookie') ?? '', /SameSite=Lax/i);
    assert.equal((await c.get('/api/auth/me')).json.user.username, 'admin');
    assert.equal(JSON.stringify(res.json).includes('password'), false);
    await c.post('/api/auth/logout');
    assert.equal((await c.get('/api/auth/me')).json.user, null);
  });

  it('refuses changes that are not JSON or come from another origin', async () => {
    const c = await login('editor', 'another long password');
    const res = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
    assert.equal(res.status, 415);
    assert.equal((await c.post('/api/auth/logout', {}, { Origin: 'https://evil.example' })).status, 403);
  });

  it('changes one’s own password and signs the other sessions out', async () => {
    await accounts.create('pwuser', 'first password 123', 'editor');
    const one = await login('pwuser', 'first password 123');
    const two = await login('pwuser', 'first password 123');
    assert.equal((await one.post('/api/auth/password', { current: 'nope nope nope', next: 'second password 123' })).status, 403);
    assert.equal((await one.post('/api/auth/password', { current: 'first password 123', next: 'short' })).status, 400);
    assert.equal((await one.post('/api/auth/password', { current: 'first password 123', next: 'second password 123' })).status, 200);
    assert.ok((await one.get('/api/auth/me')).json.user);
    assert.equal((await two.get('/api/auth/me')).json.user, null);
    await login('pwuser', 'second password 123');
  });
});

describe('accounts (admin only)', () => {
  it('is closed to editors', async () => {
    const editor = await login('editor', 'another long password');
    assert.equal((await editor.get('/api/users')).status, 403);
    assert.equal((await editor.post('/api/users', { username: 'x1x', password: 'long enough pw 1', role: 'admin' })).status, 403);
  });

  it('creates, disables and deletes accounts; a disabled account is signed out and cannot log in', async () => {
    const admin = await login('admin', 'correct horse battery');
    const made = await admin.post('/api/users', { username: 'temp.user', password: 'temporary pw 123', role: 'editor' });
    assert.equal(made.status, 201);
    assert.equal((await admin.post('/api/users', { username: 'TEMP.user', password: 'temporary pw 123', role: 'editor' })).status, 409);
    assert.equal((await admin.post('/api/users', { username: 'bad name!', password: 'temporary pw 123', role: 'editor' })).status, 400);
    assert.equal((await admin.post('/api/users', { username: 'weakling', password: 'short', role: 'editor' })).status, 400);

    const temp = await login('temp.user', 'temporary pw 123');
    const id = made.json.user.id;
    assert.equal((await admin.patch(`/api/users/${id}`, { disabled: true })).status, 200);
    assert.equal((await temp.get('/api/auth/me')).json.user, null);
    assert.equal((await client().post('/api/auth/login', { username: 'temp.user', password: 'temporary pw 123' })).status, 401);
    assert.equal((await admin.del(`/api/users/${id}`)).status, 200);
  });

  it('never removes the last active admin or lets one remove oneself', async () => {
    const admin = await login('admin', 'correct horse battery');
    const me = (await admin.get('/api/auth/me')).json.user.id;
    assert.equal((await admin.patch(`/api/users/${me}`, { role: 'editor' })).status, 409);
    assert.equal((await admin.patch(`/api/users/${me}`, { disabled: true })).status, 409);
    assert.equal((await admin.del(`/api/users/${me}`)).status, 409);
  });
});

describe('saving signs', () => {
  const motion = { path: [[0, 0, 0], [0.1, 0.2, 0]], duration: 1 };

  it('saves a definition and tweaks, bumps the version and keeps the note', async () => {
    const editor = await login('editor', 'another long password');
    const before = (await editor.get('/api/data')).json;
    const v = before.versions.TERE;
    const res = await editor.put('/api/data', { signs: { TERE: { base: v, def: { curl: [1, 1, 1, 1], thumb: 'rest', dir: 'up', motion }, tweaks: { RightHand: { rot: [1, 2, 3] } } } } });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.versions.TERE, v + 1);
    const after = (await editor.get('/api/data')).json.words.signs.TERE;
    assert.deepEqual(after.curl, [1, 1, 1, 1]);
    assert.deepEqual(after.tweaks, { RightHand: { rot: [1, 2, 3] } });
    assert.equal(after.note, before.words.signs.TERE.note);
    const hist = (await editor.get('/api/history/TERE')).json.history;
    assert.equal(hist[0].version, v + 1);
    assert.equal(hist[0].by, 'editor');
    // tweaks: {} takes them away again
    assert.equal((await editor.put('/api/data', { signs: { TERE: { base: v + 1, tweaks: {} } } })).status, 200);
    assert.equal((await editor.get('/api/data')).json.words.signs.TERE.tweaks, undefined);
  });

  it('answers 409 and writes nothing when somebody saved first', async () => {
    const a = await login('editor', 'another long password');
    const b = await login('admin', 'correct horse battery');
    const v = (await a.get('/api/data')).json.versions;
    const def = { curl: [0.5, 0.5, 0.5, 0.5], thumb: 'rest', dir: 'up' };
    assert.equal((await a.put('/api/data', { signs: { HEA: { base: v.HEA, def } } })).status, 200);
    const res = await b.put('/api/data', { signs: { HEA: { base: v.HEA, def }, JAH: { base: v.JAH, def } } });
    assert.equal(res.status, 409);
    assert.deepEqual(res.json.conflicts, ['HEA']);
    assert.equal((await a.get('/api/data')).json.versions.JAH, v.JAH, 'JAH must not have been saved');
  });

  it('creates a word sign, refuses a taken name, an alias and a bad name', async () => {
    const editor = await login('editor', 'another long password');
    const def = { curl: [0, 0, 0, 0], thumb: 'rest', dir: 'up' };
    assert.equal((await editor.put('/api/data', { signs: { 'UUS MÄRK': { create: true, def } } })).status, 200);
    const words = (await editor.get('/api/data')).json.words.signs;
    assert.equal(Object.keys(words).at(-1), 'UUS MÄRK');
    assert.equal((await editor.put('/api/data', { signs: { 'UUS MÄRK': { create: true, def } } })).status, 409);
    assert.equal((await editor.put('/api/data', { signs: { 'NAD': { create: true, def } } })).status, 409); // an alias
    assert.equal((await editor.put('/api/data', { signs: { 'väike': { create: true, def } } })).status, 400);
  });

  it('creates a letter (one upper-case letter) in the fingerspelling, not among the words', async () => {
    const editor = await login('editor', 'another long password');
    const def = { curl: [0, 0, 0, 0], thumb: 'rest', dir: 'up' };
    assert.equal((await editor.put('/api/data', { signs: { 'Å': { create: true, def } } })).status, 200);
    const data = (await editor.get('/api/data')).json;
    assert.equal(Object.keys(data.fingerspelling.signs).at(-1), 'Å');
    assert.ok(!('Å' in data.words.signs));
    assert.equal((await editor.put('/api/data', { signs: { 'Å': { create: true, def } } })).status, 409); // taken
    assert.equal((await editor.put('/api/data', { signs: { 'Q': { create: true, def } } })).status, 409); // an existing letter
    assert.equal((await editor.put('/api/data', { signs: { 'å': { create: true, def } } })).status, 400); // not upper case
    assert.equal((await editor.put('/api/data', { signs: { '%': { create: true, def } } })).status, 400); // a symbol is neither
    assert.equal((await editor.put('/api/data', { signs: { '7': { create: true, def } } })).status, 200); // a digit is a letter of the fingerspelling
    assert.ok('7' in (await editor.get('/api/data')).json.fingerspelling.signs);
  });

  it('refuses malformed definitions, tweaks and limits', async () => {
    const editor = await login('editor', 'another long password');
    const v = (await editor.get('/api/data')).json.versions;
    const put = (signs: unknown) => editor.put('/api/data', { signs });
    assert.equal((await put({ TERE: { base: v.TERE, def: { curl: [1, 2] } } })).status, 400);
    assert.equal((await put({ TERE: { base: v.TERE, def: { evil: 1 } } })).status, 400);
    assert.equal((await put({ TERE: { base: v.TERE, def: { motion: { path: [[0, 0]], duration: 1 } } } })).status, 400);
    assert.equal((await put({ TERE: { base: v.TERE, def: { motion: { path: [[0, 0], [0.1, 0]], duration: 1, smooth: 'yes' } } } })).status, 400);
    assert.equal((await put({ TERE: { base: v.TERE, tweaks: { Bone: { rot: [1, 2] } } } })).status, 400);
    assert.equal((await put({ NOPE: { base: 1, def: {} } })).status, 400);
    assert.equal((await editor.put('/api/data', { limits: { base: v['*limits'], bones: { Arm: { x: [10, -10] } } } })).status, 400);
  });

  it('saves the limits and the global tweaks with their own versions', async () => {
    const editor = await login('editor', 'another long password');
    const v = (await editor.get('/api/data')).json.versions;
    const res = await editor.put('/api/data', {
      limits: { base: v['*limits'], bones: { Head: { x: [-30, 30] } }, finger: { mcp: { curl: [-10, 90] } } },
      global: { base: v['*global'], tweaks: { Spine: { rot: [0, 5, 0] } } },
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const data = (await editor.get('/api/data')).json;
    assert.deepEqual(data.limits.bones, { Head: { x: [-30, 30] } });
    assert.deepEqual(data.limits.finger.mcp, { curl: [-10, 90] });
    assert.deepEqual(data.fingerspelling.global, { Spine: { rot: [0, 5, 0] } });
    assert.equal((await editor.put('/api/data', { limits: { base: v['*limits'], bones: {} } })).status, 409); // stale
  });

  it('saves the base poses and the thumb poses for everybody, and refuses malformed ones', async () => {
    const editor = await login('editor', 'another long password');
    const v = (await editor.get('/api/data')).json.versions;
    const up = { finger: [0, 1, 0], thumb: [1, 0, 0], reach: [-0.1, 0.22, 0.5], maxBend: 70 };
    const orient = (data: unknown) => editor.put('/api/data', { orients: { base: v['*orients'], data } });
    assert.equal((await orient({ up: { finger: [0, 1], thumb: [1, 0, 0], reach: [0, 0, 0] } })).status, 400); // a vector of 2
    assert.equal((await orient({ up: { ...up, evil: 1 } })).status, 400);
    assert.equal((await orient({ up: { ...up, maxBend: 500 } })).status, 400);
    const joints = [[0, 0, 0.5], [0.1, 0, 0], [0, 0, 0]];
    assert.equal((await editor.put('/api/data', { thumbPoses: { base: v['*thumbPoses'], data: { cc: { up: { joints: [[0, 0, 0]] } } } } })).status, 400);

    const res = await editor.put('/api/data', { orients: { base: v['*orients'], data: { up } }, thumbPoses: { base: v['*thumbPoses'], data: { cc: { up: { joints } } } } });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const seen = (await client().get('/api/data')).json; // somebody who is not signed in sees them
    assert.deepEqual(seen.orients, { up });
    assert.deepEqual(seen.thumbPoses, { cc: { up: { joints } } });
    assert.equal(seen.versions['*orients'], (v['*orients'] ?? 0) + 1);
    // another rig's poses are kept when one rig is saved; a stale save is a conflict
    const w = (await editor.get('/api/data')).json.versions;
    assert.equal((await editor.put('/api/data', { thumbPoses: { base: w['*thumbPoses'], data: { rigify: { up: { joints } } } } })).status, 200);
    assert.deepEqual(Object.keys((await editor.get('/api/data')).json.thumbPoses).sort(), ['cc', 'rigify']);
    assert.equal((await editor.put('/api/data', { orients: { base: v['*orients'], data: {} } })).status, 409);
    assert.equal((await client().put('/api/data', { orients: { base: 0, data: {} } })).status, 401);
  });
});

describe('audit log', () => {
  it('is for admins only', async () => {
    const editor = await login('editor', 'another long password');
    assert.equal((await editor.get('/api/audit')).status, 403);
    assert.equal((await client().get('/api/audit')).status, 401);
  });

  it('records sign-ins (also failed ones), account changes and saves, newest first, and never a password', async () => {
    const admin = await login('admin', 'correct horse battery');
    await client().post('/api/auth/login', { username: 'admin', password: 'definitely wrong pw' });
    await admin.post('/api/users', { username: 'audited', password: 'secret audit password', role: 'editor' });
    const entries = (await admin.get('/api/audit')).json.entries as { username: string | null; action: string; target: string | null; detail: string | null; ip: string | null }[];
    const actions = entries.map((e) => e.action);
    assert.ok(actions.includes('login') && actions.includes('login_failed') && actions.includes('user_create') && actions.includes('sign_save'), actions.join());
    assert.equal(entries[0]!.action, 'user_create');
    assert.equal(entries[0]!.username, 'admin');
    assert.equal(entries[0]!.target, 'audited');
    assert.ok(entries.find((e) => e.action === 'sign_save')!.username === 'editor');
    assert.ok(entries.find((e) => e.action === 'login_failed')!.ip);
    assert.ok(!JSON.stringify(entries).includes('secret audit password'));
    const page = (await admin.get(`/api/audit?limit=1`)).json.entries;
    assert.equal(page.length, 1);
  });
});
