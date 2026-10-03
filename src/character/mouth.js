import * as THREE from 'three';
import signData from '../data/signs.json';
import { detectRig } from './rigs.js';

// Mouth shapes (visemes) driven by Rigify face bones. Offsets are given in model world axes
// (+X = character's left, +Y up, +Z forward) and converted to each bone's local frame, so the
// tuning doesn't depend on the bones' odd roll orientations. All values are relative to the
// model's rest pose (a slight smile). Lengths are in model units, jaw in radians.
// (GLTFLoader strips dots from node names: lipTL001, lipBR, jaw, teethB, ...)
export const MOUTH_PARAMS = ['jaw', 'cornerIn', 'cornerUp', 'cornerForward', 'lowerDown', 'upperUp', 'lipForward'];

// The mouth shapes and the letter -> shape table live in signs.json (the base source for the finger-spelling data):
//   visemes  per shape, any of MOUTH_PARAMS (missing = 0); `note` is ignored. Offsets are model-space lengths, jaw in radians.
//   letters  letter -> viseme. The order here is the order of the buttons in the letter panel.
export const VISEMES = signData.visemes;
export const LETTERS = signData.letters;

// Rigs whose face is made of shape keys (Character Creator) have no lip bones: their mouth shapes are weights of shape
// keys instead, in signs.json `rigs.cc.visemes` ({ "morphs": { shapeKey: weight }, "jaw": degrees of jaw-bone opening }).
function createMorphMouth(root, morphs, smoothing) {
  const visemes = signData.rigs.cc.visemes;
  const jawBone = root.getObjectByName('CC_Base_JawRoot'); // carries the teeth and tongue; opens about its local Z
  const jawRest = jawBone?.quaternion.clone();
  const names = [...new Set(Object.values(visemes).flatMap((v) => Object.keys(v.morphs ?? {})))];
  const cur = Object.fromEntries(names.map((n) => [n, 0]));
  const target = { ...cur };
  let jaw = 0;
  let jawTarget = 0;
  const q = new THREE.Quaternion();
  const axis = new THREE.Vector3(0, 0, 1);

  const pose = () => {
    for (const n of names) morphs.set('mouth', n, cur[n]);
    if (jawBone) jawBone.quaternion.copy(jawRest).multiply(q.setFromAxisAngle(axis, THREE.MathUtils.degToRad(jaw)));
  };

  return {
    setViseme(name) {
      const shape = visemes[name] ?? {};
      for (const n of names) target[n] = shape.morphs?.[n] ?? 0;
      jawTarget = shape.jaw ?? 0;
    },
    snapViseme(name) {
      this.setViseme(name);
      Object.assign(cur, target);
      jaw = jawTarget;
      pose();
    },
    update(dt) {
      const k = 1 - Math.exp(-smoothing * dt);
      for (const n of names) cur[n] += (target[n] - cur[n]) * k;
      jaw += (jawTarget - jaw) * k;
      pose();
    },
  };
}

/** @param morphs the model's shape-key layer (morphs.js); needed for rigs whose face is shape keys */
export function createMouth(root, { smoothing = 22, morphs = null } = {}) {
  if (morphs && detectRig(root)?.id === 'cc' && morphs.has('V_Open')) return createMorphMouth(root, morphs, smoothing);
  root.updateMatrixWorld(true);
  const get = (name) => root.getObjectByName(name);
  const cur = Object.fromEntries(MOUTH_PARAMS.map((p) => [p, 0]));
  const target = { ...cur };

  // Position offsets: bone + function of the current parameter values -> world delta
  const moves = [];
  const add = (name, delta) => {
    const bone = get(name);
    if (!bone) return;
    // world-space delta -> parent-local, using the parent's rest orientation
    const parentInv = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    moves.push({ bone, rest: bone.position.clone(), parentInv, delta });
  };

  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    // lip bones are chains running from the midline to the corner; .001 is the outer half
    for (const part of ['T', 'B']) {
      const vert = () => (part === 'T' ? cur.upperUp : -cur.lowerDown);
      add(`lip${part}${side}`, () => new THREE.Vector3(0, vert(), cur.lipForward));
      add(`lip${part}${side}001`, () => new THREE.Vector3(-sx * cur.cornerIn, vert() * 0.5 + cur.cornerUp, cur.cornerForward));
    }
  }

  const jaws = ['jaw', 'teethB', 'tongue'].map(get).filter(Boolean).map((bone) => ({ bone, rest: bone.quaternion.clone() }));
  const q = new THREE.Quaternion();
  const axis = new THREE.Vector3(1, 0, 0);
  const v = new THREE.Vector3();

  const pose = () => {
    for (const { bone, rest, parentInv, delta } of moves) {
      v.copy(delta()).applyQuaternion(parentInv);
      bone.position.copy(rest).add(v);
    }
    q.setFromAxisAngle(axis, cur.jaw);
    for (const { bone, rest } of jaws) bone.quaternion.copy(rest).multiply(q);
  };

  return {
    /** Aim the mouth at a viseme by name (see VISEMES); anything unknown means rest. */
    setViseme(name) {
      const shape = VISEMES[name] ?? {};
      for (const p of MOUTH_PARAMS) target[p] = shape[p] ?? 0;
    },
    /** Jump straight to a viseme without easing (debugging / screenshots). */
    snapViseme(name) {
      this.setViseme(name);
      Object.assign(cur, target);
      pose();
    },
    update(dt) {
      const k = 1 - Math.exp(-smoothing * dt);
      for (const p of MOUTH_PARAMS) cur[p] += (target[p] - cur[p]) * k;
      pose();
    },
  };
}
