import { HttpError } from '../auth/users.js';

// The sign format, as the client's editor writes it. Keep in step with client/src/signing/signFormat.js (SIGN_FIELDS, SIGN_NAME).
export const SIGN_FIELDS = ['curl', 'thumb', 'spread', 'knuckle', 'dir', 'orient', 'motion', 'left'] as const;
export const SIGN_NAME = /^[\p{L}\p{N}][\p{L}\p{N} -]{1,39}$/u;

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type Obj = { [k: string]: Json };

export const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const nums = (a: unknown, n?: number): a is number[] => Array.isArray(a) && (n === undefined || a.length === n) && a.every(num);
const bad = (msg: string): never => {
  throw new HttpError(400, msg);
};

/** JSON with the keys sorted, to compare two values regardless of key order. */
export const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (isObject(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

export function checkSignName(name: unknown): string {
  if (typeof name !== 'string' || !SIGN_NAME.test(name) || name !== name.toLocaleUpperCase('et')) return bad(`Sobimatu märgi nimi "${String(name)}".`);
  return name;
}

/** A sign's definition (the fields in SIGN_FIELDS); `left` holds the same fields for the other hand. */
export function checkDef(def: unknown, isLeft = false): asserts def is Obj {
  if (!isObject(def)) return bad('Märgi definitsioon peab olema objekt.');
  for (const [k, v] of Object.entries(def)) {
    if (!(SIGN_FIELDS as readonly string[]).includes(k) || (isLeft && k === 'left')) return bad(`Tundmatu väli "${k}".`);
    const ok =
      k === 'curl' || k === 'spread' || k === 'knuckle' ? nums(v, 4)
      : k === 'thumb' || k === 'dir' ? typeof v === 'string'
      : k === 'orient' ? isObject(v) && Object.entries(v).every(([f, x]) => (f === 'maxBend' ? num(x) : ['finger', 'thumb', 'reach', 'pole'].includes(f) && nums(x, 3)))
      : k === 'motion' ? isObject(v) && Array.isArray(v.path) && v.path.length >= 2 && v.path.every((pt) => nums(pt) && pt.length >= 2 && pt.length <= 8) && num(v.duration) && v.duration > 0
      : isObject(v) && (checkDef(v, true), true);
    if (!ok) return bad(`Vigane väärtus väljal "${k}".`);
  }
}

/** Bone tweaks: { bone: { rot: [x, y, z], pos: [x, y, z], w: weight } }, every part optional. */
export function checkTweaks(t: unknown): asserts t is Obj {
  if (!isObject(t)) return bad('Luu muudatused peavad olema objekt.');
  for (const [bone, e] of Object.entries(t)) {
    if (!isObject(e)) return bad(`Vigane kirje luule "${bone}".`);
    for (const [k, v] of Object.entries(e)) if (!(((k === 'rot' || k === 'pos') && nums(v, 3)) || (k === 'w' && num(v)))) return bad(`Vigane väli "${bone}.${k}".`);
  }
}

const TABLE_KEY = /^[\p{L}\p{N}_-]{1,40}$/u;

/** The named hand orients (shared.json `orient`): { name: { finger, thumb, reach, pole?: [x, y, z], maxBend?: degrees, note?: text } }. */
export function checkOrients(t: unknown): asserts t is Obj {
  if (!isObject(t)) return bad('Põhiasendid peavad olema objekt.');
  for (const [name, e] of Object.entries(t)) {
    if (!TABLE_KEY.test(name) || !isObject(e)) return bad(`Vigane põhiasend "${name}".`);
    for (const f of ['finger', 'thumb', 'reach']) if (!nums(e[f], 3)) return bad(`Põhiasendil "${name}" puudub või on vigane "${f}".`);
    for (const [k, v] of Object.entries(e)) {
      const ok = ['finger', 'thumb', 'reach', 'pole'].includes(k) ? nums(v, 3) : k === 'maxBend' ? num(v) && v >= 20 && v <= 120 : k === 'note' && typeof v === 'string' && v.length <= 400;
      if (!ok) return bad(`Vigane väli "${name}.${k}".`);
    }
  }
}

/** The thumb poses per rig (shared.json `thumbPoses`, `rigs.<rig>.thumbPoses`): { rig: { name: { joints: [[x, y, z] × 3], note?: text } } }. */
export function checkThumbPoses(t: unknown): asserts t is Obj {
  if (!isObject(t)) return bad('Pöidla asendid peavad olema objekt.');
  for (const [rig, poses] of Object.entries(t)) {
    if (!TABLE_KEY.test(rig) || !isObject(poses)) return bad(`Vigased pöidla asendid mudelile "${rig}".`);
    for (const [name, e] of Object.entries(poses)) {
      if (!TABLE_KEY.test(name) || !isObject(e)) return bad(`Vigane pöidla asend "${name}".`);
      if (!Array.isArray(e.joints) || e.joints.length !== 3 || !e.joints.every((j) => nums(j, 3) && j.every((x) => Math.abs(x) <= 6))) return bad(`Vigased liigesed pöidla asendil "${name}".`);
      for (const [k, v] of Object.entries(e)) if (k !== 'joints' && !(k === 'note' && typeof v === 'string' && v.length <= 400)) return bad(`Vigane väli "${name}.${k}".`);
    }
  }
}

/** The new limits.json content from what the editor sends; the notes of the old one stay. */
export function buildLimits(state: unknown, old: Obj): Obj {
  if (!isObject(state) || !isObject(state.bones)) return bad('Oodati { bones }.');
  const bones: Obj = {};
  for (const [name, range] of Object.entries(state.bones)) {
    if (!isObject(range)) return bad(`Vigased piirid luule "${name}".`);
    const entry: Obj = {};
    for (const [axis, r] of Object.entries(range)) {
      const max = axis === 'y' ? 90 : 180;
      if (!['x', 'y', 'z'].includes(axis) || !nums(r, 2) || r[0]! > r[1]! || r[0]! < -max || r[1]! > max) return bad(`Vigane vahemik "${name}.${axis}".`);
      entry[axis] = r;
    }
    if (Object.keys(entry).length) bones[name] = entry;
  }
  const oldFinger = isObject(old.finger) ? old.finger : {};
  const finger: Obj = oldFinger.note ? { note: oldFinger.note } : {};
  for (const [joint, ranges] of Object.entries(isObject(state.finger) ? state.finger : {})) {
    if (!['mcp', 'pip', 'dip'].includes(joint) || !isObject(ranges)) return bad(`Vigane sõrmeliiges "${joint}".`);
    const entry: Obj = {};
    for (const [axis, r] of Object.entries(ranges)) {
      if (!['curl', 'spread', 'twist'].includes(axis) || !nums(r, 2) || r[0]! > r[1]! || r[0]! < -180 || r[1]! > 180) return bad(`Vigane vahemik "${joint}.${axis}".`);
      entry[axis] = r;
    }
    if (Object.keys(entry).length) finger[joint] = entry;
  }
  return { ...old, finger, bones };
}
