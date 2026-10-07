import type { Obj } from './validate.js';

// Writes the data the way the client's JSON files have always been laid out, so `npm run export` gives small diffs:
// one orient / thumb pose / sign / global bone per line; a sign that carries tweaks gets its base fields on one line and one bone
// per line below.

const inline = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(inline).join(', ')}]`
  : v && typeof v === 'object' ? (Object.keys(v).length ? `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ')} }` : '{}')
  : JSON.stringify(v);

const pad = (depth: number) => '  '.repeat(depth);

type Line = (v: any, depth: number, key: string) => string;
const block = (obj: Obj, depth: number, line: Line): string => {
  const entries = Object.entries(obj);
  if (!entries.length) return '{}';
  const rows = entries.map(([k, v]) => `${pad(depth + 1)}${JSON.stringify(k)}: ${line(v, depth + 1, k)}`);
  return `{\n${rows.join(',\n')}\n${pad(depth)}}`;
};

const sign: Line = (s: Obj, depth) => {
  const { tweaks, ...base } = s;
  if (!tweaks || !Object.keys(tweaks).length) return inline(s);
  const fields = Object.entries(base).map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`).join(', ');
  // (an undefined sign has no base fields, only tweaks)
  return `{\n${fields ? `${pad(depth + 1)}${fields},\n` : ''}${pad(depth + 1)}"tweaks": ${block(tweaks as Obj, depth + 1, inline)}\n${pad(depth)}}`;
};

/** fingerspelling.json / words.json */
export const serializeSigns = (data: Obj): string => `${block(data, 0, (v, depth, key) => (key === 'signs' ? block(v, depth, sign) : block(v, depth, inline)))}\n`;

/** limits.json: the notes, then one finger joint / one bone per line */
export const serializeLimits = (data: Obj): string => `${block(data, 0, (v, depth, key) => (key === 'bones' || key === 'finger' ? block(v, depth, inline) : inline(v)))}\n`;
