import * as THREE from 'three';
import shared from '../data/shared.json';
import fingerspelling from '../data/fingerspelling.json';
import { detectRig } from '../character/rigs.js';

// Estonian finger-spelling (sõrmendid) on the model's right hand.
//
// Hand frame (Rigify, right hand): local +Y runs along the fingers, +Z points to the thumb side,
// -X is the palm normal. Finger bones curl about their local X (positive = towards the palm) and
// spread about their local Z (positive = towards the pinky).
// (GLTFLoader strips dots from node names: upper_armR, f_index01R, thumb02R, ...)

// Sign data is hand-edited JSON. shared.json holds what finger-spelling and word signs have in common (the `visemes`,
// `letters` and `rigs` sections are the mouth shapes and per-rig data, read by mouth.js and rigs.js):
//   orient     where the hand is held and which way it points. `finger`/`thumb` are world directions
//              (model faces +Z, +X is the viewer's right), `reach` the wrist target relative to the shoulder in
//              units of the arm's full length, optional `pole` (elbow hint) and `maxBend` (wrist limit, degrees).
//              Right hand, palm towards the viewer; the left hand is mirrored.
//   thumbPoses thumb joint rotations (Euler XYZ per joint: thumb.01, .02, .03), radians.
// fingerspelling.json holds the letters:
//   signs      per letter: curl = [index, middle, ring, pinky], 0 straight .. 1 fully curled; dir = an orient;
//              thumb = a thumb pose; spread = same finger order (radians, optional); knuckle = extra bend (radians)
//              of the finger at the base joint only, keeping the finger straight (optional).
// Fine-tuning made with the bone editor (rotation and position of any bone, see tweaks.js) is stored in fingerspelling.json:
//   signs.<letter>.tweaks and global.
export const ORIENT = shared.orient;

// Elbow/solver settings. Wrist targets (relative to the shoulder, in units of the arm's full length) are per orientation above.
export const HAND_CONFIG = {
  pole: [-0.25, -1, -0.35], // elbow points down/out/back
  curlJoints: [1.45, 1.75, 1.15], // MCP, PIP, DIP at full curl (radians)
  maxWristBend: 80, // degrees between forearm and fingers; a real wrist bends less than ~85°
  smoothing: 14,
};

export const THUMB_POSES = Object.fromEntries(Object.entries(shared.thumbPoses).map(([k, p]) => [k, p.joints]));

// Pseudo-letter for the standby pose: shown between signs (instead of lowering the arm) and tunable like a letter.
export const STANDBY = 'ootel';
const STANDBY_DIR = { R: 'ready', L: 'relaxed' }; // which orient each hand waits in

export const SIGNS = Object.fromEntries(
  Object.entries(fingerspelling.signs).map(([letter, sign]) => [letter, { spread: [0, 0, 0, 0], knuckle: [0, 0, 0, 0], ...sign }]),
);

// What a sign's `left` part (the other hand's share in two-handed letters such as Q and X) leaves out
const LEFT_DEFAULTS = { spread: [0, 0, 0, 0], knuckle: [0, 0, 0, 0], thumb: 'rest', dir: 'up' };

const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];

// A sign can move the hand while it is shown (Z draws its letter in the air): `motion` = { path, duration } in fingerspelling.json.
// path = wrist offsets [x, y] from the tuned pose, in units of the arm's full length (+x = the viewer's right, +y up);
// the first point is the pose as tuned, so it should be [0, 0]. The hand takes the path once, slowing at the corners.
const MOTION_LEAD = 0.3; // seconds the hand takes to get back to the start of the path
const smooth = (s) => s * s * (3 - 2 * s);

