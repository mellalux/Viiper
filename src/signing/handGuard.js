import * as THREE from 'three';
import { SKIN } from './handHits.js';

// Keeps the two hands (and forearms) out of each other: where the capsules of handHits.js overlap, each hand's wrist is moved
// half the depth away from the other one, a few rounds, until they only touch. The hands keep their orientation and the
// fingers their pose, as with the body guard (hands.js avoidBody). Call it after both hands are posed and have their motion.
const ROUNDS = 6;
const MAX_SEPARATION = 0.12; // metres one wrist may be moved in all
const FOREARM_GAIN = 1.6; // the forearm moves less than the wrist does, so the wrist is moved further to clear it

/** @param hits handHits.js  @param hands { R, L } the two createHands()  @param body body.js (optional): a hand the other one would be pushed into the body by stays, the other gives way */
export function createHandGuard({ hits, hands, body = null }) {
  const push = { R: new THREE.Vector3(), L: new THREE.Vector3() };
  const moved = { R: new THREE.Vector3(), L: new THREE.Vector3() };
  const piece = new THREE.Vector3();
  const probe = new THREE.Vector3();
  /** Whether the capsule, moved by `delta`, would still be clear of the body (its middle point is tested). */
  const clearOfBody = (capsule, delta) => !body || !body.push(probe.copy(capsule.from).add(capsule.to).multiplyScalar(0.5).add(delta), capsule.radius * SKIN);

  /** Separate the hands; `strength` 0..1 fades it out with the arms (they are lowering or rising). Returns whether a hand was moved. */
  function apply(strength = 1) {
    if (!hands.R || !hands.L || strength < 0.05) return false;
    moved.R.set(0, 0, 0);
    moved.L.set(0, 0, 0);
    for (let round = 0; round < ROUNDS; round++) {
      const found = hits.contacts();
      if (!found.length) return round > 0;
      push.R.set(0, 0, 0);
      push.L.set(0, 0, 0);
      // the deepest overlap of each hand decides how far it moves
      for (const { x, y, depth, normal } of found) {
        // half each, unless one of them would then be in the body: the other one makes the whole way
        const half = normal.clone().multiplyScalar(depth / 2);
        const xFree = clearOfBody(x, half.clone().negate());
        const yFree = clearOfBody(y, half);
        const share = { R: xFree === yFree ? 0.5 : xFree ? 1 : 0, L: xFree === yFree ? 0.5 : yFree ? 1 : 0 };
        for (const [capsule, sign] of [[x, -1], [y, 1]]) {
          const side = capsule.side;
          const gain = capsule.part === 'forearm' ? FOREARM_GAIN : 1;
          piece.copy(normal).multiplyScalar(sign * depth * gain * share[side]);
          if (piece.lengthSq() > push[side].lengthSq()) push[side].copy(piece);
        }
      }
      let any = false;
      for (const side of ['R', 'L']) {
        const p = push[side].multiplyScalar(strength);
        if (moved[side].length() + p.length() > MAX_SEPARATION) p.setLength(Math.max(MAX_SEPARATION - moved[side].length(), 0));
        if (p.length() < 1e-4) continue;
        moved[side].add(p);
        hands[side].shiftWrist(p);
        any = true;
      }
      if (!any) return round > 0;
    }
    return true;
  }

  /** Whether the hands are inside each other now. */
  const touching = () => hits.contacts().length > 0;

  return { apply, touching };
}
