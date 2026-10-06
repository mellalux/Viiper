import * as THREE from 'three';
import limitsFile from '../data/limits.json';
import { detectRig } from '../character/rigs.js';

// Joint limits for the finger bones, applied last (after hands.js has posed the fingers and the tweaks have been layered on
// top), so that no sign, motion or hand-tuned offset can bend a finger the wrong way or twist it through its neighbours.
// A finger bone's rotation relative to its rest pose is split into curl (about the rig's curl axis, + = towards the palm),
// spread (+ = towards the little finger) and twist (the remaining axis); each is clamped to the range given in
// limits.json `finger.<mcp|pip|dip>` (degrees; edited in the fine-tuning window). A range that is left out means "no limit" on that axis.
const D2R = THREE.MathUtils.DEG2RAD;
const LETTERS = ['X', 'Y', 'Z'];
const FINGER_JOINTS = ['mcp', 'pip', 'dip'];

export function createLimits(root) {
  const rig = detectRig(root);
  if (!rig) return null;

  const curlAxis = rig.curlAxis;
  const spreadAxis = rig.spreadAxis;
  const twistAxis = 3 - curlAxis - spreadAxis;
  // the fingers were posed as rest * spread * curl, so that is the order to take them apart in
  const order = LETTERS[spreadAxis] + LETTERS[twistAxis] + LETTERS[curlAxis];

  // the ranges, per joint kind (limits.json `finger`): { mcp: { curl, spread, twist }, ... }; edited in the fine-tuning window
  let table = {};
  let enabled = true;

  const joints = [];
  const byName = new Map();
  for (const side of ['R', 'L']) {
    // a left bone is mirrored: a rotation about Y or Z flips sign (see hands.js)
    const sign = side === 'L' ? [1, -1, -1] : [1, 1, 1];
    rig.fingers.forEach((_, f) =>
      FINGER_JOINTS.forEach((joint, n) => {
        const bone = root.getObjectByName(rig.finger(side, f, n + 1));
        if (!bone) return;
        const j = {
          name: bone.name, bone, rest: bone.quaternion.clone(), joint, excess: [0, 0, 0],
          // multiply a normalised value (curl towards the palm, spread towards the little finger) by this to get the Euler angle
          signs: [sign[curlAxis], sign[spreadAxis] * rig.spreadSign, sign[twistAxis]],
        };
        joints.push(j);
        byName.set(j.name, j);
      }),
    );
  }

  const eul = new THREE.Euler();
  const q = new THREE.Quaternion();
  const restInv = new THREE.Quaternion();
  const clampTo = (v, range) => (range ? Math.min(Math.max(v, range[0] * D2R), range[1] * D2R) : v);

  /** The joint's angles from its rest pose, radians [curl, spread, twist] (the Euler angles are left in `eul`). */
  function measure(j) {
    restInv.copy(j.rest).invert();
    q.copy(restInv).multiply(j.bone.quaternion);
    eul.setFromQuaternion(q, order);
    const byLetter = { X: eul.x, Y: eul.y, Z: eul.z };
    return [byLetter[LETTERS[curlAxis]] * j.signs[0], byLetter[LETTERS[spreadAxis]] * j.signs[1], byLetter[LETTERS[twistAxis]] * j.signs[2]];
  }

  /** Clamp one joint; returns the excess in degrees per axis ([curl, spread, twist], zero where within the range) or null. */
  function limit(j, apply) {
    const range = table[j.joint];
    const value = measure(j);
    const byLetter = { X: eul.x, Y: eul.y, Z: eul.z };
    const clamped = [clampTo(value[0], range?.curl), clampTo(value[1], range?.spread), clampTo(value[2], range?.twist)];
    const excess = clamped.map((c, i) => (value[i] - c) / D2R);
    if (!excess.some((x) => Math.abs(x) > 1e-3)) {
      j.excess.fill(0);
      return null;
    }
    j.excess = excess;
    if (apply) {
      byLetter[LETTERS[curlAxis]] = clamped[0] * j.signs[0];
      byLetter[LETTERS[spreadAxis]] = clamped[1] * j.signs[1];
      byLetter[LETTERS[twistAxis]] = clamped[2] * j.signs[2];
      eul.set(byLetter.X, byLetter.Y, byLetter.Z, order);
      j.bone.quaternion.copy(j.rest).multiply(q.setFromEuler(eul));
    }
    return excess;
  }

  const api = {
    /** Clamp every finger joint; call after the tweaks. */
    apply() {
      if (!enabled) return;
      for (const j of joints) limit(j, true);
    },
    /** Debug: which joints are outside their range right now, without changing anything: [{ bone, curl, spread, twist }] in degrees of excess. */
    report() {
      const out = [];
      for (const j of joints) {
        const e = limit(j, false);
        if (e) out.push({ bone: j.name, curl: +e[0].toFixed(1), spread: +e[1].toFixed(1), twist: +e[2].toFixed(1) });
      }
      return out;
    },
    /** Switch the clamping off to pose the fingers freely (the ranges are kept). */
    get enabled() {
      return enabled;
    },
    set enabled(on) {
      enabled = !!on;
      if (!enabled) for (const j of joints) j.excess.fill(0);
    },
    /** Which joint kind ('mcp' | 'pip' | 'dip') a bone is, or null when it is not one of the four fingers' bones. */
    jointOf: (name) => byName.get(name)?.joint ?? null,
    /** For a finger bone: which Euler axis (0 x, 1 y, 2 z) each of curl / spread / twist turns, and the sign (an Euler angle = value * sign). */
    axes(name) {
      const j = byName.get(name);
      return j && { curl: [curlAxis, j.signs[0]], spread: [spreadAxis, j.signs[1]], twist: [twistAxis, j.signs[2]] };
    },
    get: (joint) => structuredClone(table[joint] ?? null),
    set(joint, range) {
      const c = cleanFinger(range);
      if (c) table[joint] = c;
      else delete table[joint];
    },
    /** The bone's angles from its rest pose right now, degrees [curl, spread, twist]. */
    current: (name) => (byName.has(name) ? measure(byName.get(name)).map((r) => r / D2R) : [0, 0, 0]),
    /** How far the last apply() had to turn the bone back, degrees [curl, spread, twist]. */
    excess: (name) => byName.get(name)?.excess ?? [0, 0, 0],
    /** Replace every range ({ mcp, pip, dip }: { curl, spread, twist } each [min, max] degrees); malformed ones are skipped. */
    load(raw) {
      table = {};
      for (const joint of FINGER_JOINTS) {
        const c = cleanFinger(raw?.[joint]);
        if (c) table[joint] = c;
      }
    },
    export: () => structuredClone(table),
  };
  api.load(limitsFile.finger);
  return api;
}