/** Point at fraction `r` (0..1) of the path; every segment gets a share of the time in proportion to its length. */
function tracePoint(path, r, out) {
  const lens = path.slice(1).map((b, i) => Math.hypot(b[0] - path[i][0], b[1] - path[i][1]));
  const total = lens.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  for (let i = 0; i < lens.length; i++) {
    const share = lens[i] / total;
    if (r <= acc + share || i === lens.length - 1) {
      const e = smooth(Math.min(Math.max((r - acc) / share, 0), 1));
      const [a, b] = [path[i], path[i + 1]];
      return out.set(a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, 0);
    }
    acc += share;
  }
  return out.set(0, 0, 0);
}

export function createHands(root, side = 'R') {
  root.updateMatrixWorld(true);
  const rig = detectRig(root);
  if (!rig) return null;
  const get = (name) => root.getObjectByName(name);
  const names = rig.arm(side);
  const upperArm = get(names.upperArm);
  const foreArm = get(names.foreArm);
  const hand = get(names.hand);
  if (!upperArm || !foreArm || !hand) return null;
  const thumbPoses = Object.fromEntries(Object.entries(rig.thumbPoses).map(([k, p]) => [k, p.joints]));

  // Blender mirrors the left hand's bones with local X negated: a rotation about local X keeps its sign, one about Y or Z
  // flips, and world-space directions mirror in x.
  const sgn = side === 'L' ? -1 : 1;
  const axisSign = side === 'L' ? [1, -1, -1] : [1, 1, 1];
  const curlAxis = AXES[rig.curlAxis];
  const spreadAxis = AXES[rig.spreadAxis];
  const mx = (a) => [a[0] * sgn, a[1], a[2]];
  const orientOf = (name) => {
    const o = ORIENT[name];
    return { ...o, finger: mx(o.finger), thumb: mx(o.thumb), reach: mx(o.reach), pole: o.pole && mx(o.pole) };
  };

  // --- rest pose (arm hanging down), in world space ---
  const wp = (o) => o.getWorldPosition(new THREE.Vector3());
  const wq = (o) => o.getWorldQuaternion(new THREE.Quaternion());
  const rest = {
    uaQ: wq(upperArm), faQ: wq(foreArm),
    uaDir: wp(foreArm).sub(wp(upperArm)),
    faDir: wp(hand).sub(wp(foreArm)),
    uaLocal: upperArm.quaternion.clone(), faLocal: foreArm.quaternion.clone(), handLocal: hand.quaternion.clone(),
  };
  const l1 = rest.uaDir.length();
  const l2 = rest.faDir.length();
  rest.uaDir.normalize();
  rest.faDir.normalize();

  const digits = rig.fingers.map((_, f) =>
    [1, 2, 3].map((n) => {
      const bone = get(rig.finger(side, f, n));
      return bone && { bone, rest: bone.quaternion.clone() };
    }),
  );
  const thumbs = [1, 2, 3].map((n) => {
    const bone = get(rig.thumb(side, n));
    return bone && { bone, rest: bone.quaternion.clone() };
  });

  /** Every bone this hand poses: upper arm, forearm, hand, then the finger and thumb joints. */
  const boneList = [upperArm, foreArm, hand, ...digits.flat().filter(Boolean).map((j) => j.bone), ...thumbs.filter(Boolean).map((j) => j.bone)];
  let letter = null; // pose currently aimed at (a letter or STANDBY)
  let requested = null; // what the caller last asked for (null = no sign)
  let standby = true;

  // --- animated state ---
  const cur = { w: 0, tw: 0, follow: 0, maxBend: HAND_CONFIG.maxWristBend, pole: new THREE.Vector3(...mx(HAND_CONFIG.pole)), knuckle: [0, 0, 0, 0], reach: new THREE.Vector3(...mx(ORIENT.up.reach)), curl: [0, 0, 0, 0], spread: [0, 0, 0, 0], thumb: new Array(9).fill(0), qHand: wq(hand) };
  const tgt = { w: 0, tw: 0, follow: 0, maxBend: HAND_CONFIG.maxWristBend, pole: new THREE.Vector3(...mx(HAND_CONFIG.pole)), knuckle: [0, 0, 0, 0], reach: new THREE.Vector3(...mx(ORIENT.up.reach)), curl: [0, 0, 0, 0], spread: [0, 0, 0, 0], thumb: new Array(9).fill(0), qHand: cur.qHand.clone() };

  const shoulderPos = new THREE.Vector3();
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  const eul = new THREE.Euler();

  // --- motion along a sign's path (see MOTION_LEAD): `off` is the wrist offset in arm lengths, applied after the tweaks ---
  const motion = { def: null, t: 0, from: new THREE.Vector3(), off: new THREE.Vector3(), paused: false };

  const stepMotion = (dt, k) => {
    const def = motion.def;
    if (!def || motion.paused) {
      // no path (or the editor / a frozen pose holds the start): ease back to the tuned pose, at once when paused
      if (motion.paused) motion.t = 0;
      motion.off.multiplyScalar(motion.paused ? 0 : 1 - k);
      return;
    }
    motion.t += Math.min(dt, 0.05); // a stalled frame must not skip the drawing
    if (motion.t < MOTION_LEAD) motion.off.copy(motion.from).multiplyScalar(1 - smooth(motion.t / MOTION_LEAD));
    else tracePoint(def.path, (motion.t - MOTION_LEAD) / def.duration, motion.off);
  };

  const applyMotion = () => {
    if (motion.off.lengthSq() < 1e-8) return;
    upperArm.updateWorldMatrix(true, true);
    const shoulder = wp(upperArm);
    const elbow = wp(foreArm);
    const wrist = wp(hand);
    const handQ = wq(hand);
    const len1 = shoulder.distanceTo(elbow);
    const len2 = elbow.distanceTo(wrist);
    const scale = (len1 + len2) * cur.tw;
    const target = wrist.clone().add(new THREE.Vector3(motion.off.x * scale, motion.off.y * scale, 0));
    // two-bone IK to the moved wrist, the elbow keeping the side it is on now
    const d = target.clone().sub(shoulder);
    const dist = Math.min(Math.max(d.length(), 1e-3), len1 + len2 - 1e-4);
    const u = d.normalize();
    const pole = elbow.clone().sub(shoulder);
    const wasU = wrist.clone().sub(shoulder).normalize();
    pole.addScaledVector(wasU, -pole.dot(wasU));
    pole.addScaledVector(u, -pole.dot(u)).normalize();
    const a = (len1 * len1 - len2 * len2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(len1 * len1 - a * a, 0));
    const newElbow = shoulder.clone().addScaledVector(u, a).addScaledVector(pole, h);

    const parentInv = upperArm.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    const uaQ = new THREE.Quaternion().setFromUnitVectors(elbow.clone().sub(shoulder).normalize(), newElbow.clone().sub(shoulder).normalize());
    const faDir = wrist.clone().sub(elbow).normalize().applyQuaternion(uaQ);
    const faQ = new THREE.Quaternion().setFromUnitVectors(faDir, target.clone().sub(newElbow).normalize()).multiply(uaQ);
    const newUa = uaQ.multiply(wq(upperArm));
    const newFa = faQ.multiply(wq(foreArm));
    upperArm.quaternion.copy(parentInv.multiply(newUa));
    foreArm.quaternion.copy(newUa.clone().invert().multiply(newFa));
    hand.quaternion.copy(newFa.invert().multiply(handQ)); // the hand keeps pointing the way it did
  };

  const handQuat = (orient) => {
    const y = new THREE.Vector3(...orient.finger).normalize();
    const z = new THREE.Vector3(...orient.thumb).normalize();
    z.addScaledVector(y, -z.dot(y)).normalize();
    const x = new THREE.Vector3().crossVectors(y, z);
    return new THREE.Quaternion().setFromRotationMatrix(m.makeBasis(x, y, z));
  };

  const pose = () => {
    // ---- arm: two-bone IK towards the wrist target ----
    const parentQ = upperArm.parent.getWorldQuaternion(new THREE.Quaternion());
    upperArm.getWorldPosition(shoulderPos);
    const reach = l1 + l2;
    const target = shoulderPos.clone().add(cur.reach.clone().multiplyScalar(reach));
    const d = target.clone().sub(shoulderPos);
    const dist = Math.min(Math.max(d.length(), 1e-3), reach - 1e-4);
    const u = d.normalize();
    const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
    const pole = cur.pole.clone().normalize();
    pole.addScaledVector(u, -pole.dot(u)).normalize();
    const elbow = shoulderPos.clone().addScaledVector(u, a).addScaledVector(pole, h);
    const wrist = shoulderPos.clone().addScaledVector(u, dist);

    const uaQ = new THREE.Quaternion().setFromUnitVectors(rest.uaDir, elbow.clone().sub(shoulderPos).normalize()).multiply(rest.uaQ);
    const faQ = new THREE.Quaternion().setFromUnitVectors(rest.faDir, wrist.clone().sub(elbow).normalize()).multiply(rest.faQ);
    const w = cur.w;
    const toLocal = (parent, world) => parent.clone().invert().multiply(world);
    const uaLocal = toLocal(parentQ, uaQ);
    const faLocal = toLocal(uaQ, faQ);
    // Keep the wrist bend humanly possible: if the fingers point too far away from the forearm's
    // direction, rotate the whole hand back towards it.
    const handQ = cur.qHand.clone();
    const armDir = wrist.clone().sub(elbow).normalize();
    if (cur.follow > 0.001) {
      // straight wrist: fingers along the forearm, thumb towards the hint direction (palm down)
      const y = armDir.clone();
      const z = new THREE.Vector3(...mx(ORIENT.hang.thumb));
      z.addScaledVector(y, -z.dot(y)).normalize();
      const x = new THREE.Vector3().crossVectors(y, z);
      handQ.slerp(new THREE.Quaternion().setFromRotationMatrix(m.makeBasis(x, y, z)), cur.follow);
    }
    const fingerDir = new THREE.Vector3(0, 1, 0).applyQuaternion(handQ);
    const bend = fingerDir.angleTo(armDir);
    const maxBend = THREE.MathUtils.degToRad(cur.maxBend);
    if (bend > maxBend) {
      const axis = new THREE.Vector3().crossVectors(fingerDir, armDir).normalize();
      handQ.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, bend - maxBend));
    }
    const handLocal = toLocal(faQ, handQ);
    upperArm.quaternion.copy(rest.uaLocal).slerp(uaLocal, w);
    foreArm.quaternion.copy(rest.faLocal).slerp(faLocal, w);
    hand.quaternion.copy(rest.handLocal).slerp(handLocal, w);

    // ---- fingers ----
    digits.forEach((joints, i) => {
      joints.forEach((j, n) => {
        if (!j) return;
        j.bone.quaternion.copy(j.rest);
        if (n === 0) j.bone.quaternion.multiply(q.setFromAxisAngle(spreadAxis, cur.spread[i] * w));
        const angle = cur.curl[i] * HAND_CONFIG.curlJoints[n] + (n === 0 ? cur.knuckle[i] : 0);
        j.bone.quaternion.multiply(q.setFromAxisAngle(curlAxis, angle * axisSign[rig.curlAxis] * w));
      });
    });
    thumbs.forEach((j, n) => {
      if (!j) return;
      const [ex, ey, ez] = cur.thumb.slice(n * 3, n * 3 + 3);
      j.bone.quaternion.copy(j.rest).multiply(q.setFromEuler(eul.set(ex * w, ey * w, ez * w)));
    });
  };

  const api = {
    side,
    boneList,
    /** The pose being shown (a letter or STANDBY), or null when the arm is lowered. */
    get key() {
      return tgt.tw > 0 ? letter : null;
    },
    /**
     * How strongly the fine-tuning of this arm's bones applies, 0 .. 1: fully while a sign (even an undefined one, whose
     * hand then just rests as the model has it) is shown, fading out when the arm is lowered.
     */
    get weight() {
      return cur.tw;
    },
    /**
     * Aim the hand at a letter's sign. Null/unknown shows the standby pose, or lowers the arm when standby is off.
     * The left hand only takes part in letters that give it a `left` pose; in all others it waits in standby.
     */
    setSign(l) {
      requested = l;
      const own = side === 'L' ? SIGNS[l]?.left && { ...LEFT_DEFAULTS, ...SIGNS[l].left } : SIGNS[l];
      const key = own ? l : standby ? STANDBY : null;
      motion.def = own?.motion ?? null; // a pressed letter with a path draws it from the start
      motion.t = 0;
      motion.from.copy(motion.off);
      const sign = own || SIGNS[key];
      // A sign without finger data is undefined: the hand stays as the model has it (w = 0) and only the hand-tuned
      // offsets of that sign show, which is how a sign gets defined from scratch.
      const defined = Array.isArray(sign?.curl);
      tgt.w = defined ? 1 : 0;
      tgt.tw = sign ? 1 : 0;
      if (!sign) return;
      letter = key;
      if (!defined) return;
      const o = orientOf(key === STANDBY ? STANDBY_DIR[side] : sign.dir);
      tgt.curl = [...sign.curl];
      tgt.spread = sign.spread.map((s) => s * axisSign[rig.spreadAxis] * rig.spreadSign);
      tgt.thumb = thumbPoses[sign.thumb].flat().map((v, i) => v * axisSign[i % 3]);
      tgt.follow = o.follow ? 1 : 0;
      tgt.knuckle = [...sign.knuckle];
      if (!tgt.follow) tgt.qHand = handQuat(o);
      tgt.reach.set(...o.reach);
      tgt.maxBend = o.maxBend ?? HAND_CONFIG.maxWristBend;
      tgt.pole.set(...(o.pole ?? mx(HAND_CONFIG.pole)));
    },
    /** Whether the hand waits in the standby pose between signs (true) or lowers the arm (false). */
    setStandby(on) {
      standby = on;
      this.setSign(requested);
    },
    snapSign(letter) {
      this.setSign(letter);
      cur.w = tgt.w;
      cur.tw = tgt.tw;
      cur.curl = [...tgt.curl];
      cur.follow = tgt.follow;
      cur.knuckle = [...tgt.knuckle];
      cur.spread = [...tgt.spread];
      cur.thumb = [...tgt.thumb];
      cur.qHand.copy(tgt.qHand);
      cur.reach.copy(tgt.reach);
      cur.pole.copy(tgt.pole);
      cur.maxBend = tgt.maxBend;
      pose();
    },
    update(dt) {
      const k = 1 - Math.exp(-HAND_CONFIG.smoothing * dt);
      cur.w += (tgt.w - cur.w) * k;
      cur.tw += (tgt.tw - cur.tw) * k;
      cur.follow += (tgt.follow - cur.follow) * k;
      for (let i = 0; i < 4; i++) cur.knuckle[i] += (tgt.knuckle[i] - cur.knuckle[i]) * k;
      for (let i = 0; i < 4; i++) {
        cur.curl[i] += (tgt.curl[i] - cur.curl[i]) * k;
        cur.spread[i] += (tgt.spread[i] - cur.spread[i]) * k;
      }
      for (let i = 0; i < 9; i++) cur.thumb[i] += (tgt.thumb[i] - cur.thumb[i]) * k;
      cur.qHand.slerp(tgt.qHand, k);
      cur.reach.lerp(tgt.reach, k);
      cur.pole.lerp(tgt.pole, k);
      cur.maxBend += (tgt.maxBend - cur.maxBend) * k;
      pose();
      stepMotion(dt, k);
    },
    /** Move the hand along its sign's path; call after the tweaks have been applied. */
    applyMotion,
    /** True while the path must not play (frozen debug pose, bone editor open): the hand holds the tuned pose. */
    set motionPaused(v) {
      motion.paused = v;
    },
  };
  return api;
}
