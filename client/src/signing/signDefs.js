import { fingerspelling, words } from '../data/store.js';
import { SIGNS, WORD_FORMS } from './hands.js';
import { SIGN_FIELDS, SIGN_NAME, isLetterName } from './signFormat.js';
import { canon, fingerprint } from '../util.js';

// The definition of a sign (what the fine-tuning window changes) as opposed to its bone tweaks (tweaks.js):
// curl, thumb, spread, knuckle, dir (a named orient), orient (changes to that orient, for this sign only), motion, and
// `left` (the same fields for the other hand). hands.js reads SIGNS live, so editing a definition here shows at once.
//
// What the data files hold is remembered as the baseline; a sign that differs from it is "changed". Changed signs are kept
// in localStorage as a working copy (like the bone tweaks) until they are saved into the files (dev server).
const STORAGE_KEY = 'viiper.signDefs';

const clone = (v) => structuredClone(v);
const allZero = (a) => Array.isArray(a) && a.every((x) => x === 0);

const pick = (sign) => Object.fromEntries(SIGN_FIELDS.filter((f) => sign[f] !== undefined).map((f) => [f, clone(sign[f])]));
// the signs as the files hold them (copied now: SIGNS shares its nested objects with the imported JSON, and the editor edits those)
const baseline = new Map(Object.entries({ ...fingerspelling.signs, ...words.signs }).map(([k, s]) => [k, pick(s)]));

// A new sign is a letter (sõrmend: a one-letter name, it goes into the fingerspelling) or a word sign (viip: 2-40 characters, it goes into
// words.json). Its name is what is typed to get it: upper case (the rule is in signFormat.js).
export const normalizeName = (text) => text.trim().replace(/\s+/g, ' ').toLocaleUpperCase('et');
/** Why a name can't be used for a new sign, or null when it can. */
export function checkName(name) {
  if (!SIGN_NAME.test(name) && !isLetterName(name)) return 'Nimi: üks täht (sõrmend) või 2–40 tähte, numbrit, tühikut või sidekriipsu (viip).';
  if (Object.hasOwn(SIGNS, name) || Object.hasOwn(WORD_FORMS, name)) return 'Selline märk (või selle kirjapilt) on juba olemas.';
  return null;
}
/** A sign that is not in the files yet (added in the editor and not saved). */
export const isNew = (key) => !baseline.has(key);
/** Why an alias can't be used for the new sign `name`, or null when it can (an alias is another typed form of the sign: "0" for NULL). */
export function checkAlias(alias, name) {
  if (!SIGN_NAME.test(alias) && !isLetterName(alias)) return 'Alias: üks täht või number (sõrmendite hulka) või 2–40 tähte, numbrit, tühikut või sidekriipsu.';
  if (alias === name) return 'Alias on sama mis märgi nimi.';
  if (Object.hasOwn(SIGNS, alias) || Object.hasOwn(WORD_FORMS, alias)) return `Alias „${alias}“ on juba kasutusel.`;
  return null;
}
const newAliases = new Map(); // a new sign -> its aliases (not saved yet)
/** The aliases of a sign that is not saved yet (they go to the server with it). */
export const aliasesOf = (key) => newAliases.get(key) ?? [];
/**
 * Add a sign; `def` is its definition (a flat hand, thumb at rest, pointing up when left out). A letter is not a typed word form.
 * `aliases`: other typed forms that show it (they become typed forms at once; a one-character one is a button of the fingerspelling after a reload).
 */
export function addSign(key, def = { curl: [0, 0, 0, 0], thumb: 'rest', dir: 'up' }, aliases = []) {
  SIGNS[key] = { spread: [0, 0, 0, 0], knuckle: [0, 0, 0, 0], ...pick(def) };
  if (!isLetterName(key)) WORD_FORMS[key] = key;
  const ok = aliases.filter((a) => !checkAlias(a, key));
  if (ok.length) newAliases.set(key, ok);
  for (const a of ok) WORD_FORMS[a] = key;
}
/** Take a sign that is not in the files yet away again. */
export function removeSign(key) {
  if (!isNew(key)) return;
  delete SIGNS[key];
  delete WORD_FORMS[key];
  for (const a of newAliases.get(key) ?? []) delete WORD_FORMS[a];
  newAliases.delete(key);
}

/** Keys of the signs that can be edited: letters first, then words (the standby pose has a definition only once it is given finger data). */
export const signKeys = () => Object.keys(SIGNS);

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
  for (const f of SIGN_FIELDS) delete sign[f];
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
    for (const key of changedKeys()) drafts[key] = { base: fingerprint(canon(baseline.get(key) ?? {})), def: currentDef(key), ...(isNew(key) && { new: true, ...(aliasesOf(key).length && { aliases: aliasesOf(key) }) }) };
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
    if (d?.new && !SIGNS[key] && !baseline.has(key) && !checkName(key) && d.def) addSign(key, d.def, d.aliases ?? []); // a sign added and not saved yet
    else if (SIGNS[key] && d?.base === fingerprint(canon(baseline.get(key) ?? {}))) applyDef(key, d.def);
    else console.info(`Dropped a stale working copy of sign ${key} (its file has changed since it was made).`);
  }
  persist();
}

/** The signs were written into the files: that is the baseline now. */
export function markSaved(keys) {
  for (const key of keys) baseline.set(key, currentDef(key));
  persist();
}
