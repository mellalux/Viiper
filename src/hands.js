import * as THREE from 'three';
import signData from './signs.json';
import { detectRig } from './rigs.js';

// Estonian finger-spelling (sõrmendid) on the model's right hand.
//
// Hand frame (Rigify, right hand): local +Y runs along the fingers, +Z points to the thumb side,
// -X is the palm normal. Finger bones curl about their local X (positive = towards the palm) and
// spread about their local Z (positive = towards the pinky).
// (GLTFLoader strips dots from node names: upper_armR, f_index01R, thumb02R, ...)

// All sign data lives in signs.json (hand-edited, the base source for the finger-spelling; the `visemes` and
// `letters` sections are the mouth shapes, read by mouth.js):
//   orient     where the hand is held and which way it points. `finger`/`thumb` are world directions
//              (model faces +Z, +X is the viewer's right), `reach` the wrist target relative to the shoulder in
//              units of the arm's full length, optional `pole` (elbow hint) and `maxBend` (wrist limit, degrees).
//              Right hand, palm towards the viewer; the left hand is mirrored.
//   thumbPoses thumb joint rotations (Euler XYZ per joint: thumb.01, .02, .03), radians.
//   signs      per letter: curl = [index, middle, ring, pinky], 0 straight .. 1 fully curled; dir = an orient;
//              thumb = a thumb pose; spread = same finger order (radians, optional); knuckle = extra bend (radians)
//              of the finger at the base joint only, keeping the finger straight (optional).
// Fine-tuning made with the bone editor (rotation and position of any bone, see tweaks.js) is stored in the same file:
//   signs.<letter>.tweaks and global.
export const ORIENT = signData.orient;

// Elbow/solver settings. Wrist targets (relative to the shoulder, in units of the arm's full length) are per orientation above.
export const HAND_CONFIG = {
  pole: [-0.25, -1, -0.35], // elbow points down/out/back
  curlJoints: [1.45, 1.75, 1.15], // MCP, PIP, DIP at full curl (radians)
  maxWristBend: 80, // degrees between forearm and fingers; a real wrist bends less than ~85°
  smoothing: 14,
};

export const THUMB_POSES = Object.fromEntries(Object.entries(signData.thumbPoses).map(([k, p]) => [k, p.joints]));

// Pseudo-letter for the standby pose: shown between signs (instead of lowering the arm) and tunable like a letter.
export const STANDBY = 'ootel';
const STANDBY_DIR = { R: 'ready', L: 'relaxed' }; // which orient each hand waits in

export const SIGNS = Object.fromEntries(
  Object.entries(signData.signs).map(([letter, sign]) => [letter, { spread: [0, 0, 0, 0], knuckle: [0, 0, 0, 0], ...sign }]),
);

// What a sign's `left` part (the other hand's share in two-handed letters such as Q and X) leaves out
const LEFT_DEFAULTS = { spread: [0, 0, 0, 0], knuckle: [0, 0, 0, 0], thumb: 'rest', dir: 'up' };

const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];

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
    },
  };
  return api;
}
