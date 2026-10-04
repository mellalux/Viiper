import fingerspelling from '../data/fingerspelling.json';
import words from '../data/words.json';
import { SIGNS, STANDBY } from './hands.js';

// The definition of a sign (what the sign editor changes) as opposed to its bone tweaks (tweaks.js):
// curl, thumb, spread, knuckle, dir (a named orient), orient (changes to that orient, for this sign only), motion, and
// `left` (the same fields for the other hand). hands.js reads SIGNS live, so editing a definition here shows at once.
//
// What the data files hold is remembered as the baseline; a sign that differs from it is "changed". Changed signs are kept
// in localStorage as a working copy (like the bone editor's tweaks) until they are saved into the files (dev server).
export const FIELDS = ['curl', 'thumb', 'spread', 'knuckle', 'dir', 'orient', 'motion', 'left'];
const STORAGE_KEY = 'viiper.signDefs';

const clone = (v) => structuredClone(v);
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const allZero = (a) => Array.isArray(a) && a.every((x) => x === 0);
const fingerprint = (text) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};

const pick = (sign) => Object.fromEntries(FIELDS.filter((f) => sign[f] !== undefined).map((f) => [f, clone(sign[f])]));
// the signs as the files hold them (copied now: SIGNS shares its nested objects with the imported JSON, and the editor edits those)
const baseline = new Map(Object.entries({ ...fingerspelling.signs, ...words.signs }).map(([k, s]) => [k, pick(s)]));

/** Keys of the signs that can be edited: letters first, then words (the standby pose has no definition of its own). */
export const signKeys = () => Object.keys(SIGNS).filter((k) => k !== STANDBY);

/** The sign's definition as it is now, without the zero spread / knuckle that every sign gets by default. */
export function currentDef(key) {
  const def = pick(SIGNS[key]);
  const was = baseline.get(key) ?? {};
  for (const f of ['spread', 'knuckle']) if (allZero(def[f]) && was[f] === undefined) delete def[f];
  return def;
}
export const baselineDef = (key) => clone(baseline.get(key) ?? {});
export const isChanged = (key) => canon(currentDef(key)) !== canon(baseline.get(key) ?? {});
export const changedKeys = () => signKeys().filter(isChanged);

/** Replace a sign's definition (not its tweaks). */
export function applyDef(key, def) {
  const sign = SIGNS[key];
  for (const f of FIELDS) delete sign[f];
  Object.assign(sign, clone(def));
  sign.spread ??= [0, 0, 0, 0];
  sign.knuckle ??= [0, 0, 0, 0];
}

/** Back to what the file holds. */
export const resetSign = (key) => applyDef(key, baselineDef(key));

/** Keep the changed signs in localStorage (each with a fingerprint of the file's version it was made from). */
export function persist() {
  try {
    const drafts = {};
    for (const key of changedKeys()) drafts[key] = { base: fingerprint(canon(baseline.get(key) ?? {})), def: currentDef(key) };
    if (Object.keys(drafts).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

/** Put the working copy back (drafts made from an older version of the file are dropped). Call once at start. */
export function restoreDrafts() {
  let drafts = null;
  try {
    drafts = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {}
  for (const [key, d] of Object.entries(drafts ?? {})) {
    if (SIGNS[key] && d?.base === fingerprint(canon(baseline.get(key) ?? {}))) applyDef(key, d.def);
    else console.info(`Dropped a stale working copy of sign ${key} (its file has changed since it was made).`);
  }
  persist();
}

/** The signs were written into the files: that is the baseline now. */
export function markSaved(keys) {
  for (const key of keys) baseline.set(key, currentDef(key));
  persist();
}
