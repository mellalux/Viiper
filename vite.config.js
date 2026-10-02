import fs from 'node:fs';
import path from 'node:path';

// Dev-only: lets the editor panel's "Salvesta faili" button write its tweaks into src/signs.json.
const SAVE_URL = '/__save-sign-tweaks';
const SIGNS_FILE = 'src/signs.json';

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
  return `{\n${pad(depth + 1)}${fields},\n${pad(depth + 1)}"tweaks": ${block(tweaks, depth + 1, inline)}\n${pad(depth)}}`;
};
// rigs: { cc: { thumbPoses: { across: {...} }, visemes: { A: {...} } } } - one pose / viseme per line
const rigs = (v, depth) => block(v, depth, (rig, d) => block(rig, d, (section, d2) => block(section, d2, inline)));
export const serialize = (data) =>
  `${block(data, 0, (v, depth, key) => (key === 'signs' ? block(v, depth, sign) : key === 'rigs' ? rigs(v, depth) : block(v, depth, inline)))}\n`;

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

const saveSignTweaks = () => {
  let file;
  let ownWriteUntil = 0;
  return {
    name: 'save-sign-tweaks',
    apply: 'serve',
    configResolved(config) {
      file = path.resolve(config.root, SIGNS_FILE);
    },
    configureServer(server) {
      server.middlewares.use(SAVE_URL, (req, res) => {
        if (req.method !== 'POST') return void res.writeHead(405).end();
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
