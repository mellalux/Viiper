import * as THREE from 'three';
import shared from '../data/shared.json';
import { fingerspelling, words } from '../data/store.js';
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
//              (A sign can change its orient for itself: `orient` = { reach, pole, finger, thumb, maxBend } next to `dir`.)
//   thumbPoses thumb joint rotations (Euler XYZ per joint: thumb.01, .02, .03), radians.
// fingerspelling.json holds the letters:
//   signs      per letter: curl = [index, middle, ring, pinky], 0 straight .. 1 fully curled; dir = an orient;
//              thumb = a thumb pose; spread = same finger order (radians, optional); knuckle = extra bend (radians)
//              of the finger at the base joint only, keeping the finger straight (optional).
// words.json holds the word signs in the same format (signs.<WORD>: curl, dir, thumb, motion, tweaks).
// Fine-tuning made in the fine-tuning window (rotation and position of any bone, see tweaks.js) is stored next to the sign, in
// fingerspelling.json or words.json: signs.<letter>.tweaks (and global, in fingerspelling.json only).
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

// Word signs (words.json, same format as the letters; keys are the upper-case words) sit next to the letters.
// WORD_FORMS: what can be typed -> the sign it shows (each word itself, plus the aliases such as "PALJU ÕNNE").
export const WORD_FORMS = { ...Object.fromEntries(Object.keys(words.signs).map((w) => [w, w])), ...words.aliases };
export const SIGNS = Object.fromEntries(
  Object.entries({ ...fingerspelling.signs, ...words.signs }).map(([letter, sign]) => [letter, { spread: [0, 0, 0, 0], knuckle: [0, 0, 0, 0], ...sign }]),
);

// What a sign's `left` part (the other hand's share in two-handed letters such as Q and X) leaves out
const LEFT_DEFAULTS = { spread: [0, 0, 0, 0], knuckle: [0, 0, 0, 0], thumb: 'rest', dir: 'up' };

const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];

// A sign can move the hand while it is shown (Z draws its letter in the air, TERE waves): `motion` = { path, duration } in
// fingerspelling.json / words.json. path = points [x, y, z, tilt, flex, roll, curl] (trailing zeros may be left out), all
// relative to the pose as tuned (the pose a sign ends in, when its first point is not [0, 0]: it then starts elsewhere, e.g. a
// fist at the temple that becomes a pointing hand at the mouth; curl may then be 1 at the start and 0 at the end):
//   x, y, z   wrist offset in units of the arm's full length (+x = the viewer's right, +y up, +z = towards the viewer / the character's front)
//   tilt      degrees the hand swings at the wrist about the palm's normal (+ = fingertips towards the thumb side, as a waving hand)
//   flex      degrees the wrist bends, fingertips towards the palm (+) or the back of the hand (-), as a nodding fist
//   roll      degrees the hand turns about the finger axis (+ = thumb towards the back of the hand: the palm of a
//             right hand held palm to the body turns up), as the palm turning over when offering something
//   curl      0..1 added to the curl of all four fingers, as the fingers folding in a goodbye wave
//   outer     added (-1..1) to the curl of the index and little finger only, as the two horns of a sign folding down or up
//             while the middle and ring finger stay (the curls are clamped to 0..1 after adding)
// The hand takes the path once, slowing at the corners, and then holds its last point. When to reach each point is by default
// worked out from the lengths of the segments (a long segment takes longer), so editing one point shifts the times of all the
// others; `motion.times` (optional, one fraction 0..1 per point, rising, first 0 and last 1) pins the points in time instead.
// `motion.stagger` (0 .. 0.33, optional) lets the fingers take the curl channel one after the other instead of together: each
// finger starts that fraction of the path after the one before (index first) and all end together, as fingers rippling.
export const MOTION_LEAD = 0.3; // seconds the hand takes to get back to the start of the path
// Two equal letters in a row: the hand makes a small push forward and back (BUMP_DEPTH in arm lengths, +z = the character's front).
const BUMP_SECONDS = 0.3;
const BUMP_DEPTH = 0.07;
const CHANNELS = 8;
// what a unit of each channel counts for when a segment's length sets its share of the time (angles in degrees, curl in 0..1)
const CHANNEL_WEIGHT = [1, 1, 1, 0.004, 0.004, 0.004, 0.2, 0.2];
const smooth = (s) => s * s * (3 - 2 * s);

