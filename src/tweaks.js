import * as THREE from 'three';
import signData from './signs.json';
import { STANDBY } from './hands.js';
import { detectRig } from './rigs.js';

// Hand-tuned offsets for any bone, layered on top of whatever poses it (hands.js, mouth.js) or its rest pose.
// Each bone has a rotation (degrees, Euler XYZ in the bone's own axes) and a position offset (millimetres in the
// model's world axes: +X = the character's left, +Y up, +Z forward, as in mouth.js, converted with the parent's
// rest orientation, so the bones' odd roll orientations don't matter).
//
// Data lives in signs.json: `signs.<letter>.tweaks.<bone>` is applied while that sign is shown (face and the signing
// arm); `global.<bone>` always applies (body). The other arm only ever waits in standby, so its tweaks sit under
// the standby sign. Format of one entry: { "rot": [x, y, z], "pos": [x, y, z] }, either part optional.
// Shape keys (face morph targets) work the same way: `{ "w": 0.3 }` adds that weight to the shape while the sign is shown.
export const GLOBAL = '*';

export const GROUPS = [
  { id: 'right', label: 'Parem käsi' },
  { id: 'left', label: 'Vasak käsi' },
  { id: 'face', label: 'Nägu' },
  { id: 'body', label: 'Keha' },
  { id: 'shapes', label: 'Näo vormid' }, // only on models whose face has shape keys
];

const D2R = THREE.MathUtils.DEG2RAD;
const num3 = (a) => (Array.isArray(a) && a.length === 3 && a.every(Number.isFinite) ? a.map(Number) : null);

/** Normalise one stored entry; null when it holds nothing (or is malformed). */
function clean(e) {
  if (Array.isArray(e)) e = { rot: e }; // the first editor version stored a bare [x, y, z] rotation
  if (!e || typeof e !== 'object') return null;
  const rot = num3(e.rot);
  const pos = num3(e.pos);
  const out = {};
  if (rot?.some((x) => x !== 0)) out.rot = rot;
  if (pos?.some((x) => x !== 0)) out.pos = pos;
  if (Number.isFinite(e.w) && e.w !== 0) out.w = Number(e.w);
  return Object.keys(out).length ? out : null;
}

/** Tweaks as stored in signs.json. */
export function tweaksFromSigns() {
  const keys = {};
  for (const [letter, sign] of Object.entries(signData.signs)) if (sign.tweaks) keys[letter] = sign.tweaks;
  return { global: signData.global ?? {}, keys };
}

/**
 * @param weight (side 'L' | 'R') => 0..1, how far that arm is raised; its bones' tweaks fade with it
 * @param morphs the model's shape-key layer (morphs.js); gives the shape keys their own tweaks
 */
