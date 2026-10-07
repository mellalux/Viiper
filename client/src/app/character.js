import * as THREE from 'three';
import { BLINK_CONFIG, createBlinker } from '../character/blink.js';
import { createMouth } from '../character/mouth.js';
import { createMorphs } from '../character/morphs.js';
import { createGaze } from '../character/gaze.js';
import { detectRig } from '../character/rigs.js';
import { createHands } from '../signing/hands.js';
import { createTweaks } from '../signing/tweaks.js';
import { createLimits, createBoneLimits } from '../signing/limits.js';
import { createBody } from '../signing/body.js';
import { createHandHits } from '../signing/handHits.js';
import { createHandGuard } from '../signing/handGuard.js';
import { createFingerGuard } from '../signing/fingerGuard.js';
import { createTwist } from '../signing/twist.js';
import { createArmPose } from '../signing/armPose.js';
import * as signDefs from '../signing/signDefs.js';
import { currentUser } from '../auth.js';
import { app, params } from './session.js';

/** Everything that makes the loaded model live: face, hands, limits, guards and the pose they are put in each frame. */
export function createCharacter(gltf, { scene, camera }) {
  const root = gltf.scene;
  for (const k of ['openAngle', 'closedAngle', 'scale']) if (params.has(k)) BLINK_CONFIG[k] = +params.get(k);
  const c = { root, camera, hands: null, handsL: null }; // hands: the signing (right) hand; handsL: the other hand, only ever in its standby pose

  c.morphs = createMorphs(root); // the model's shape keys (face morph targets), summed over their drivers
  c.tweaks = createTweaks(root, { weight: (side) => (side === 'L' ? c.handsL : c.hands)?.weight ?? 0, morphs: c.morphs }); // hand-tuned bone offsets from fingerspelling.json; before anything poses the rig
  c.boneLimits = createBoneLimits(root); // hand-set rotation limits of any single bone (limits.json); also before anything poses the rig: it keeps the rest pose
  c.blinker = createBlinker(root, { morphs: c.morphs });
  c.mouth = createMouth(root, { morphs: c.morphs });
  c.gaze = params.get('gaze') !== '0' ? createGaze(root, { camera }) : null; // turns the eyes towards the mouse cursor
  if (params.has('viseme')) c.mouth?.snapViseme(params.get('viseme'));
  c.limits = createLimits(root); // joint limits of the fingers
  c.body = createBody(root); // collision shape of the trunk and head, keeps the arms out of it
  c.twist = createTwist(root); // shares the hand's twist out over the forearm so the wrist skin isn't wrung
  c.handHits = createHandHits(root); // capsules of the hands and forearms: measures fingers and hands going through each other (dev check)

  // the collision shapes drawn (body, hand capsules): ?colliders=1 or the fine-tuning dock's tick; built the first time they are wanted
  let colliderDraw = [];
  c.setColliders = (on) => {
    if (on && !colliderDraw.length) colliderDraw = [c.body?.outline(), c.handHits?.outline()].filter(Boolean);
    for (const shape of colliderDraw) shape.visible = on;
  };
  if (params.has('colliders')) c.setColliders(true);

  if (currentUser()) signDefs.restoreDrafts(); // sign definitions changed in the editor and not saved yet
  c.hands = createHands(root, 'R', { body: c.body });
  c.handsL = createHands(root, 'L', { body: c.body });
  const hands = { R: c.hands, L: c.handsL };
  if (c.handHits && c.hands && c.handsL) {
    c.handGuard = createHandGuard({ hits: c.handHits, hands, body: c.body }); // keeps the two hands and forearms out of each other
    c.fingerGuard = createFingerGuard({ hits: c.handHits, hands, rig: detectRig(root), clamps: [() => c.limits?.apply(), () => c.boneLimits?.apply()] }); // keeps the fingers and the thumb of a hand out of each other
  }
  c.pose = createArmPose({
    scene, ...c, // hands, handsL, tweaks, limits, boneLimits, twist, handHits, handGuard, fingerGuard
    holding: () => app.dock?.holding ?? false,
    guards: params.get('guard') !== '0', // body and hand-to-hand guards (?guard=0 or the dock's tick turn them off)
  });

  const mixer = gltf.animations.length ? new THREE.AnimationMixer(root) : null;
  gltf.animations.forEach((clip) => mixer.clipAction(clip).play());

  /** Start in the standby pose (or the ?sign= letter) instead of rising from a hanging arm. */
  c.start = () => {
    c.hands?.snapSign(params.get('sign'));
    c.handsL?.snapSign(params.get('sign'));
    if (params.has('at')) [c.hands, c.handsL].forEach((h) => h?.freezeMotion(+params.get('at'))); // ?sign=TERE&at=0.5: hold the motion half way
  };

  /** One frame of the face, the arms' pose and the limits. */
  c.update = (dt) => {
    mixer?.update(dt);
    if (!params.has('blink')) c.blinker?.update(dt);
    c.mouth?.update(params.has('viseme') ? 0 : dt);
    // Frozen debug poses (?sign=, ?viseme=) still re-pose every frame with dt = 0, so the tweaks on top don't pile up.
    c.pose.arms(dt, { frozen: params.has('sign') });
    c.gaze?.update(dt);
    c.boneLimits?.apply(); // last of all: nothing may turn a bone past the limits set in limits.json
    c.morphs?.flush();
  };
  c.updateColliders = () => {
    for (const shape of colliderDraw) if (shape.visible) shape.userData.update?.();
  };
  return c;
}
