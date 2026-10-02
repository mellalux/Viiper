import signData from './signs.json';

// Skeleton profiles: where each rig keeps the bones the app drives, and how its finger bones are oriented.
// A profile is picked from the loaded model (detectRig); everything else (hands.js, tweaks.js, ...) asks the profile
// instead of hard-coding bone names. (GLTFLoader strips dots from node names: upper_armR, CC_Base_R_Upperarm, ...)
//
// Both rigs share the hand bone's frame (local +Y along the fingers, +Z towards the thumb, -X the palm normal for the
// right hand; the left hand is mirrored with local X negated), so the arm IK works the same on both. The finger
// bones differ: they curl about `curlAxis` and spread about `spreadAxis` (indices into x, y, z); `spreadSign` makes a
// positive spread point towards the little finger.

const ARM_PART = {
  rigify: /^(upper_arm|forearm|hand|palm\d\d|f_[a-z]+\d\d|thumb\d\d)([LR])$/,
  cc: /^CC_Base_([LR])_(Upperarm|Forearm|Hand|Index\d|Mid\d|Ring\d|Pinky\d|Thumb\d)$/,
};

export const RIGS = {
  rigify: {
    id: 'rigify',
    detect: (root) => !!root.getObjectByName('upper_armR'),
    // the bones hands.js poses, per side ('R' | 'L')
    arm: (s) => ({ upperArm: `upper_arm${s}`, foreArm: `forearm${s}`, hand: `hand${s}` }),
    fingers: ['index', 'middle', 'ring', 'pinky'],
    finger: (s, f, n) => `f_${['index', 'middle', 'ring', 'pinky'][f]}0${n}${s}`,
    thumb: (s, n) => `thumb0${n}${s}`,
    eyes: ['eyeL', 'eyeR'], // the signer's point of view sits between these
    curlAxis: 0,
    spreadAxis: 2,
    spreadSign: 1,
    thumbPoses: signData.thumbPoses,
    // tweaks.js: which side an arm/hand/finger bone belongs to (null = not part of an arm), what other systems
    // re-pose every frame, the face's root bone, and a bone's mirror twin
    armSide: (n) => ARM_PART.rigify.exec(n)?.[2] ?? null,
    rotDriven: (n) => /^(upper_arm|forearm|hand|f_[a-z]+\d\d|thumb\d\d)[LR]$/.test(n) || n === 'jaw' || n === 'teethB' || n === 'tongue',
    posDriven: (n) => /^lip[TB][LR](001)?$/.test(n),
    faceRoot: 'face',
    mirrorName(n) {
      const m = /([LR])(\d{3})?$/.exec(n);
      return m ? n.slice(0, m.index) + (m[1] === 'L' ? 'R' : 'L') + (m[2] ?? '') : null;
    },
  },

  // Reallusion Character Creator (CC3) rig: its face is driven by shape keys (morph targets); the only face bones are
  // the jaw, tongue, teeth and eyes.
  cc: {
    id: 'cc',
    detect: (root) => !!root.getObjectByName('CC_Base_BoneRoot'),
    arm: (s) => ({ upperArm: `CC_Base_${s}_Upperarm`, foreArm: `CC_Base_${s}_Forearm`, hand: `CC_Base_${s}_Hand` }),
    fingers: ['Index', 'Mid', 'Ring', 'Pinky'],
    finger: (s, f, n) => `CC_Base_${s}_${['Index', 'Mid', 'Ring', 'Pinky'][f]}${n}`,
    thumb: (s, n) => `CC_Base_${s}_Thumb${n}`,
    eyes: ['CC_Base_L_Eye', 'CC_Base_R_Eye'],
    curlAxis: 2,
    spreadAxis: 0,
    spreadSign: -1,
    thumbPoses: signData.rigs?.cc?.thumbPoses ?? signData.thumbPoses,
    armSide: (n) => ARM_PART.cc.exec(n)?.[1] ?? null,
    rotDriven: (n) => ARM_PART.cc.test(n) || n === 'CC_Base_JawRoot',
    posDriven: () => false,
    faceRoot: 'CC_Base_FacialBone',
    // which of the model's shape keys the editor lists (the rest are teeth sculpting, eye-occlusion fitting, body deformations)
    shapeVisible: (n) => !/^(EO |Teeth |Missing Teeth|Fangs|Crease|Hinted|Buck Teeth|Scale |Misshapen|Neck_|Head_)/.test(n),
    mirrorName: (n) => (/_[LR]_/.test(n) ? n.replace(/_([LR])_/, (m, s) => (s === 'L' ? '_R_' : '_L_')) : null),
  },
};

/** The profile that fits the loaded model, or null when the skeleton isn't recognised. */
export const detectRig = (root) => Object.values(RIGS).find((rig) => rig.detect(root)) ?? null;
