import * as THREE from 'three';
import shared from '../data/shared.json';
import { detectRig } from '../character/rigs.js';

// Joint limits for the finger bones, applied last (after hands.js has posed the fingers and the tweaks have been layered on
// top), so that no sign, motion or hand-tuned offset can bend a finger the wrong way or twist it through its neighbours.
// A finger bone's rotation relative to its rest pose is split into curl (about the rig's curl axis, + = towards the palm),
// spread (+ = towards the little finger) and twist (the remaining axis); each is clamped to the range given in
// shared.json `limits.finger.<mcp|pip|dip>` (degrees). A range that is left out means "no limit" on that axis.
const D2R = THREE.MathUtils.DEG2RAD;
const LETTERS = ['X', 'Y', 'Z'];

export function createLimits(root) {
  const rig = detectRig(root);
  const table = shared.limits?.finger;
  if (!rig || !table) return null;

  const curlAxis = rig.curlAxis;
  const spreadAxis = rig.spreadAxis;
  const twistAxis = 3 - curlAxis - spreadAxis;
  // the fingers were posed as rest * spread * curl, so that is the order to take them apart in
  const order = LETTERS[spreadAxis] + LETTERS[twistAxis] + LETTERS[curlAxis];
  const JOINTS = ['mcp', 'pip', 'dip'];

  const joints = [];
  for (const side of ['R', 'L']) {
    // a left bone is mirrored: a rotation about Y or Z flips sign (see hands.js)
    const sign = side === 'L' ? [1, -1, -1] : [1, 1, 1];
    rig.fingers.forEach((_, f) =>
      JOINTS.forEach((joint, n) => {
        const bone = root.getObjectByName(rig.finger(side, f, n + 1));
        if (!bone || !table[joint]) return;
        joints.push({
          name: bone.name, bone, rest: bone.quaternion.clone(), range: table[joint],
          // multiply a normalised value (curl towards the palm, spread towards the little finger) by this to get the Euler angle
          signs: [sign[curlAxis], sign[spreadAxis] * rig.spreadSign, sign[twistAxis]],
        });
      }),
    );
  }

  const eul = new THREE.Euler();
  const q = new THREE.Quaternion();
  const restInv = new THREE.Quaternion();
  const clampTo = (v, range) => (range ? Math.min(Math.max(v, range[0] * D2R), range[1] * D2R) : v);

  /** Clamp one joint; returns the excess in degrees per axis ([curl, spread, twist], zero where within the range) or null. */
  function limit(j, apply) {
    restInv.copy(j.rest).invert();
    q.copy(restInv).multiply(j.bone.quaternion);
    eul.setFromQuaternion(q, order);
    const byLetter = { X: eul.x, Y: eul.y, Z: eul.z };
    const value = [byLetter[LETTERS[curlAxis]] * j.signs[0], byLetter[LETTERS[spreadAxis]] * j.signs[1], byLetter[LETTERS[twistAxis]] * j.signs[2]];
    const clamped = [clampTo(value[0], j.range.curl), clampTo(value[1], j.range.spread), clampTo(value[2], j.range.twist)];
    const excess = clamped.map((c, i) => (value[i] - c) / D2R);
    if (!excess.some((x) => Math.abs(x) > 1e-3)) return null;
    if (apply) {
      byLetter[LETTERS[curlAxis]] = clamped[0] * j.signs[0];
      byLetter[LETTERS[spreadAxis]] = clamped[1] * j.signs[1];
      byLetter[LETTERS[twistAxis]] = clamped[2] * j.signs[2];
      eul.set(byLetter.X, byLetter.Y, byLetter.Z, order);
      j.bone.quaternion.copy(j.rest).multiply(q.setFromEuler(eul));
    }
    return excess;
  }

  return {
    /** Clamp every finger joint; call after the tweaks. */
    apply() {
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
  };
}
