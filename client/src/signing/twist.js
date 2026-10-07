import * as THREE from 'three';
import { detectRig } from '../character/rigs.js';

// Wrist twist. hands.js turns the hand to the wanted orientation at the wrist joint, but a real forearm turns along its
// whole length (the palm facing the body to the palm facing up is half a turn of the forearm). Without help the skin
// of the wrist is wrung into a thin neck ("candy wrapper"). Rigs with twist bones in the forearm (rigs.js `twist`) get
// a share of the hand's twist on each of them, growing towards the wrist, so the skin turns gradually.
//
// The twist is the hand's rotation about its own long axis (local Y) relative to its rest pose; each twist bone turns about its
// own Y by its fraction of that (shared.json rigs.<rig>.twist.bones, e.g. { "ForearmTwist02": 0.5 }).
export function createTwist(root) {
  const rig = detectRig(root);
  if (!rig?.twist) return null;

  const sides = ['R', 'L'].map((side) => {
    const hand = root.getObjectByName(rig.arm(side).hand);
    const bones = Object.entries(rig.twist.bones)
      .map(([name, fraction]) => {
        const bone = root.getObjectByName(rig.twist.name(side, name));
        return bone && { bone, fraction, rest: bone.quaternion.clone() };
      })
      .filter(Boolean);
    return hand && bones.length ? { hand, handRest: hand.quaternion.clone(), bones } : null;
  }).filter(Boolean);
  if (!sides.length) return null;

  const rel = new THREE.Quaternion();
  const turn = new THREE.Quaternion();
  const Y = new THREE.Vector3(0, 1, 0);

  /** The hand's twist about its own long axis since the rest pose, radians (-PI..PI). */
  function twistOf(s) {
    rel.copy(s.handRest).invert().multiply(s.hand.quaternion);
    if (rel.w < 0) rel.set(-rel.x, -rel.y, -rel.z, -rel.w);
    return 2 * Math.atan2(rel.y, rel.w);
  }

  return {
    /** Share the hand's twist out over the forearm's twist bones; call after the arm has its final pose. */
    apply() {
      for (const s of sides) {
        const angle = twistOf(s);
        for (const t of s.bones) t.bone.quaternion.copy(t.rest).multiply(turn.setFromAxisAngle(Y, angle * t.fraction));
      }
    },
    /** Debug: the hands' current twist in degrees, [R, L]. */
    angles: () => sides.map((s) => +(twistOf(s) * THREE.MathUtils.RAD2DEG).toFixed(0)),
  };
}
