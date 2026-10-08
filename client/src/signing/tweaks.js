import * as THREE from 'three';
import { fingerspelling, words } from '../data/store.js';
import { STANDBY, SIGNS, pathTimes } from './hands.js';
import { detectRig } from '../character/rigs.js';

// Hand-tuned offsets for any bone, layered on top of whatever poses it (hands.js, mouth.js) or its rest pose.
// Each bone has a rotation (degrees, Euler XYZ in the bone's own axes) and a position offset (millimetres in the
// model's world axes: +X = the character's left, +Y up, +Z forward, as in mouth.js, converted with the parent's
// rest orientation, so the bones' odd roll orientations don't matter).
//
// Data lives in fingerspelling.json (letters) and words.json (word signs): `signs.<letter>.tweaks.<bone>` is applied while that sign is shown (face and the signing
// arm); `global.<bone>` always applies (body). The other arm only ever waits in standby, so its tweaks sit under
// the standby sign. Format of one entry: { "rot": [x, y, z], "pos": [x, y, z] }, either part optional.
// The left arm's bones (the arm, hand and fingers) are mirrored when applied: the same numbers on a left bone turn / move it as the
// mirror image of what they do on the right one (rotation about Y and Z and the X offset flip), so a pose can be copied between hands as it is.
// Shape keys (face morph targets) work the same way: `{ "w": 0.3 }` adds that weight to the shape while the sign is shown.
const GLOBAL = '*';

// Keyframes: a sign whose right hand moves (its `motion` path) can give each point of the path a whole-body pose of its own: `frames.<sign>.<point>` holds
// tweaks (the same entries as above, for any bone or shape key). While the path plays, every bone and shape takes the value of the
// frame before and the one after the playhead, eased as the path is (smoothstep); a bone a frame says nothing about has the sign's own tweak there
// (the one the sign has without keyframes), so a frame only holds what it changes. A frame's bucket is addressed like a sign, as "SIGN@point"
// (a sign's name has no @). Frames are a working copy in the editor's browser only (the server knows nothing of them).
const FRAME_AT = '@';
const frameKey = (sign, i) => `${sign}${FRAME_AT}${i}`;
const parseFrame = (key) => {
  const at = typeof key === 'string' ? key.lastIndexOf(FRAME_AT) : -1;
  return at < 0 ? null : [key.slice(0, at), +key.slice(at + 1)];
};
const smooth = (s) => s * s * (3 - 2 * s);

// Base-pose tweaks: the base-pose editor (ui/basePose.js) can turn any bone and set any face shape for a named orient: the whole body.
// They are added to the sign's own tweaks of those bones in every sign that holds that arm in the orient (an arm's bones, by that
// arm's orient; the body, the face and the shapes, by the signing hand's), so a deformed elbow is mended once for all of
// them: `poses.<orient>.<bone>`, an entry like the others, addressed as "~orient". A working copy in the editor's browser only.
const isPoseKey = (key) => typeof key === 'string' && key[0] === '~';

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
  if (!e || typeof e !== 'object') return null;
  const rot = num3(e.rot);
  const pos = num3(e.pos);
  const out = {};
  if (rot?.some((x) => x !== 0)) out.rot = rot;
  if (pos?.some((x) => x !== 0)) out.pos = pos;
  if (Number.isFinite(e.w) && e.w !== 0) out.w = Number(e.w);
  return Object.keys(out).length ? out : null;
}

/** A keyframe's entry: like `clean`, but zeros are kept (they override the sign's own tweak). */
function cleanFrame(e) {
  if (!e || typeof e !== 'object') return null;
  const out = {};
  const rot = num3(e.rot);
  const pos = num3(e.pos);
  if (rot) out.rot = rot;
  if (pos) out.pos = pos;
  if (Number.isFinite(e.w)) out.w = Number(e.w);
  return Object.keys(out).length ? out : null;
}

