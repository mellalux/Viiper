import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Dev-only: lets the editor panel's "Salvesta faili" button write its tweaks into src/data/signs.json.
// Writing needs the PIN kept in .save-pin (git-ignored; edit the file to change it). The server checks it, not the page.
const SAVE_URL = '/__save-sign-tweaks';
const SIGNS_FILE = 'src/data/signs.json';
const PIN_FILE = '.save-pin';
const MAX_WRONG_PINS = 5; // this many wrong PINs in a row lock saving for a minute
const LOCK_MS = 60_000;

// Keep the file readable in diffs: one orient / thumb pose / sign / global bone per line; a sign that carries tweaks
// gets its base fields on one line and one bone per line below.
const inline = (v) =>
  Array.isArray(v) ? `[${v.map(inline).join(', ')}]`
  : v && typeof v === 'object' ? (Object.keys(v).length ? `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ')} }` : '{}')
  : JSON.stringify(v);
const pad = (depth) => '  '.repeat(depth);
const block = (obj, depth, line) => {
  const entries = Object.entries(obj);
  if (!entries.length) return '{}';
  const rows = entries.map(([k, v]) => `${pad(depth + 1)}${JSON.stringify(k)}: ${line(v, depth + 1, k)}`);
  return `{\n${rows.join(',\n')}\n${pad(depth)}}`;
};
const sign = (s, depth) => {
  const { tweaks, ...base } = s;
  if (!tweaks || !Object.keys(tweaks).length) return inline(s);
  const fields = Object.entries(base).map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`).join(', ');
  // (an undefined sign has no base fields, only tweaks)
  return `{\n${fields ? `${pad(depth + 1)}${fields},\n` : ''}${pad(depth + 1)}"tweaks": ${block(tweaks, depth + 1, inline)}\n${pad(depth)}}`;
};
// rigs: { cc: { thumbPoses: { across: {...} }, visemes: { A: {...} } } } - one pose / viseme per line
const rigs = (v, depth) => block(v, depth, (rig, d) => block(rig, d, (section, d2) => block(section, d2, inline)));
export const serialize = (data) =>
  `${block(data, 0, (v, depth, key) => (key === 'signs' ? block(v, depth, sign) : key === 'rigs' ? rigs(v, depth) : block(v, depth, inline)))}\n`;

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

const saveSignTweaks = () => {
  let file;
  let pinFile;
  let ownWriteUntil = 0;
  let wrongPins = 0;
  let lockedUntil = 0;

  // the PIN is read on every request, so editing .save-pin takes effect at once; a missing file gets a random 4-digit PIN
  const readPin = () => {
    try {
      const pin = fs.readFileSync(pinFile, 'utf8').trim();
      if (pin) return pin;
    } catch {}
    const pin = String(crypto.randomInt(1000, 10000));
    fs.writeFileSync(pinFile, `${pin}\n`);
    console.log(`[save-sign-tweaks] created ${PIN_FILE} with the save PIN: ${pin} (edit the file to change it)`);
    return pin;
  };
  const samePin = (given, expected) => {
    const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();
    return crypto.timingSafeEqual(hash(given), hash(expected));
  };

  return {
    name: 'save-sign-tweaks',
    apply: 'serve',
    configResolved(config) {
      file = path.resolve(config.root, SIGNS_FILE);
      pinFile = path.resolve(config.root, PIN_FILE);
    },
    configureServer(server) {
      readPin(); // make sure the file exists (and show a new PIN in the terminal)
      server.middlewares.use(SAVE_URL, (req, res) => {
        // GET only tells the page that saving is available here (so it can ask for the PIN)
        if (req.method === 'GET') return void res.writeHead(200).end('ok');
        if (req.method !== 'POST') return void res.writeHead(405).end();
        if (Date.now() < lockedUntil) {
          req.resume();
          return void res.writeHead(429).end('Liiga palju valesid PIN-e, proovi hiljem uuesti');
        }
        if (!samePin(req.headers['x-save-pin'] ?? '', readPin())) {
          req.resume();
          if (++wrongPins >= MAX_WRONG_PINS) {
            wrongPins = 0;
            lockedUntil = Date.now() + LOCK_MS;
          }
          // a short pause makes guessing slower
          return void setTimeout(() => res.writeHead(403).end(`Vale PIN (see on failis ${PIN_FILE})`), 400);
        }
        wrongPins = 0;
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            // body: { global: { bone: entry }, keys: { sign: { bone: entry } } } - merged into the sign data
            const state = JSON.parse(body);
            if (!isObject(state) || !isObject(state.global ?? {}) || !isObject(state.keys ?? {})) throw new Error('expected { global, keys }');
            const raw = fs.readFileSync(file, 'utf8');
            const eol = raw.includes('\r\n') ? '\r\n' : '\n'; // keep the file's own line endings so diffs stay small
            const data = JSON.parse(raw);
            const keys = state.keys ?? {};
            for (const key of Object.keys(keys)) if (!data.signs[key]) throw new Error(`unknown sign "${key}"`);
            for (const [letter, sign] of Object.entries(data.signs)) {
              if (keys[letter] && Object.keys(keys[letter]).length) sign.tweaks = keys[letter];
              else delete sign.tweaks;
            }
            data.global = state.global ?? {};
            ownWriteUntil = Date.now() + 1500;
            fs.writeFileSync(file, serialize(data).replace(/\n/g, eol));
            res.writeHead(200).end('ok');
          } catch (e) {
            res.writeHead(400).end(String(e.message));
          }
        });
      });
    },
    // The page already holds this state; don't reload it just because we wrote the file. Hand edits still reload.
    handleHotUpdate({ file: changed }) {
      if (path.resolve(changed) === file && Date.now() < ownWriteUntil) return [];
    },
  };
};

export default { plugins: [saveSignTweaks()] };