const FINGER_AXES = ['curl', 'spread', 'twist'];
/** Normalise one finger joint's ranges (min <= max, within a full turn); null when it limits nothing. */
function cleanFinger(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const a of FINGER_AXES) {
    const r = raw[a];
    if (!Array.isArray(r) || r.length !== 2 || !r.every(Number.isFinite)) continue;
    const lo = Math.min(Math.max(Math.min(r[0], r[1]), -180), 180);
    const hi = Math.min(Math.max(Math.max(r[0], r[1]), -180), 180);
    if (lo > -180 || hi < 180) out[a] = [lo, hi];
  }
  return Object.keys(out).length ? out : null;
}

// ------------------------------------------------------------------ rotation limits of any single bone
// Set by hand in the fine-tuning window and kept in limits.json: `bones.<name>` = { x?: [min, max], y?, z? } in degrees, the
// bone's rotation measured from its rest pose as Euler XYZ in its own axes (the same axes as the editor's "Pööre" sliders). Every
// bone of the model can have one. A range is [min, max] and need not contain 0 (a bone whose range lies away from its rest pose is held at the nearest end); an axis without a range is free.
// Euler Y only reaches +-90 in this order, so that is as far as its limit goes.
const AXES = ['x', 'y', 'z'];
const AXIS_MAX = { x: 180, y: 90, z: 180 };
const EPS = 1e-3;

/** The ranges as limits.json holds them: { boneName: { x, y, z } }. */
export const boneLimitsFromFile = () => structuredClone(limitsFile.bones ?? {});

/** Largest angle of an axis (180, but 90 for y), for the editor's number fields. */
export const axisMax = (axis) => AXIS_MAX[axis];

