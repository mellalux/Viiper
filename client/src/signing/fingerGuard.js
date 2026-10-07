import * as THREE from 'three';

// Keeps the fingers and the thumb out of each other: where two of their capsules (handHits.js inner()) are inside each other by
// more than TOLERANCE, the joints that carry them are turned so that the capsules move apart, a few rounds, and the joint limits
// (limits.js) are applied again after each. A thumb gives way to a finger, two fingers share the way. Skin is soft: an overlap
// of a few millimetres is left alone, as is a finger pressing the palm. Call it after the fingers have their final pose
// (hands.js, the tweaks and the limits) and, like the other guards, only while a sign is shown.
const TOLERANCE = 0.002; // metres of overlap that is left (flesh gives a little)
const ROUNDS = 8;
const GAIN = 1; // the share of an overlap that is turned away per round
const MAX_STEP = 0.35; // radians one joint may turn about one axis per round

const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];

/**
 * @param hits handHits.js  @param hands { R, L } the two createHands()  @param rig rigs.js profile (which axes a finger bends about)
 * @param clamps functions that put the joints back inside their limits after a turn (limits.js, the bone limits)
 */
export function createFingerGuard({ hits, hands, rig, clamps = [] }) {
  const q = new THREE.Quaternion();
  const jointPos = new THREE.Vector3();
  const lever = new THREE.Vector3();
  const axisWorld = new THREE.Vector3();
  const want = new THREE.Vector3();

  /** Which local axes of the joint `k` (0 = the base joint) of a finger or thumb may turn it. */
  const axesOf = (capsule, k) => (capsule.part === 'thumb' ? [0, 1, 2] : k === 0 ? [rig.curlAxis, rig.spreadAxis] : [rig.curlAxis]);

  /** Turn the joints that carry `capsule` so that its point `at` moves by `move` (world space). */
  function carry(capsule, at, move) {
    const length = move.length();
    if (length < 1e-6) return;
    want.copy(move).divideScalar(length);
    const dofs = [];
    capsule.joints.forEach((joint, k) => {
      joint.getWorldPosition(jointPos);
      lever.copy(at).sub(jointPos);
      joint.getWorldQuaternion(q);
      for (const i of axesOf(capsule, k)) {
        axisWorld.copy(AXES[i]).applyQuaternion(q);
        const gain = axisWorld.clone().cross(lever).dot(want); // how far the point moves along `want` per radian
        if (Math.abs(gain) > 1e-5) dofs.push({ joint, i, gain });
      }
    });
    const total = dofs.reduce((sum, d) => sum + d.gain * d.gain, 0);
    if (!total) return;
    for (const { joint, i, gain } of dofs) {
      const angle = Math.max(-MAX_STEP, Math.min(MAX_STEP, (length * gain) / total));
      joint.quaternion.multiply(q.setFromAxisAngle(AXES[i], angle));
    }
    capsule.joints[0].updateWorldMatrix(false, true);
  }

  /** Separate the fingers of one hand ('R' | 'L'); `strength` 0..1 fades it out with the arm. Returns whether a joint was turned. */
  function apply(side, strength = 1) {
    if (!hands[side] || strength < 0.05) return false;
    let turned = false;
    for (let round = 0; round < ROUNDS; round++) {
      const found = hits.inner(side, TOLERANCE);
      if (!found.length) break;
      for (const { x, y, depth, normal, pointX, pointY } of found) {
        const away = (depth - TOLERANCE) * GAIN * strength;
        // a thumb gives way to a finger; two fingers (or two parts of the thumb) give half each
        const share = x.part === y.part ? [0.5, 0.5] : x.part === 'thumb' ? [1, 0] : [0, 1];
        if (share[0]) carry(x, pointX, normal.clone().multiplyScalar(-away * share[0]));
        if (share[1]) carry(y, pointY, normal.clone().multiplyScalar(away * share[1]));
      }
      for (const clamp of clamps) clamp();
      turned = true;
    }
    return turned;
  }

  return { apply };
}
