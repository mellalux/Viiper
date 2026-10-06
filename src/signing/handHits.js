import * as THREE from 'three';
import { detectRig } from '../character/rigs.js';

// Capsule colliders of the hands and forearms, to measure (and later resolve) fingers and hands going through each other.
// Every bone of a hand becomes a capsule from its joint to the next one (the last phalanx to a tip worked out from the one
// before); the palm is the wrist-to-knuckle fan and the knuckle line, the forearm one capsule. The radii are not typed in: they
// are measured on the skin once, in the pose the model has then: the median distance of the skin vertices that bone moves most to its axis.
//
//   hits = handHits.measure()  ->  [{ kind, a, b, depth }] with depth in metres of how far two capsules (their radii scaled by
//   SKIN, flesh gives a little) are inside each other. kind: finger-finger | finger-palm | thumb-finger | thumb-palm |
//   hand-hand (the two hands and forearms) | hand-arm (a hand in the other forearm).
export const SKIN = 0.85; // share of the skin radius that counts as solid
const MIN_RADIUS = 0.004;
const DEFAULT_RADIUS = { finger: 0.008, thumb: 0.01, palm: 0.02, forearm: 0.03 };

const median = (list) => {
  const s = [...list].sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : null;
};

// --- distance between two segments (Ericson, Real-Time Collision Detection 5.1.9) ---
const d1 = new THREE.Vector3();
const d2 = new THREE.Vector3();
const rr = new THREE.Vector3();
const cA = new THREE.Vector3();
const cB = new THREE.Vector3();
/** The shortest distance between segments p1-q1 and p2-q2; the two closest points go into cA and cB (module-level scratch). */
function segmentDistance(p1, q1, p2, q2) {
  d1.subVectors(q1, p1);
  d2.subVectors(q2, p2);
  rr.subVectors(p1, p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(rr);
  let s;
  let t;
  if (a <= 1e-12 && e <= 1e-12) {
    s = t = 0;
  } else if (a <= 1e-12) {
    s = 0;
    t = Math.min(Math.max(f / e, 0), 1);
  } else {
    const c = d1.dot(rr);
    if (e <= 1e-12) {
      t = 0;
      s = Math.min(Math.max(-c / a, 0), 1);
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom > 1e-12 ? Math.min(Math.max((b * f - c * e) / denom, 0), 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(Math.max(-c / a, 0), 1);
      } else if (t > 1) {
        t = 1;
        s = Math.min(Math.max((b - c) / a, 0), 1);
      }
    }
  }
  cA.copy(p1).addScaledVector(d1, s);
  cB.copy(p2).addScaledVector(d2, t);
  return cA.distanceTo(cB);
}

/** Collision capsules of both hands of the model (null when the rig isn't recognised). */
export function createHandHits(root) {
  root.updateMatrixWorld(true);
  const rig = detectRig(root);
  if (!rig) return null;
  const get = (name) => root.getObjectByName(name);
  const wp = (o, out) => o.getWorldPosition(out);

  /** capsules: { side, part: 'finger' | 'thumb' | 'palm' | 'forearm', finger (0..3 / 4 = thumb), seg (1..3), from, to (world points, refreshed), radius } */
  const capsules = [];
  const tipOf = (prev, last, out) => out.copy(wp(last, new THREE.Vector3())).addScaledVector(wp(last, new THREE.Vector3()).sub(wp(prev, new THREE.Vector3())), 0.9);

  for (const side of ['R', 'L']) {
    const names = rig.arm(side);
    const foreArm = get(names.foreArm);
    const hand = get(names.hand);
    if (!foreArm || !hand) continue;
    const add = (c) => capsules.push({ side, from: new THREE.Vector3(), to: new THREE.Vector3(), mid: new THREE.Vector3(), reach: 0, radius: DEFAULT_RADIUS[c.part], samples: [], ...c });

    add({ part: 'forearm', finger: -1, seg: 1, a: foreArm, b: hand });

    const knuckles = rig.fingers.map((_, f) => get(rig.finger(side, f, 1)));
    // palm: wrist to each knuckle, and the knuckles along the hand
    knuckles.forEach((k, f) => k && add({ part: 'palm', finger: f, seg: 0, a: hand, b: k }));
    for (let f = 0; f < 3; f++) if (knuckles[f] && knuckles[f + 1]) add({ part: 'palm', finger: f, seg: 4, a: knuckles[f], b: knuckles[f + 1] });

    const chain = (f, bones, part) => {
      bones.forEach((bone, n) => {
        if (!bone) return;
        const next = bones[n + 1];
        if (next) add({ part, finger: f, seg: n + 1, a: bone, b: next });
        else if (n > 0) add({ part, finger: f, seg: n + 1, a: bone, tipFrom: bones[n - 1] });
      });
    };
    rig.fingers.forEach((_, f) => chain(f, [1, 2, 3].map((n) => get(rig.finger(side, f, n))), 'finger'));
    chain(4, [1, 2, 3].map((n) => get(rig.thumb(side, n))), 'thumb');
  }

  // only the arms move while a sign is shown, so only they are brought up to date (the shoulders and what is above come along)
  const armRoots = ['R', 'L'].map((side) => get(rig.arm(side).upperArm)).filter(Boolean);
  const refresh = () => {
    for (const arm of armRoots) arm.updateWorldMatrix(true, true);
    for (const c of capsules) {
      wp(c.a, c.from);
      if (c.b) wp(c.b, c.to);
      else tipOf(c.tipFrom, c.a, c.to);
      c.mid.copy(c.from).add(c.to).multiplyScalar(0.5);
      c.reach = c.from.distanceTo(c.to) / 2 + c.radius * SKIN; // a sphere round the whole capsule, for skipping far-apart pairs early
    }
  };
  const apart = (x, y) => x.mid.distanceTo(y.mid) > x.reach + y.reach;

  // --- radii from the skin: for every vertex, the bone that moves it most; its distance to that bone's capsule axis ---
  const owners = new Map(); // bone -> capsules whose axis starts at that bone
  const palmOf = new Map(); // hand bone -> palm capsules
  for (const c of capsules) {
    if (c.part === 'palm') (palmOf.get(c.a) ?? palmOf.set(c.a, []).get(c.a)).push(c);
    if (c.part === 'forearm' || c.part === 'finger' || c.part === 'thumb') (owners.get(c.a) ?? owners.set(c.a, []).get(c.a)).push(c);
  }
  refresh();
  const v = new THREE.Vector3();
  const palmSamples = { R: [], L: [] };
  root.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    const pos = mesh.geometry.attributes.position;
    const si = mesh.geometry.attributes.skinIndex;
    const sw = mesh.geometry.attributes.skinWeight;
    if (!pos || !si || !sw) return;
    mesh.updateWorldMatrix(true, false);
    for (let i = 0; i < pos.count; i++) {
      let best = 0;
      for (let k = 1; k < 4; k++) if (sw.getComponent(i, k) > sw.getComponent(i, best)) best = k;
      const bone = mesh.skeleton.bones[si.getComponent(i, best)];
      const mine = owners.get(bone);
      const palm = palmOf.get(bone);
      if (!mine && !palm) continue;
      mesh.getVertexPosition(i, v); // skinned already (the positions are quantized, the bind matrices undo that)
      v.applyMatrix4(mesh.matrixWorld);
      for (const c of mine ?? []) {
        d1.subVectors(c.to, c.from);
        const t = d1.lengthSq() ? v.clone().sub(c.from).dot(d1) / d1.lengthSq() : 0;
        if (t < -0.15 || t > 1.15) continue;
        c.samples.push(segmentDistance(v, v, c.from, c.to));
      }
      if (palm) {
        let dist = Infinity;
        for (const c of palm) dist = Math.min(dist, segmentDistance(v, v, c.from, c.to));
        palmSamples[palm[0].side].push(dist);
      }
    }
  });
  for (const c of capsules) {
    const m = c.part === 'palm' ? median(palmSamples[c.side]) : median(c.samples);
    if (m) c.radius = Math.max(m, MIN_RADIUS);
    delete c.samples;
  }
  // The thumb's base is mostly the thenar pad over the palm: soft, and measured wide because of it. Solid is only as thick as the next joint.
  for (const side of ['R', 'L']) {
    const base = capsules.find((c) => c.side === side && c.part === 'thumb' && c.seg === 1);
    const next = capsules.find((c) => c.side === side && c.part === 'thumb' && c.seg === 2);
    if (base && next) base.radius = Math.min(base.radius, next.radius * 1.2);
  }

  // which capsule pairs count: not a finger with itself, not a joint with the part it grows from
  const skip = (x, y) => {
    if (x.side !== y.side) return false;
    if (x.part === 'forearm' || y.part === 'forearm') return true;
    if (x === y) return true;
    if (x.finger === y.finger && x.part === y.part) return true; // the same finger
    const [p, q] = [x, y].sort((m, n) => (m.part === 'palm' ? 1 : 0) - (n.part === 'palm' ? 1 : 0)); // q is the palm, if there is one
    if (q.part === 'palm') {
      if (p.part === 'palm') return true;
      if (p.part === 'thumb') return p.seg === 1; // the thumb's base is part of the palm
      return p.seg === 1; // a finger's first phalanx grows out of the palm's knuckle line
    }
    return false;
  };
  const kindOf = (x, y) => {
    if (x.side !== y.side) return x.part === 'forearm' || y.part === 'forearm' ? 'hand-arm' : 'hand-hand';
    const parts = [x.part, y.part].sort().join('+');
    return { 'finger+finger': 'finger-finger', 'finger+palm': 'finger-palm', 'finger+thumb': 'thumb-finger', 'palm+thumb': 'thumb-palm' }[parts] ?? parts;
  };
  const label = (c) => `${c.side}.${c.part === 'palm' ? `palm${c.finger}${c.seg === 4 ? 'k' : ''}` : c.part === 'forearm' ? 'forearm' : `${c.part === 'thumb' ? 'thumb' : ['index', 'middle', 'ring', 'pinky'][c.finger]}${c.seg}`}`;

  /** Every pair of capsules inside each other by more than `minDepth` metres, deepest first (call after the pose is final). */
  function measure(minDepth = 0.0005) {
    refresh();
    const hits = [];
    for (let i = 0; i < capsules.length; i++) {
      for (let j = i + 1; j < capsules.length; j++) {
        const x = capsules[i];
        const y = capsules[j];
        if (skip(x, y) || apart(x, y)) continue;
        const depth = (x.radius + y.radius) * SKIN - segmentDistance(x.from, x.to, y.from, y.to);
        if (depth > minDepth) hits.push({ kind: kindOf(x, y), a: label(x), b: label(y), depth });
      }
    }
    return hits.sort((m, n) => n.depth - m.depth);
  }

  /**
   * The overlaps between the two hands (and forearms) deeper than `minDepth` metres, for pushing them apart:
   * { x, y, depth, normal } with x on the right side, y on the left, normal the unit vector from x to y (world space).
   */
  function contacts(minDepth = 0.001) {
    refresh();
    const found = [];
    for (const x of capsules) {
      if (x.side !== 'R') continue;
      for (const y of capsules) {
        if (y.side !== 'L' || apart(x, y)) continue;
        const dist = segmentDistance(x.from, x.to, y.from, y.to);
        const depth = (x.radius + y.radius) * SKIN - dist;
        if (depth <= minDepth) continue;
        const normal = cB.clone().sub(cA);
        if (dist < 1e-5) normal.copy(y.from).add(y.to).sub(x.from).sub(x.to); // the axes cross: apart as the capsules lie
        if (normal.lengthSq() < 1e-10) normal.set(1, 0, 0);
        found.push({ x, y, depth, normal: normal.normalize() });
      }
    }
    return found;
  }

  /** Debug: wire capsules, red where one is in another (add to the scene; ?colliders=1); call update() every frame. */
  function outline() {
    const group = new THREE.Group();
    const calm = new THREE.MeshBasicMaterial({ color: 0xff9900, wireframe: true, transparent: true, opacity: 0.5, depthTest: false });
    const hot = new THREE.MeshBasicMaterial({ color: 0xff2222, wireframe: true, transparent: true, opacity: 0.9, depthTest: false });
    const meshes = capsules.map((c) => {
      const length = Math.max(c.from.distanceTo(c.to), 1e-3);
      const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(c.radius * SKIN, length, 3, 8), calm);
      mesh.renderOrder = 999;
      group.add(mesh);
      return mesh;
    });
    const up = new THREE.Vector3(0, 1, 0);
    group.userData.update = () => {
      const hitNow = new Set(measure().flatMap((h) => [h.a, h.b]));
      capsules.forEach((c, i) => {
        const mesh = meshes[i];
        const length = Math.max(c.from.distanceTo(c.to), 1e-3);
        mesh.position.copy(c.from).add(c.to).multiplyScalar(0.5);
        mesh.quaternion.setFromUnitVectors(up, d1.subVectors(c.to, c.from).normalize());
        mesh.scale.set(1, length / mesh.geometry.parameters.height, 1);
        mesh.material = hitNow.has(label(c)) ? hot : calm;
      });
    };
    group.userData.update();
    root.parent?.add(group);
    return group;
  }

  return { capsules, measure, contacts, outline, refresh };
}