/** The share (0..1) of the path's time each segment gets: as `times` (one fraction per point) says, else in proportion to its length. */
function segmentShares(path, times) {
  if (times?.length === path.length) return times.slice(1).map((t, i) => Math.max(t - times[i], 0));
  const at = (pt, c) => pt[c] ?? 0;
  const lens = path.slice(1).map((b, i) => Math.hypot(...Array.from({ length: CHANNELS }, (_, c) => (at(b, c) - at(path[i], c)) * CHANNEL_WEIGHT[c])));
  const total = lens.reduce((a, b) => a + b, 0) || 1;
  return lens.map((l) => l / total);
}

/** The fraction (0..1) of the path's time at which each point is reached (the first is 0, the last 1). */
export function pathTimes(path, times) {
  let acc = 0;
  return [0, ...segmentShares(path, times).map((s) => (acc += s))];
}

/** Point at fraction `r` (0..1) of the path, written into `out`; every segment gets a share of the time in proportion to its length. */
export function tracePoint(path, r, out, times) {
  const at = (pt, c) => pt[c] ?? 0;
  const shares = segmentShares(path, times);
  let acc = 0;
  for (let i = 0; i < shares.length; i++) {
    const share = shares[i];
    if (r <= acc + share || i === shares.length - 1) {
      const e = smooth(Math.min(Math.max((r - acc) / (share || 1), 0), 1));
      for (let c = 0; c < CHANNELS; c++) out[c] = at(path[i], c) + (at(path[i + 1], c) - at(path[i], c)) * e;
      return out;
    }
    acc += share;
  }
  return out.fill(0);
}

// The body guard (see avoidBody): the radius of the parts of an arm that must stay out of the trunk and head, in metres
const BODY_R = { elbow: 0.03, upperArm: 0.032, foreArm: 0.028, wrist: 0.025, palm: 0.03, finger: 0.012, tip: 0.01 };
const SWING_STEP = 0.17; // radians the elbow is turned about the shoulder-wrist line per try when it is inside the body
const MAX_PUSH = 0.2; // metres the body guard may move the hand away from the pose in all

