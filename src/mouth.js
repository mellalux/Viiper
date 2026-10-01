import * as THREE from 'three';

// Mouth shapes (visemes) driven by Rigify face bones. Offsets are given in model world axes
// (+X = character's left, +Y up, +Z forward) and converted to each bone's local frame, so the
// tuning doesn't depend on the bones' odd roll orientations. All values are relative to the
// model's rest pose (a slight smile). Lengths are in model units, jaw in radians.
// (GLTFLoader strips dots from node names: lipTL001, lipBR, jaw, teethB, ...)
export const MOUTH_PARAMS = ['jaw', 'cornerIn', 'cornerUp', 'cornerForward', 'lowerDown', 'upperUp', 'lipForward'];

export const VISEMES = {
  rest: {},
  // vowels
  A: { jaw: 0.3, cornerIn: -0.004, lowerDown: 0.016, upperUp: 0.006 },
  E: { jaw: 0.12, cornerIn: -0.008, cornerUp: 0.004, lowerDown: 0.006, upperUp: 0.003 },
  I: { jaw: 0.05, cornerIn: -0.012, cornerUp: 0.006, lowerDown: 0.003 },
  O: { jaw: 0.22, cornerIn: 0.012, cornerForward: 0.016, lowerDown: 0.014, upperUp: 0.006, lipForward: 0.008 },
  U: { jaw: 0.1, cornerIn: 0.016, cornerForward: 0.02, lowerDown: 0.006, upperUp: 0.003, lipForward: 0.012 },
  // Estonian vowels
  Õ: { jaw: 0.12, cornerIn: -0.002, lowerDown: 0.006, upperUp: 0.002 },
  Ä: { jaw: 0.25, cornerIn: -0.008, lowerDown: 0.012, upperUp: 0.005 },
  Ö: { jaw: 0.12, cornerIn: 0.01, cornerForward: 0.014, lowerDown: 0.007, upperUp: 0.003, lipForward: 0.008 },
  Ü: { jaw: 0.06, cornerIn: 0.014, cornerForward: 0.018, lowerDown: 0.003, lipForward: 0.012 },
  // consonant groups
  closed: { lowerDown: -0.012, upperUp: -0.006 }, // M B P: lips pressed together
  teethLip: { jaw: 0.03, lowerDown: -0.008 }, // F V: lower lip against the upper teeth
  tongue: { jaw: 0.1, cornerIn: -0.004, lowerDown: 0.007, upperUp: 0.003 }, // L N T D R
  hiss: { jaw: 0.02, cornerIn: -0.008, cornerUp: 0.003, lowerDown: 0.002 }, // S Z C Š Ž
  throat: { jaw: 0.1, lowerDown: 0.006, upperUp: 0.002 }, // K G H J
};

// letter -> viseme
export const LETTERS = {
  A: 'A', E: 'E', I: 'I', O: 'O', U: 'U', Õ: 'Õ', Ä: 'Ä', Ö: 'Ö', Ü: 'Ü', Y: 'Ü',
  M: 'closed', B: 'closed', P: 'closed',
  F: 'teethLip', V: 'teethLip',
  L: 'tongue', N: 'tongue', T: 'tongue', D: 'tongue', R: 'tongue',
  S: 'hiss', Z: 'hiss', C: 'hiss', Š: 'hiss', Ž: 'hiss', X: 'hiss',
  K: 'throat', G: 'throat', H: 'throat', J: 'throat',
  W: 'U', Q: 'U',
};

export function createMouth(root, { smoothing = 22 } = {}) {
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