export function createTweaks(root, { weight = () => 1, smoothing = 18, morphs = null } = {}) {
  root.updateMatrixWorld(true);
  // which bones are arms / face, what other systems re-pose every frame (a tweak must then be added on top instead of
  // set from the rest pose), and a bone's mirror twin all come from the rig profile (rigs.js)
  const rig = detectRig(root);
  const faceSet = new Set();
  root.getObjectByName(rig?.faceRoot ?? 'face')?.traverse((o) => o.isBone && faceSet.add(o.name));

  const bones = [];
  const byName = new Map();
  root.traverse((bone) => {
    if (!bone.isBone) return;
    const name = bone.name;
    const armSide = rig?.armSide(name) ?? null;
    const group = armSide ? (armSide === 'R' ? 'right' : 'left') : faceSet.has(name) ? 'face' : 'body';
    const entry = {
      name, bone, group, index: bones.length,
      armSide,
      rest: { q: bone.quaternion.clone(), p: bone.position.clone() },
      parentInv: bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert(),
      drivesRot: rig?.rotDriven(name) ?? false,
      drivesPos: rig?.posDriven(name) ?? false,
      // body tweaks must land before the arms' IK reads the shoulders; everything else after hands/mouth have posed
      phase: group === 'body' ? 'pre' : 'post',
      mirrorName: rig?.mirrorName(name) ?? null,
      active: false,
    };
    bones.push(entry);
    byName.set(name, entry);
  });
  for (const e of bones) if (!byName.has(e.mirrorName) || e.group === 'right' || e.group === 'left') e.mirrorName = null;

  // shape keys come after the bones in `items` (so bone indices stay put); each has one number, the weight
  const shapes = [];
  for (const name of morphs?.names ?? []) {
    if (byName.has(name) || (rig?.shapeVisible && !rig.shapeVisible(name))) continue;
    const entry = { name, bone: null, shape: true, group: 'shapes', index: bones.length + shapes.length, phase: 'post', mirrorName: null, active: false };
    shapes.push(entry);
    byName.set(name, entry);
  }
  for (const e of shapes) {
    // swap every _L / _R part: Mouth_Smile_L <-> Mouth_Smile_R, Eye_L_Look_L <-> Eye_R_Look_R
    const twin = e.name.replace(/_([LR])(?=_|$)/g, (m, s) => (s === 'L' ? '_R' : '_L'));
    e.mirrorName = twin !== e.name && byName.get(twin)?.shape ? twin : null;
  }
  const items = [...bones, ...shapes];

  let data = { global: {}, keys: {} };
  // entries for bones this model doesn't have (tweaks made on another rig): kept untouched so saving never drops them
  let foreign = { global: {}, keys: {} };
  let currentKey = null; // the sign being shown
  const cur = new Float32Array(items.length * 6); // rot xyz (deg), pos xyz (mm); a shape key uses the first slot for its weight
  const tgt = new Float32Array(items.length * 6);

  const bucket = (key, create = false) => (key === GLOBAL ? data.global : create ? (data.keys[key] ??= {}) : data.keys[key]);
  /** Which key a bone's tweak is stored under, given the sign being edited/shown. */
  // (the left arm waits in standby, except in two-handed letters, which give it a pose of its own)
  const keyOf = (e, letter) => (e.group === 'body' ? GLOBAL : e.group === 'left' ? (signData.signs[letter]?.left ? letter : STANDBY) : letter);

  const recompute = (snapIndex = -1) => {
    for (const e of items) {
      const key = keyOf(e, currentKey);
      const t = key == null ? null : bucket(key)?.[e.name];
      const i = e.index * 6;
      for (let k = 0; k < 3; k++) {
        tgt[i + k] = e.shape ? (k === 0 ? (t?.w ?? 0) : 0) : (t?.rot?.[k] ?? 0);
        tgt[i + 3 + k] = e.shape ? 0 : (t?.pos?.[k] ?? 0);
      }
      if (snapIndex === e.index || snapIndex === -2) for (let k = 0; k < 6; k++) cur[i + k] = tgt[i + k];
    }
  };

  const eul = new THREE.Euler();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const apply = (phase) => {
    for (const e of items) {
      if (e.phase !== phase) continue;
      const i = e.index * 6;
      if (e.shape) {
        // add the weight to whatever the mouth / blink drivers put on the same shape (see morphs.js)
        const w = cur[i];
        if (w !== 0 || e.active) morphs?.set('tweak', e.name, w);
        e.active = w !== 0;
        continue;
      }
      const m = e.armSide ? weight(e.armSide) : 1;
      let any = false;
      for (let k = 0; k < 6; k++) if (Math.abs(cur[i + k] * m) > 1e-5) any = true;
      if (!any && !e.active) continue;
      e.active = any;
      if (!e.drivesRot) e.bone.quaternion.copy(e.rest.q); // undriven bones restart from rest (this also undoes an old tweak)
      if (any) e.bone.quaternion.multiply(q.setFromEuler(eul.set(cur[i] * m * D2R, cur[i + 1] * m * D2R, cur[i + 2] * m * D2R)));
      if (!e.drivesPos) e.bone.position.copy(e.rest.p);
      if (any) e.bone.position.add(v.set(cur[i + 3], cur[i + 4], cur[i + 5]).multiplyScalar(0.001 * m).applyQuaternion(e.parentInv));
    }
  };

  const api = {
    /** [{ name, bone, group, mirrorName }] for every bone, in skeleton order. */
    bones,
    /** [{ name, group: 'shapes', mirrorName }] for the shape keys worth tuning (none on rigs without shape keys). */
    shapes,
    byName,
    /** Key a bone's tweak is stored under when `letter` is the sign being edited. */
    keyOf: (name, letter) => keyOf(byName.get(name), letter),
    get(key, name) {
      const t = bucket(key)?.[name];
      return { rot: [...(t?.rot ?? [0, 0, 0])], pos: [...(t?.pos ?? [0, 0, 0])], w: t?.w ?? 0 };
    },
    set(key, name, value) {
      const e = byName.get(name);
      if (!e) return;
      const entry = clean(value);
      if (entry) bucket(key, true)[name] = entry;
      else if (bucket(key)) {
        delete bucket(key)[name];
        if (key !== GLOBAL && !Object.keys(bucket(key)).length) delete data.keys[key];
      }
      recompute(e.index); // jump straight there so sliders feel direct
    },
    /**
     * Copy the tweaks of `names` from sign `from` to sign `to`, replacing what `to` had for them. Only entries that are
     * kept per sign are copied (not the body's, which always applies, nor the waiting arm's).
     * @returns { copied, cleared } how many entries were written / removed
     */
    copy(from, to, names) {
      let copied = 0;
      let cleared = 0;
      for (const name of names) {
        const e = byName.get(name);
        if (!e) continue;
        const fromKey = keyOf(e, from);
        const toKey = keyOf(e, to);
        if (fromKey === toKey) continue;
        const src = bucket(fromKey)?.[name];
        const had = !!bucket(toKey)?.[name];
        this.set(toKey, name, src ? structuredClone(src) : null);
        if (src) copied++;
        else if (had) cleared++;
      }
      return { copied, cleared };
    },
    /** Drop every tweak the given bones have under `key`. */
    reset(key, names) {
      for (const n of names) this.set(key, n, null);
    },
    /** Replace everything ({ global, keys }); malformed or unknown entries are skipped. */
    load(raw) {
      data = { global: {}, keys: {} };
      foreign = { global: {}, keys: {} };
      const take = (src, known, other) => {
        for (const [name, e] of Object.entries(src && typeof src === 'object' ? src : {})) {
          const c = clean(e);
          if (c) (byName.has(name) ? known : other)[name] = c;
        }
      };
      take(raw?.global, data.global, foreign.global);
      for (const [key, tw] of Object.entries(raw?.keys && typeof raw.keys === 'object' ? raw.keys : {})) {
        const known = {};
        const other = {};
        take(tw, known, other);
        if (Object.keys(known).length) data.keys[key] = known;
        if (Object.keys(other).length) foreign.keys[key] = other;
      }
      recompute(-2);
    },
    /** Everything, including the entries of bones this model lacks. */
    export() {
      const keys = {};
      for (const key of new Set([...Object.keys(data.keys), ...Object.keys(foreign.keys)])) {
        keys[key] = { ...foreign.keys[key], ...data.keys[key] };
      }
      return structuredClone({ global: { ...foreign.global, ...data.global }, keys });
    },
    /** The sign being shown (a letter, STANDBY or null) selects which tweaks apply to face and signing arm. */
    setKey(key) {
      if (key === currentKey) return;
      currentKey = key;
      recompute();
    },
    step(dt) {
      const k = 1 - Math.exp(-smoothing * dt);
      for (let i = 0; i < cur.length; i++) {
        const d = tgt[i] - cur[i];
        cur[i] = Math.abs(d) < 1e-4 ? tgt[i] : cur[i] + d * k;
      }
    },
    applyPre: () => apply('pre'),
    applyPost: () => apply('post'),
  };
  api.load(tweaksFromSigns());
  return api;
}