/** @param body the collision shape (body.js), or null for none */
export function createHands(root, side = 'R', { body = null } = {}) {
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
  // `override`: a sign's own changes to the named orient (sign.orient: any of finger, thumb, reach, pole, maxBend)
  const orientOf = (name, override = null) => {
    const o = override ? { ...ORIENT[name], ...override } : ORIENT[name];
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
  const cur = { w: 0, tw: 0, maxBend: HAND_CONFIG.maxWristBend, pole: new THREE.Vector3(...mx(HAND_CONFIG.pole)), knuckle: [0, 0, 0, 0], reach: new THREE.Vector3(...mx(ORIENT.up.reach)), curl: [0, 0, 0, 0], spread: [0, 0, 0, 0], thumb: new Array(9).fill(0), qHand: wq(hand) };
  const tgt = { w: 0, tw: 0, maxBend: HAND_CONFIG.maxWristBend, pole: new THREE.Vector3(...mx(HAND_CONFIG.pole)), knuckle: [0, 0, 0, 0], reach: new THREE.Vector3(...mx(ORIENT.up.reach)), curl: [0, 0, 0, 0], spread: [0, 0, 0, 0], thumb: new Array(9).fill(0), qHand: cur.qHand.clone() };

  const shoulderPos = new THREE.Vector3();
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  const eul = new THREE.Euler();

  // --- motion along a sign's path (see MOTION_LEAD): `off` holds the path's channels at this moment (see above), applied after the tweaks ---
  const motion = { def: null, t: 0, from: new Array(CHANNELS).fill(0), off: new Array(CHANNELS).fill(0), fingerCurl: [0, 0, 0, 0], paused: false };
  let bumpT = null; // seconds into the repeat bump, null when not bumping
  let frozenAt = null; // debug (?at=): hold the hand at this fraction (0..1) of its path

  const fingerPoint = new Array(CHANNELS).fill(0);
  /** The curl a path point adds to finger `f` (index 0 .. little 3): the curl channel, and the outer channel for the index and little finger. */
  const curlAt = (pt, f) => pt[6] + (f === 0 || f === 3 ? pt[7] : 0);
  /** The path at fraction `r`, into motion.off; the curl of each finger into motion.fingerCurl (staggered when the path says so). */
  const tracePath = (def, r) => {
    tracePoint(def.path, r, motion.off, def.times);
    const gap = Math.min(Math.max(def.stagger ?? 0, 0), 1 / 3);
    for (let f = 0; f < 4; f++) {
      motion.fingerCurl[f] = curlAt(gap ? tracePoint(def.path, Math.min(Math.max((r - f * gap) / (1 - 3 * gap), 0), 1), fingerPoint, def.times) : motion.off, f);
    }
  };
  const stepMotion = (dt, k) => {
    if (bumpT !== null && !motion.paused) {
      bumpT += Math.min(dt, 0.05);
      if (bumpT >= BUMP_SECONDS) bumpT = null;
    }
    const def = motion.def;
    if (frozenAt !== null && def) return void tracePath(def, frozenAt);
    if (!def || motion.paused) {
      // no path (or the editor / a frozen pose holds the start): ease back to the tuned pose, at once when paused
      if (motion.paused) motion.t = 0;
      if (motion.paused) bumpT = null;
      for (let c = 0; c < CHANNELS; c++) motion.off[c] *= motion.paused ? 0 : 1 - k;
      for (let f = 0; f < 4; f++) motion.fingerCurl[f] = curlAt(motion.off, f);
      return;
    }
    motion.t += Math.min(dt, 0.05); // a stalled frame must not skip the drawing
    if (motion.t < MOTION_LEAD) {
      // the hand gets to the first point of the path (the pose itself, unless the path starts elsewhere: a sign that begins at the forehead)
      const first = tracePoint(def.path, 0, fingerPoint, def.times);
      for (let c = 0; c < CHANNELS; c++) motion.off[c] = first[c] + (motion.from[c] - first[c]) * (1 - smooth(motion.t / MOTION_LEAD));
      for (let f = 0; f < 4; f++) motion.fingerCurl[f] = curlAt(motion.off, f);
    } else tracePath(def, (motion.t - MOTION_LEAD) / def.duration);
  };

  /**
   * Two-bone IK from the pose as it is now to a new wrist position, the elbow keeping the side it is on (turned about the
   * shoulder-wrist line by `swing` radians). The hand keeps pointing the way it did; `adjustHand(worldQuaternion)` may turn it.
   */
  const reachWrist = (target, { swing = 0, adjustHand } = {}) => {
    upperArm.updateWorldMatrix(true, true);
    const shoulder = wp(upperArm);
    const elbow = wp(foreArm);
    const wrist = wp(hand);
    const handQ = wq(hand);
    const len1 = shoulder.distanceTo(elbow);
    const len2 = elbow.distanceTo(wrist);
    const d = target.clone().sub(shoulder);
    const dist = Math.min(Math.max(d.length(), 1e-3), len1 + len2 - 1e-4);
    const u = d.normalize();
    const pole = elbow.clone().sub(shoulder);
    const wasU = wrist.clone().sub(shoulder).normalize();
    pole.addScaledVector(wasU, -pole.dot(wasU));
    pole.addScaledVector(u, -pole.dot(u)).normalize();
    if (swing) pole.applyAxisAngle(u, swing);
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
    adjustHand?.(handQ);
    hand.quaternion.copy(newFa.invert().multiply(handQ));
  };

  const applyMotion = () => {
    const bump = bumpT === null ? 0 : Math.sin((Math.PI * bumpT) / BUMP_SECONDS) * BUMP_DEPTH;
    if (motion.off.every((o) => Math.abs(o) < 1e-5) && !bump) return;
    upperArm.updateWorldMatrix(true, true);
    const shoulder = wp(upperArm);
    const wrist = wp(hand);
    const scale = (shoulder.distanceTo(wp(foreArm)) + wp(foreArm).distanceTo(wrist)) * cur.tw;
    const target = wrist.clone().add(new THREE.Vector3(motion.off[0] * scale * sgn, motion.off[1] * scale, (motion.off[2] + bump) * scale));
    // (the left hand's x is mirrored too, so the same path is the mirror image on the left hand)
    // the motion's tilt / flex / roll turn the hand about its own axes (palm normal, thumb, fingers; the left hand's flex and
    // roll are mirrored so a number means the same for both hands)
    const [, , , tilt, flex, roll] = motion.off;
    reachWrist(target, {
      adjustHand(handQ) {
        if (!(tilt || flex || roll)) return;
        const axis = (i) => v.copy(AXES[i]).applyQuaternion(handQ);
        const turn = (i, deg) => deg && handQ.premultiply(q.setFromAxisAngle(axis(i), THREE.MathUtils.degToRad(deg * cur.tw)));
        turn(1, roll * sgn);
        turn(0, tilt);
        turn(2, flex * sgn);
      },
    });
  };

  // --- keeping the arm out of the body (body.js), after everything else has posed it ---
  const partPos = new THREE.Vector3();
  /** The longest displacement that takes the hand (wrist, palm, fingers) out of the body, or null when it is clear. */
  const handPush = () => {
    let best = null;
    const test = (pos, r) => {
      const disp = body.push(pos, r);
      if (disp && (!best || disp.lengthSq() > best.lengthSq())) best = disp.clone();
    };
    test(wp(hand), BODY_R.wrist);
    const mcp = digits[1]?.[0]?.bone;
    if (mcp) test(wp(hand).add(wp(mcp)).multiplyScalar(0.5), BODY_R.palm);
    for (const joints of [...digits, thumbs]) {
      const bones = (Array.isArray(joints) ? joints : [joints]).filter(Boolean).map((j) => j.bone ?? j);
      for (const b of bones) test(b.getWorldPosition(partPos), BODY_R.finger);
    }
    for (const joints of digits) {
      const bones = joints.filter(Boolean).map((j) => j.bone);
      if (bones.length > 1) {
        const [prev, last] = bones.slice(-2).map((b) => wp(b));
        test(last.clone().addScaledVector(last.clone().sub(prev), 0.9), BODY_R.tip);
      }
    }
    return best;
  };
  /** How deep the elbow, upper arm and forearm are in the body if the elbow were turned by `swing` about the shoulder-wrist line. */
  const elbowDepth = (shoulder, elbow, wrist, swing) => {
    const axis = wrist.clone().sub(shoulder).normalize();
    const e = elbow.clone().sub(shoulder).applyAxisAngle(axis, swing).add(shoulder);
    let depth = 0;
    for (const [pos, r] of [[e, BODY_R.elbow], [shoulder.clone().add(e).multiplyScalar(0.5), BODY_R.upperArm], [e.clone().add(wrist).multiplyScalar(0.5), BODY_R.foreArm]]) {
      depth += body.push(pos, r)?.length() ?? 0;
    }
    return depth;
  };
  const avoidBody = () => {
    if (!body || cur.tw < 0.05) return;
    const strength = Math.min(cur.tw, 1);
    // 1) the hand: move the wrist (and with it the palm and fingers, which keep their orientation) out of the body
    const moved = new THREE.Vector3();
    for (let i = 0; i < 3; i++) {
      upperArm.updateWorldMatrix(true, true);
      const push = handPush();
      if (!push) break;
      push.multiplyScalar(strength);
      if (moved.length() + push.length() > MAX_PUSH) push.setLength(Math.max(MAX_PUSH - moved.length(), 0));
      if (push.length() < 1e-4) break;
      moved.add(push);
      reachWrist(wp(hand).add(push));
    }
    // 2) the elbow, upper arm and forearm: turn the elbow about the shoulder-wrist line, as little as it takes to get clear
    upperArm.updateWorldMatrix(true, true);
    const shoulder = wp(upperArm);
    const elbow = wp(foreArm);
    const wrist = wp(hand);
    if (elbowDepth(shoulder, elbow, wrist, 0) < 1e-4) return;
    let best = { swing: 0, depth: Infinity };
    for (let k = 1; k <= 12 && best.depth > 1e-4; k++) {
      for (const swing of [k * SWING_STEP, -k * SWING_STEP]) {
        const depth = elbowDepth(shoulder, elbow, wrist, swing);
        if (depth < best.depth) best = { swing, depth };
      }
    }
    if (best.swing) reachWrist(wrist, { swing: best.swing * strength });
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
        const curl = Math.min(Math.max(cur.curl[i] + motion.fingerCurl[i], 0), 1);
        const angle = curl * HAND_CONFIG.curlJoints[n] + (n === 0 ? cur.knuckle[i] : 0);
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
      motion.from = [...motion.off];
      const sign = own || SIGNS[key];
      // A sign without finger data is undefined: the hand stays as the model has it (w = 0) and only the hand-tuned
      // offsets of that sign show, which is how a sign gets defined from scratch.
      const defined = Array.isArray(sign?.curl);
      tgt.w = defined ? 1 : 0;
      tgt.tw = sign ? 1 : 0;
      if (!sign) return;
      letter = key;
      if (!defined) return;
      // The standby sign may define its own orient (`dir`, `orient`); without, each hand waits in its named one. The left hand
      // waiting in a sign of its own has no say of its own in the standby sign's `dir` (that one is the right hand's).
      const o = key !== STANDBY ? orientOf(sign.dir, sign.orient) : side === 'L' && !own ? orientOf(STANDBY_DIR.L) : orientOf(sign.dir ?? STANDBY_DIR[side], sign.orient);
      tgt.curl = [...sign.curl];
      tgt.spread = sign.spread.map((s) => s * axisSign[rig.spreadAxis] * rig.spreadSign);
      tgt.thumb = thumbPoses[sign.thumb].flat().map((v, i) => v * axisSign[i % 3]);
      tgt.knuckle = [...sign.knuckle];
      tgt.qHand = handQuat(o);
      tgt.reach.set(...o.reach);
      tgt.maxBend = o.maxBend ?? HAND_CONFIG.maxWristBend;
      tgt.pole.set(...(o.pole ?? mx(HAND_CONFIG.pole)));
    },
    /** A small push forward and back, for a letter repeated right after itself. Does nothing in standby or with the arm lowered. */
    bump() {
      if (tgt.tw > 0 && letter !== STANDBY) bumpT = 0;
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
    /** Keep the arm and hand out of the body (the `body` given to createHands); call last, after applyMotion. */
    avoidBody,
    /** Move the wrist (and the hand with it, keeping its orientation) by `delta` (world space), the elbow following; for handGuard.js. */
    shiftWrist(delta) {
      reachWrist(wp(hand).add(delta));
    },
    /**
     * The pose the bones are in now, written as the data of a sign (the inverse of setSign + pose): the orient (wrist position,
     * elbow, which way the fingers and thumb point; in the stored right-hand coordinates), the wrist bend in degrees, and the
     * curl / spread / knuckle of each finger. Giving a sign this data reproduces the arm and the finger curls; what it can't
     * say (thumb, odd joint angles) is left to the bone tweaks.
     */
    readPose() {
      root.updateMatrixWorld(true);
      const r3 = (a) => a.map((x) => Math.round(x * 1000) / 1000);
      const r2 = (x) => Math.round(x * 100) / 100;
      const shoulder = wp(upperArm);
      const elbow = wp(foreArm);
      const wrist = wp(hand);
      const u = wrist.clone().sub(shoulder);
      const reach = u.clone().divideScalar(l1 + l2);
      u.normalize();
      const pole = elbow.clone().sub(shoulder);
      pole.addScaledVector(u, -pole.dot(u)).normalize();
      const handQ = wq(hand);
      const finger = new THREE.Vector3(0, 1, 0).applyQuaternion(handQ);
      const thumb = new THREE.Vector3(0, 0, 1).applyQuaternion(handQ);
      const bend = THREE.MathUtils.radToDeg(finger.angleTo(wrist.clone().sub(elbow).normalize()));
      // the angle a rotation turns about an axis (swing-twist), -pi .. pi
      const twist = (qq, axis) => {
        const a = 2 * Math.atan2(qq.x * axis.x + qq.y * axis.y + qq.z * axis.z, qq.w);
        return a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a;
      };
      const curl = [];
      const spread = [];
      const knuckle = [];
      digits.forEach((joints) => {
        const rel = joints.map((j) => j && j.rest.clone().invert().multiply(j.bone.quaternion));
        const angle = (n) => (rel[n] ? twist(rel[n], curlAxis) * axisSign[rig.curlAxis] : 0);
        const c = Math.min(Math.max(angle(1) / HAND_CONFIG.curlJoints[1], 0), 1);
        const a0 = angle(0);
        curl.push(r2(c));
        knuckle.push(rel[0] ? r2(Math.min(Math.max(a0 - c * HAND_CONFIG.curlJoints[0], -0.3), 1.5)) : 0);
        // the base joint turned first about the spread axis, then about the curl axis: take the curl off to see the spread
        const s = rel[0] ? rel[0].clone().multiply(new THREE.Quaternion().setFromAxisAngle(curlAxis, a0 * axisSign[rig.curlAxis]).invert()) : null;
        spread.push(s ? r2(Math.min(Math.max(twist(s, spreadAxis) * axisSign[rig.spreadAxis] * rig.spreadSign, -0.5), 0.5)) : 0);
      });
      return { orient: { reach: r3(mx(reach.toArray())), pole: r3(mx(pole.toArray())), finger: r3(mx(finger.toArray())), thumb: r3(mx(thumb.toArray())) }, bend, curl, spread, knuckle };
    },
    /** Debug: show the sign with its motion held at this fraction (0..1) of the path; null plays it normally. */
    freezeMotion(r) {
      frozenAt = r;
    },
    /** True while the path must not play (frozen debug pose, fine-tuning window open): the hand holds the tuned pose. */
    set motionPaused(v) {
      motion.paused = v;
    },
  };
  return api;
}
