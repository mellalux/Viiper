import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Dev-only: lets the fine-tuning window's "Salvesta faili" button write its tweaks into src/data/fingerspelling.json (letters)
// and src/data/words.json (word signs): every sign's tweaks go to the file that holds that sign.
// Writing needs the PIN kept in .save-pin (git-ignored; edit the file to change it). The server checks it, not the page.
const SAVE_URL = '/__save-sign-tweaks';
const DEFS_URL = '/__save-sign-defs'; // the fine-tuning window: curl, orient, motion ... of whole signs
const SIGNS_FILE = 'src/data/fingerspelling.json'; // also holds the body's `global` tweaks
const WORDS_FILE = 'src/data/words.json';
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
export const serialize = (data) =>
  `${block(data, 0, (v, depth, key) => (key === 'signs' ? block(v, depth, sign) : block(v, depth, inline)))}\n`;

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

// A sign's definition (what the fine-tuning window saves). The fields a sign may have, in the order they are written; `note` and
// `tweaks` are not part of it and stay as they are in the file.
const DEF_FIELDS = ['curl', 'thumb', 'spread', 'knuckle', 'dir', 'orient', 'motion', 'left'];
const nums = (a, n) => Array.isArray(a) && (n === undefined || a.length === n) && a.every((x) => typeof x === 'number' && Number.isFinite(x));
function checkDef(def, isLeft = false) {
  if (!isObject(def)) throw new Error('a sign definition must be an object');
  for (const [k, v] of Object.entries(def)) {
    if (!DEF_FIELDS.includes(k) || (isLeft && k === 'left')) throw new Error(`unknown field "${k}"`);
    const ok =
      k === 'curl' || k === 'spread' || k === 'knuckle' ? nums(v, 4)
      : k === 'thumb' || k === 'dir' ? typeof v === 'string'
      : k === 'orient' ? isObject(v) && Object.entries(v).every(([f, x]) => (f === 'maxBend' ? typeof x === 'number' && Number.isFinite(x) : ['finger', 'thumb', 'reach', 'pole'].includes(f) && nums(x, 3)))
      : k === 'motion' ? isObject(v) && Array.isArray(v.path) && v.path.length >= 2 && v.path.every((pt) => nums(pt) && pt.length >= 2 && pt.length <= 7) && typeof v.duration === 'number' && v.duration > 0
      : isObject(v) && (checkDef(v, true), true);
    if (!ok) throw new Error(`bad value for "${k}"`);
  }
}

const saveSignTweaks = () => {
  let file;
  let wordsFile;
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
      wordsFile = path.resolve(config.root, WORDS_FILE);
      pinFile = path.resolve(config.root, PIN_FILE);
    },
    configureServer(server) {
      readPin(); // make sure the file exists (and show a new PIN in the terminal)
      // Both endpoints share the PIN check: GET only tells the page that saving is available here (so it can ask for the PIN),
      // POST needs the PIN in X-Save-Pin; `handle(json)` does the writing and returns, or throws a message for a 400.
      const guarded = (handle) => (req, res) => {
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
        let text = '';
        req.on('data', (c) => (text += c));
        req.on('end', () => {
          try {
            handle(JSON.parse(text));
            res.writeHead(200).end('ok');
          } catch (e) {
            res.writeHead(400).end(String(e.message));
          }
        });
      };
      const readFiles = () =>
        [file, wordsFile].map((f) => {
          const raw = fs.readFileSync(f, 'utf8');
          // keep each file's own line endings so diffs stay small
          return { f, eol: raw.includes('\r\n') ? '\r\n' : '\n', data: JSON.parse(raw) };
        });
      const writeFiles = (files) => {
        ownWriteUntil = Date.now() + 1500;
        for (const { f, eol, data } of files) fs.writeFileSync(f, serialize(data).replace(/\n/g, eol));
      };

      // body: { global: { bone: entry }, keys: { sign: { bone: entry } } } - the bone tweaks, merged into the sign data
      server.middlewares.use(SAVE_URL, guarded((state) => {
        if (!isObject(state) || !isObject(state.global ?? {}) || !isObject(state.keys ?? {})) throw new Error('expected { global, keys }');
        const keys = state.keys ?? {};
        const files = readFiles();
        for (const key of Object.keys(keys)) if (!files.some(({ data }) => data.signs[key])) throw new Error(`unknown sign "${key}"`);
        for (const { data } of files) {
          for (const [letter, sign] of Object.entries(data.signs)) {
            if (keys[letter] && Object.keys(keys[letter]).length) sign.tweaks = keys[letter];
            else delete sign.tweaks;
          }
        }
        files[0].data.global = state.global ?? {};
        writeFiles(files);
      }));

      // body: { signs: { SIGN: definition } } - replaces the definition fields of those signs, keeps their note and tweaks
      server.middlewares.use(DEFS_URL, guarded((state) => {
        if (!isObject(state) || !isObject(state.signs)) throw new Error('expected { signs }');
        const files = readFiles();
        for (const [key, def] of Object.entries(state.signs)) {
          const data = files.find(({ data: d }) => d.signs[key])?.data;
          if (!data) throw new Error(`unknown sign "${key}"`);
          checkDef(def);
          const old = data.signs[key];
          const next = {};
          if (old.note !== undefined) next.note = old.note;
          for (const f of DEF_FIELDS) if (def[f] !== undefined) next[f] = def[f];
          if (old.tweaks) next.tweaks = old.tweaks;
          data.signs[key] = next;
        }
        writeFiles(files);
      }));
    },
    // The page already holds this state; don't reload it just because we wrote the file. Hand edits still reload.
    handleHotUpdate({ file: changed }) {
      if ([file, wordsFile].includes(path.resolve(changed)) && Date.now() < ownWriteUntil) return [];
    },
  };
};

export default {
  plugins: [saveSignTweaks()],
  build: {
    chunkSizeWarningLimit: 900, // three.js alone is ~835 kB
    rolldownOptions: {
      output: {
        // three.js in its own chunk, so it stays cached when only the app code changes
        codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three/ }] },
      },
    },
  },
};