/** The twin bone's ranges: a rotation about X keeps its sign, about Y and Z flips (as the editor mirrors tweaks). */
export function mirrorRange(range) {
  if (!range) return null;
  const out = {};
  if (range.x) out.x = [...range.x];
  for (const a of ['y', 'z']) if (range[a]) out[a] = [-range[a][1], -range[a][0]];
  return out;
}

/** Normalise one entry; null when it limits nothing (or is malformed). */
function clean(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const a of AXES) {
    const r = raw[a];
    if (!Array.isArray(r) || r.length !== 2 || !r.every(Number.isFinite)) continue;
    const max = AXIS_MAX[a];
    const lo = Math.min(Math.max(Math.min(r[0], r[1]), -max), max);
    const hi = Math.min(Math.max(Math.max(r[0], r[1]), -max), max);
    if (lo > -max || hi < max) out[a] = [lo, hi];
  }
  return Object.keys(out).length ? out : null;
}

export function createBoneLimits(root) {
  const list = [];
  const byName = new Map();
  root.traverse((bone) => {
    if (!bone.isBone) return;
    const e = { name: bone.name, bone, rest: bone.quaternion.clone(), range: null, excess: [0, 0, 0] };
    list.push(e);
    byName.set(e.name, e);
  });

  let foreign = {}; // entries for bones this model doesn't have: kept untouched so saving never drops them
  let active = []; // the bones that have a range
  let enabled = true;
  const eul = new THREE.Euler();
  const q = new THREE.Quaternion();
  const restInv = new THREE.Quaternion();

  const refresh = () => (active = list.filter((e) => e.range));
  /** Rotation of a bone from its rest pose as Euler XYZ (radians, into `eul`). */
  const relative = (e) => eul.setFromQuaternion(q.copy(restInv.copy(e.rest).invert()).multiply(e.bone.quaternion), 'XYZ');

  const api = {
    /** Every bone of the model, in skeleton order. */
    names: list.map((e) => e.name),
    /** Switch the clamping off to pose a bone freely (the ranges are kept). */
    get enabled() {
      return enabled;
    },
    set enabled(on) {
      enabled = !!on;
      if (!enabled) for (const e of list) e.excess.fill(0);
    },
    get: (name) => structuredClone(byName.get(name)?.range ?? null),
    set(name, range) {
      const e = byName.get(name);
      if (e) {
        e.range = clean(range);
        e.excess.fill(0);
        refresh();
      }
    },
    /** The bone's rotation from its rest pose right now, degrees [x, y, z]. */
    current(name) {
      const e = byName.get(name);
      if (!e) return [0, 0, 0];
      relative(e);
      return [eul.x, eul.y, eul.z].map((r) => r / D2R);
    },
    /** How far the last apply() had to turn the bone back, degrees [x, y, z] (0 where it was within its range). */
    excess: (name) => byName.get(name)?.excess ?? [0, 0, 0],
    /** Clamp every bone that has a range; call last in the frame, after everything else has posed the rig. */
    apply() {
      if (!enabled) return;
      for (const e of active) {
        relative(e);
        const v = [eul.x, eul.y, eul.z];
        let hit = false;
        AXES.forEach((a, i) => {
          const r = e.range[a];
          const c = r ? Math.min(Math.max(v[i], r[0] * D2R), r[1] * D2R) : v[i];
          e.excess[i] = (v[i] - c) / D2R;
          if (Math.abs(e.excess[i]) < EPS) e.excess[i] = 0;
          else hit = true;
          v[i] = c;
        });
        if (hit) e.bone.quaternion.copy(e.rest).multiply(q.setFromEuler(eul.set(v[0], v[1], v[2], 'XYZ')));
      }
    },
    /** Replace everything ({ boneName: { x, y, z } }); malformed entries are skipped. */
    load(raw) {
      foreign = {};
      for (const e of list) e.range = null;
      for (const [name, r] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
        const c = clean(r);
        if (!c) continue;
        if (byName.has(name)) byName.get(name).range = c;
        else foreign[name] = c;
      }
      refresh();
    },
    /** Everything, including the entries of bones this model lacks: skeleton order first. */
    export() {
      const out = {};
      for (const e of list) if (e.range) out[e.name] = structuredClone(e.range);
      return { ...out, ...structuredClone(foreign) };
    },
  };
  api.load(boneLimitsFromFile());
  return api;
}