/** Tweaks as stored in fingerspelling.json. */
export function tweaksFromSigns() {
  const keys = {};
  for (const [letter, sign] of Object.entries({ ...fingerspelling.signs, ...words.signs })) if (sign.tweaks) keys[letter] = sign.tweaks;
  return { global: fingerspelling.global ?? {}, keys };
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
      base: { q: bone.quaternion.clone(), p: bone.position.clone() }, // the pose the tweak was last added to (see apply)
      parentInv: bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert(),
      unit: bone.parent.getWorldScale(new THREE.Vector3()).x, // metres per local unit (0.01 on a rig in centimetres)
      drivesRot: rig?.rotDriven(name) ?? false,
      drivesPos: rig?.posDriven(name) ?? false,
      // body tweaks must land before the arms' IK reads the shoulders; everything else after hands/mouth have posed
      phase: group === 'body' ? 'pre' : 'post',
      mirrorName: rig?.mirrorName(name) ?? null,
      active: false,
      // the arm's twist helper bones (CC_Base_R_UpperarmTwist01 ...) only turn about their own long axis (Y): any other turn, or a move,
      // crumples the skin there, so only the Y turn of such a bone is ever applied (see recompute)
      twistOnly: /Twist\d*$/i.test(name),
      flip: armSide === 'L' ? -1 : 1, // the left arm's numbers are mirrored (see the header), so the same numbers pose it as the right arm's mirror image
    };
    entry.twin = entry.mirrorName; // (the arm's bones keep it: mirrorName is dropped for them below, they are tuned per side)
    bones.push(entry);
    byName.set(name, entry);
  });
  for (const e of bones) {
    if (!byName.has(e.twin)) e.twin = null;
    if (!byName.has(e.mirrorName) || e.group === 'right' || e.group === 'left') e.mirrorName = null;
  }

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

  // frames: { sign: { point: { bone: entry } } }; poses: { orient: { bone: entry } } (see below)
  let data = { global: {}, keys: {}, frames: {}, poses: {} };
  // entries for bones this model doesn't have (tweaks made on another rig): kept untouched so saving never drops them
  let foreign = { global: {}, keys: {} };
  let currentKey = null; // the sign being shown
  let suspended = null; // 'L' | 'R': that arm shows only the base pose's bone tweaks (the base-pose editor shows the arm as its orient poses it)
  let suspendedOrient = null; // ... of this orient
  const cur = new Float32Array(items.length * 6); // rot xyz (deg), pos xyz (mm); a shape key uses the first slot for its weight
  const tgt = new Float32Array(items.length * 6);

  const bucket = (key, create = false) => {
    if (key === GLOBAL) return data.global;
    const f = parseFrame(key);
    if (f) return create ? ((data.frames[f[0]] ??= {})[f[1]] ??= {}) : data.frames[f[0]]?.[f[1]];
    if (isPoseKey(key)) return create ? (data.poses[key.slice(1)] ??= {}) : data.poses[key.slice(1)];
    return create ? (data.keys[key] ??= {}) : data.keys[key];
  };
  /** Drop a bucket that has nothing left in it. */
  const prune = (key) => {
    if (key === GLOBAL || Object.keys(bucket(key) ?? { x: 1 }).length) return;
    if (isPoseKey(key)) return void delete data.poses[key.slice(1)];
    const f = parseFrame(key);
    if (!f) return void delete data.keys[key];
    delete data.frames[f[0]]?.[f[1]];
    if (data.frames[f[0]] && !Object.keys(data.frames[f[0]]).length) delete data.frames[f[0]];
  };
  let editFrame = null; // { key, i }: the editor is changing this keyframe (see api.keyOf)
  let editOrient = null; // { name, side }: ... the arm bones of this base pose
  let progress = 0; // how far along its path the signing hand is (0..1); selects the keyframes in between which the pose is mixed
  let switching = false; // the sign changed this frame: its first pose is eased to, not jumped to

  /**
   * The keyframes around the playhead for the sign being shown: { a, b, s } (the buckets of the point before and after, either may be
   * missing, and how far between them), or null when the sign has no keyframes (or no path).
   */
  const frameSegment = () => {
    const fr = data.frames[currentKey];
    const m = SIGNS[currentKey]?.motion;
    if (!fr || !m || m.path.length < 2) return null;
    const times = pathTimes(m.path, m.times);
    let i = times.findIndex((t, k) => k < times.length - 1 && progress <= times[k + 1]);
    if (i < 0) i = times.length - 2;
    const span = times[i + 1] - times[i];
    return { a: fr[i], b: fr[i + 1], s: smooth(Math.min(Math.max((progress - times[i]) / (span || 1), 0), 1)) };
  };
  const lerp = (a, b, s) => a + (b - a) * s;
  /** Entry `a` eased into entry `b` (either may be missing: nothing), `s` 0..1. */
  const mixEntry = (a, b, s) => {
    const out = { rot: [0, 0, 0], pos: [0, 0, 0], w: lerp(a?.w ?? 0, b?.w ?? 0, s) };
    for (let k = 0; k < 3; k++) {
      out.rot[k] = lerp(a?.rot?.[k] ?? 0, b?.rot?.[k] ?? 0, s);
      out.pos[k] = lerp(a?.pos?.[k] ?? 0, b?.pos?.[k] ?? 0, s);
    }
    return out;
  };
  /** Which key a bone's tweak is stored under, given the sign being edited/shown. */
  // (the left arm waits in standby, except in two-handed letters, which give it a pose of its own)
  const keyOf = (e, letter) => (e.group === 'body' ? GLOBAL : e.group === 'left' ? (SIGNS[letter]?.left ? letter : STANDBY) : letter);

  /** The named orient an arm is held in while sign `key` is shown (as hands.js poses it), or null when nothing poses it. */
  const orientFor = (side, key) => {
    const s = SIGNS[key];
    if (side === 'R') return s && Array.isArray(s.curl) ? (s.dir ?? (key === STANDBY ? 'ready' : 'up')) : null;
    if (s?.left) return Array.isArray(s.left.curl) ? (s.left.dir ?? 'up') : null; // (a left part without finger data is not posed by a sign)
    const st = SIGNS[STANDBY]; // the left hand waits in the standby pose
    return st && Array.isArray(st.curl) ? (st.left?.dir ?? 'relaxed') : null;
  };
  const sumEntry = (a, b) => ({
    rot: [0, 1, 2].map((k) => (a?.rot?.[k] ?? 0) + (b?.rot?.[k] ?? 0)),
    pos: [0, 1, 2].map((k) => (a?.pos?.[k] ?? 0) + (b?.pos?.[k] ?? 0)),
    w: (a?.w ?? 0) + (b?.w ?? 0),
  });
  /** The sign's own tweak of a bone (what the base pose's tweak is added to); none while that arm shows the base pose alone. */
  const ownTweak = (e) => (e.armSide && e.armSide === suspended ? null : bucket(keyOf(e, currentKey))?.[e.name]);

  const recompute = (snapIndex = -1) => {
    const seg = frameSegment();
    for (const e of items) {
      const key = keyOf(e, currentKey);
      let t = key == null ? null : bucket(key)?.[e.name];
      // (a bone a keyframe doesn't mention keeps the sign's own tweak at that frame)
      if (seg && (seg.a?.[e.name] || seg.b?.[e.name])) t = mixEntry(seg.a?.[e.name] ?? t, seg.b?.[e.name] ?? t, seg.s);
      // Every bone and shape also gets the tweaks of the base pose the sign holds its hand in: an arm bone those of its own arm's orient,
      // the body, the face and the shapes those of the signing (right) hand's. While the editor shows an orient (suspended is set) that
      // is the orient shown; its arm then has no tweaks but the base pose's.
      const own = e.armSide && e.armSide === suspended;
      if (own) t = null;
      const orient = suspended && (own || !e.armSide) ? suspendedOrient : orientFor(e.armSide ?? 'R', currentKey);
      const po = orient && data.poses[orient]?.[e.name];
      if (po) t = sumEntry(t, po);
      if (e.twistOnly && t) t = { rot: [0, t.rot?.[1] ?? 0, 0], pos: [0, 0, 0] };
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
      // what poses the bone without the tweak (the editor's gizmo works out the tweak from where the bone was dragged to)
      e.base.q.copy(e.drivesRot ? e.bone.quaternion : e.rest.q);
      e.base.p.copy(e.drivesPos ? e.bone.position : e.rest.p);
      const m = e.armSide ? weight(e.armSide) : 1;
      let any = false;
      for (let k = 0; k < 6; k++) if (Math.abs(cur[i + k] * m) > 1e-5) any = true;
      if (!any && !e.active) continue;
      e.active = any;
      if (!e.drivesRot) e.bone.quaternion.copy(e.rest.q); // undriven bones restart from rest (this also undoes an old tweak)
      if (any) e.bone.quaternion.multiply(q.setFromEuler(eul.set(cur[i] * m * D2R, cur[i + 1] * e.flip * m * D2R, cur[i + 2] * e.flip * m * D2R)));
      if (!e.drivesPos) e.bone.position.copy(e.rest.p);
      if (any) e.bone.position.add(v.set(cur[i + 3] * e.flip, cur[i + 4], cur[i + 5]).multiplyScalar((0.001 * m) / e.unit).applyQuaternion(e.parentInv));
    }
  };

  const api = {
    /** [{ name, bone, group, mirrorName }] for every bone, in skeleton order. */
    bones,
    /** [{ name, group: 'shapes', mirrorName }] for the shape keys worth tuning (none on rigs without shape keys). */
    shapes,
    /** The same bone on the other side of the body (an arm bone's twin too, unlike `mirrorName`), or null. */
    twinOf: (name) => byName.get(name)?.twin ?? null,
    /**
     * Key a bone's tweak is stored under when `letter` is the sign being edited: with a keyframe being edited (setEditFrame) every
     * bone of the sign, body and both arms and the face included, goes under that frame ("SIGN@point").
     */
    keyOf(name, letter) {
      const e = byName.get(name);
      // (a bone edited for a base pose goes to the base pose, whatever the sign: the arm being shown, and everything that is not an arm)
      if (editOrient && e && (!e.armSide || e.armSide === editOrient.side)) return `~${editOrient.name}`;
      return editFrame && letter === editFrame.key ? frameKey(letter, editFrame.i) : keyOf(e, letter);
    },
    get(key, name) {
      if (isPoseKey(key) && byName.has(name)) {
        // what the bone has in all: the sign's own tweak and the base pose's (the editor works with totals, see set)
        return sumEntry(ownTweak(byName.get(name)), bucket(key)?.[name]);
      }
      let t = bucket(key)?.[name];
      // a keyframe that says nothing about the bone: the bone has the sign's own tweak there
      const f = parseFrame(key);
      if (!t && f && byName.has(name)) t = bucket(keyOf(byName.get(name), f[0]))?.[name];
      return { rot: [...(t?.rot ?? [0, 0, 0])], pos: [...(t?.pos ?? [0, 0, 0])], w: t?.w ?? 0 };
    },
    set(key, name, value) {
      const e = byName.get(name);
      if (!e) return;
      // (a keyframe keeps a zero too: it then overrides the sign's own tweak with nothing. Only null takes the entry away again)
      let entry;
      if (isPoseKey(key)) {
        // the editor hands over the bone's total tweak; the base pose keeps what is added to the sign's own (to a tenth of a degree)
        const own = ownTweak(e);
        const tenth = (x) => Math.round(x * 10) / 10;
        entry = clean({
          rot: value?.rot?.map((x, k) => tenth(x - (own?.rot?.[k] ?? 0))),
          pos: value?.pos?.map((x, k) => tenth(x - (own?.pos?.[k] ?? 0))),
          w: Number.isFinite(value?.w) ? Math.round((value.w - (own?.w ?? 0)) * 1000) / 1000 : undefined,
        });
      } else entry = parseFrame(key) ? cleanFrame(value) : clean(value);
      if (entry) bucket(key, true)[name] = entry;
      else if (bucket(key)) {
        delete bucket(key)[name];
        prune(key);
      }
      recompute(e.index); // jump straight there so sliders feel direct
    },
    // ---- keyframes
    /** The editor is changing keyframe `i` of sign `key` (all its tweaks go there, see keyOf); null: no keyframe. */
    setEditFrame(key, i = 0) {
      editFrame = key == null ? null : { key, i };
    },
    /** How far along its path the signing hand is, 0..1: the keyframes around it are what the pose is mixed from (call each frame). */
    setProgress(r) {
      if (switching) {
        switching = false; // (the new sign's first pose is eased to, as always)
        progress = r;
        return;
      }
      if (Math.abs(r - progress) < 1e-5) return;
      progress = r;
      if (data.frames[currentKey]) recompute(-2); // the keyframes move with the path, so the pose is right on each frame
    },
    /** Whether keyframe `i` of the sign holds anything. */
    frameHas: (key, i) => !!data.frames[key]?.[i] && Object.keys(data.frames[key][i]).length > 0,
    /** The signs that have keyframes. */
    frameSigns: () => Object.keys(data.frames),
    /**
     * A path point was inserted at `at` (the new point's time is already in the sign's motion): the frames from there on move up,
     * and the new frame starts as what the pose was there before, so that inserting a point changes nothing.
     */
    insertFrame(key, at) {
      const fr = data.frames[key];
      const m = SIGNS[key]?.motion;
      if (!fr || !m) return;
      const moved = {};
      for (const [i, b] of Object.entries(fr)) moved[+i >= at ? +i + 1 : +i] = b;
      data.frames[key] = moved;
      const times = pathTimes(m.path, m.times);
      if (at < 1 || at >= times.length - 1) return recompute(-2);
      const before = moved[at - 1];
      const after = moved[at + 1];
      const s = smooth((times[at] - times[at - 1]) / (times[at + 1] - times[at - 1] || 1));
      const made = {};
      for (const name of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
        const e = byName.get(name);
        if (!e) continue;
        const own = bucket(keyOf(e, key))?.[name];
        made[name] = cleanFrame(mixEntry(before?.[name] ?? own, after?.[name] ?? own, s));
      }
      if (Object.keys(made).length) moved[at] = made;
      recompute(-2);
    },
    /** A path point was removed: its frame goes, the later ones move down. */
    removeFrame(key, at) {
      const fr = data.frames[key];
      if (!fr) return;
      const moved = {};
      for (const [i, b] of Object.entries(fr)) if (+i !== at) moved[+i > at ? +i - 1 : +i] = b;
      if (Object.keys(moved).length) data.frames[key] = moved;
      else delete data.frames[key];
      recompute(-2);
    },
    /** Frame `to` becomes a copy of frame `from` (the bones `from` holds; what `to` held is gone). */
    copyFrame(key, from, to) {
      const src = data.frames[key]?.[from];
      if (src && from !== to) (data.frames[key] ??= {})[to] = structuredClone(src);
      else if (!src) {
        delete data.frames[key]?.[to];
        prune(frameKey(key, to));
      }
      recompute(-2);
    },
    /** Frame `i` holds nothing again (it then follows the sign's own tweaks). */
    clearFrame(key, i) {
      delete data.frames[key]?.[i];
      prune(frameKey(key, i));
      recompute(-2);
    },
    /** All frames of a sign (a copy of the sign's frames goes to another sign, or a removed sign has none). */
    copyFrames(from, to) {
      if (data.frames[from]) data.frames[to] = structuredClone(data.frames[from]);
      else delete data.frames[to];
    },
    dropFrames(key) {
      delete data.frames[key];
      recompute(-2);
    },
    /**
     * The tweak that puts a bone at a given pose in the world, on top of the pose it has without any tweak (the inverse of
     * `apply`). Used by the editor's gizmo.
     * @param worldQ the wanted world orientation of the bone
     * @param worldP the wanted world position of the bone
     * @returns { rot, pos } degrees (Euler XYZ) and millimetres, rounded to one decimal; null for a shape key
     */
    tweakFor(name, worldQ, worldP) {
      const e = byName.get(name);
      if (!e?.bone) return null;
      const parent = e.bone.parent;
      parent.updateWorldMatrix(true, false);
      const m = Math.max(e.armSide ? weight(e.armSide) : 1, 0.05); // the arm's tweaks fade with how far it is raised
      const local = parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(worldQ);
      const delta = e.base.q.clone().invert().multiply(local);
      const euler = new THREE.Euler().setFromQuaternion(delta, 'XYZ');
      const offset = parent.worldToLocal(worldP.clone()).sub(e.base.p).applyQuaternion(e.parentInv.clone().invert());
      const tenth = (x) => Math.round(x * 10) / 10 || 0; // (|| 0 turns -0 into 0)
      return {
        rot: [euler.x, euler.y * e.flip, euler.z * e.flip].map((r) => tenth((r / D2R) / m)),
        pos: offset.multiplyScalar((1000 * e.unit) / m).multiply(v.set(e.flip, 1, 1)).toArray().map(tenth),
      };
    },
    /**
     * The bone that turns when an arm or finger bone is moved: its nearest ancestor of the same arm (the forearm for the hand, the
     * hand for a finger's first joint ...), so the bone stays joined to it. Null for the bones that are only offset (face, body,
     * and the upper arm, whose parent belongs to the body).
     */
    aimParentOf(name) {
      const e = byName.get(name);
      if (!e?.bone || (e.group !== 'right' && e.group !== 'left')) return null;
      for (let p = e.bone.parent; p?.isBone; p = p.parent) if (byName.get(p.name)?.group === e.group) return byName.get(p.name).name;
      return null;
    },
    /**
     * Moving bone `name` to `worldTarget`: the tweak rotation (degrees) of its aim parent (see aimParentOf) that turns the parent about
     * its own joint until the bone points at the target; the parent's own position stays.
     * @returns { name, rot } or null where the bone has no aim parent
     */
    aimParent(name, worldTarget) {
      const parentName = api.aimParentOf(name);
      if (!parentName) return null;
      const pe = byName.get(parentName);
      const parent = pe.bone;
      const pivot = parent.getWorldPosition(new THREE.Vector3());
      const shown = parent.getWorldQuaternion(new THREE.Quaternion()); // the parent as it is shown (the guards and limits have had their say)
      // the parent as its tweak alone poses it, and what was done to it after (the guards): turning is worked out from the first,
      // so the guards' share is not counted into the tweak again with every move
      const i = pe.index * 6;
      const m = pe.armSide ? weight(pe.armSide) : 1;
      const own = pe.base.q.clone().multiply(q.setFromEuler(eul.set(cur[i] * m * D2R, cur[i + 1] * pe.flip * m * D2R, cur[i + 2] * pe.flip * m * D2R)));
      const posed = parent.parent.getWorldQuaternion(new THREE.Quaternion()).multiply(own);
      const guarded = posed.clone().multiply(shown.clone().invert()); // shown = guarded * posed, so this is guarded^-1 (applied to the target)
      const child = byName.get(name).bone.getWorldPosition(new THREE.Vector3()).sub(pivot).applyQuaternion(shown.clone().invert()); // the bone rigid in the parent's frame
      const from = child.applyQuaternion(posed);
      const to = worldTarget.clone().sub(pivot).applyQuaternion(guarded);
      if (from.lengthSq() < 1e-12 || to.lengthSq() < 1e-12) return null;
      const turn = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
      return { name: parentName, rot: api.tweakFor(parentName, posed.premultiply(turn), pivot).rot };
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
      data = { global: {}, keys: {}, frames: {}, poses: {} };
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
      // keyframes ({ sign: { point: { bone: entry } } }); the bones this model lacks are left out
      for (const [sign, points] of Object.entries(raw?.frames && typeof raw.frames === 'object' ? raw.frames : {})) {
        for (const [i, tw] of Object.entries(points && typeof points === 'object' ? points : {})) {
          const known = {};
          for (const [name, e] of Object.entries(tw && typeof tw === 'object' ? tw : {})) {
            const c = cleanFrame(e);
            if (c && byName.has(name)) known[name] = c;
          }
          if (Object.keys(known).length && Number.isInteger(+i) && +i >= 0) (data.frames[sign] ??= {})[+i] = known;
        }
      }
      // base-pose bone tweaks ({ orient: { bone: entry } })
      for (const [orient, tw] of Object.entries(raw?.poses && typeof raw.poses === 'object' ? raw.poses : {})) {
        const known = {};
        for (const [name, e] of Object.entries(tw && typeof tw === 'object' ? tw : {})) {
          const c = clean(e);
          if (c && byName.has(name)) known[name] = c;
        }
        if (Object.keys(known).length) data.poses[orient] = known;
      }
      recompute(-2);
    },
    /** Everything, including the entries of bones this model lacks. */
    export() {
      const keys = {};
      for (const key of new Set([...Object.keys(data.keys), ...Object.keys(foreign.keys)])) {
        keys[key] = { ...foreign.keys[key], ...data.keys[key] };
      }
      return structuredClone({ global: { ...foreign.global, ...data.global }, keys, frames: data.frames, poses: data.poses });
    },
    /** Whether the left arm does something in `letter` (its tweaks differ from standby's), i.e. the letter is two-handed. */
    usesLeftArm(letter) {
      const own = bucket(letter);
      const rest = bucket(STANDBY);
      return bones.some((e) => e.group === 'left' && JSON.stringify(own?.[e.name] ?? null) !== JSON.stringify(rest?.[e.name] ?? null));
    },
    /** The sign being shown (a letter, STANDBY or null) selects which tweaks apply to face and signing arm. */
    setKey(key) {
      if (key === currentKey) return;
      currentKey = key;
      switching = true;
      recompute();
    },
    /**
     * One arm ('L' | 'R') shows only the base pose `orient`'s bone tweaks, without the sign's own (and without keyframes), until called
     * with null: the base-pose editor shows the arm as the orient poses it.
     */
    suspendArm(side, orient = null) {
      suspended = side;
      suspendedOrient = orient;
      recompute(-2);
    },
    /** The editor is changing the bones of `side`'s arm for base pose `name` (all their tweaks go there, see keyOf); null: no. */
    setEditOrient(next) {
      editOrient = next;
    },
    /** The base poses that have bone tweaks. */
    poseNames: () => Object.keys(data.poses),
    /**
     * Put the bones / shapes `pick(entry)` is true for (all: no `pick`) of base pose `orient` back to the pose they have in the model's
     * file (the GLB): the tweak that turns a bone back to its rest rotation and position, whatever poses it (the hand's IK, the sign's own
     * tweaks), and shape weights 0. What the base pose keeps is the difference to the sign's own tweaks (see set).
     */
    restPose(orient, pick = null) {
      for (const e of items) {
        if (pick && !pick(e)) continue;
        if (e.shape) {
          api.set(`~${orient}`, e.name, { w: 0 });
          continue;
        }
        // (the inverse of apply: the bone's rest pose on top of the pose it has without any tweak, see tweakFor)
        const m = Math.max(e.armSide ? weight(e.armSide) : 1, 0.05);
        const euler = new THREE.Euler().setFromQuaternion(e.base.q.clone().invert().multiply(e.rest.q), 'XYZ');
        const offset = e.rest.p.clone().sub(e.base.p).applyQuaternion(e.parentInv.clone().invert());
        const tenth = (x) => Math.round(x * 10) / 10 || 0;
        api.set(`~${orient}`, e.name, {
          rot: [euler.x, euler.y * e.flip, euler.z * e.flip].map((r) => tenth(r / D2R / m)),
          pos: offset.multiplyScalar((1000 * e.unit) / m).multiply(new THREE.Vector3(e.flip, 1, 1)).toArray().map(tenth),
        });
      }
    },
    /** Take the tweaks of a base pose away again: all of them, or only those of the bones / shapes `pick(entry)` is true for. */
    clearPose(orient, pick = null) {
      const p = data.poses[orient];
      if (p && pick) {
        for (const name of Object.keys(p)) if (pick(byName.get(name))) delete p[name];
        if (!Object.keys(p).length) delete data.poses[orient];
      } else delete data.poses[orient];
      recompute(-2);
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
