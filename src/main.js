import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { BLINK_CONFIG, createBlinker } from './character/blink.js';
import { LETTERS, createMouth } from './character/mouth.js';
import { createLetterPanel } from './ui/letterPanel.js';
import { createTextPanel } from './ui/textPanel.js';
import { createSignBrowser } from './ui/signBrowser.js';
import { SIGNS, STANDBY, WORD_FORMS, MOTION_LEAD, ORIENT, THUMB_POSES, HAND_CONFIG, createHands } from './signing/hands.js';
import { createMorphs } from './character/morphs.js';
import { createGaze } from './character/gaze.js';
import { createTweaks } from './signing/tweaks.js';
import { createLimits, createBoneLimits } from './signing/limits.js';
import { createBody } from './signing/body.js';
import { createTwist } from './signing/twist.js';
import { createFineTuner } from './ui/fineTuner.js';
import * as signDefs from './signing/signDefs.js';
import { createViewControls } from './ui/viewControls.js';
import { createSplash } from './ui/splash.js';
import { detectRig } from './character/rigs.js';

// Models live in src/assets/models/ and are bundled by Vite. The default is Kati.glb; pass ?model=ViiperGirl (the file name
// without .glb) to load another one from that folder, or a full URL / path for a .glb served from elsewhere.
const MODEL_URLS = Object.fromEntries(
  Object.entries(import.meta.glob('./assets/models/*.glb', { query: '?url', import: 'default', eager: true })).map(([path, url]) => [
    path.split('/').pop().replace(/\.glb$/i, ''),
    url,
  ]),
);
const modelParam = new URLSearchParams(location.search).get('model') ?? 'Kati';
const MODEL_URL = MODEL_URLS[modelParam] ?? modelParam;

const splash = createSplash();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(3, 2, 5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// The view the view panel's reset button returns to; replaced by the framed view once the model has loaded.
let homeView = { position: camera.position.clone(), target: controls.target.clone() };
createViewControls({ camera, controls, home: () => homeView });

scene.add(new THREE.HemisphereLight(0xffffff, 0x222233, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.position.set(5, 10, 7);
scene.add(sun);
scene.add(new THREE.GridHelper(20, 20, 0x444444, 0x222222));

// GLB loader with Draco (mesh compression) and Meshopt support.
// Draco decoder is fetched from a CDN; copy node_modules/three/examples/jsm/libs/draco/
// to public/draco/ and change the path below to self-host it.
const draco = new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
const loader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);

let mixer = null;
let blinker = null;
let mouth = null;
let hands = null; // the signing (right) hand
let handsL = null; // the other hand: only ever in its standby pose
let morphs = null; // the model's shape keys (face morph targets), summed over their drivers
let limits = null; // joint limits of the fingers
let boneLimits = null; // hand-set rotation limits of any single bone (limits.json)
let twist = null; // shares the hand's twist out over the forearm so the wrist skin isn't wrung
let body = null; // collision shape of the trunk and head, keeps the arms out of it
let tweaks = null; // hand-tuned bone offsets (rotation + position) from fingerspelling.json
let fineTuner = null; // the fine-tuning dock: sign definitions, bones, motion timeline (dev server only)
let gaze = null; // turns the eyes towards the mouse cursor

// Debug helpers: ?blink=0..1 freezes the lids at that closure, ?face=1 frames the face (?face=mouth the mouth),
// ?openAngle=, ?closedAngle=, ?scale= override the eyelid dome. ?viseme=O freezes the mouth in that shape,
// ?sign=B freezes the hand in that letter's finger-spelling sign (?at=0..1 also holds its motion at that fraction), ?gaze=0 keeps the eyes from following the cursor,
// ?guard=0 turns the body collision off, ?colliders=1 draws its shape.
const params = new URLSearchParams(location.search);

// Default view: straight on, head to waist, the character centred (her centre line is the middle of the model's bounding
// box) and the camera level with the target looking right at her, so the face and the signing hand are both visible.
function frameUpperBody(root) {
  const centerX = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3()).x;
  controls.target.set(centerX, 1.45, 0);
  camera.position.set(centerX, 1.45, 1.45);
  camera.near = 0.01;
  camera.far = 100;
  camera.updateProjectionMatrix();
  controls.update();
}

loader.load(
  MODEL_URL,
  (gltf) => {
    scene.add(gltf.scene);
    frameUpperBody(gltf.scene);
    for (const k of ['openAngle', 'closedAngle', 'scale']) if (params.has(k)) BLINK_CONFIG[k] = +params.get(k);
    morphs = createMorphs(gltf.scene);
    tweaks = createTweaks(gltf.scene, { weight: (side) => (side === 'L' ? handsL : hands)?.weight ?? 0, morphs }); // before anything poses the rig
    boneLimits = createBoneLimits(gltf.scene); // also before anything poses the rig: it keeps the rest pose
    blinker = createBlinker(gltf.scene, { morphs });
    mouth = createMouth(gltf.scene, { morphs });
    if (params.get('gaze') !== '0') gaze = createGaze(gltf.scene, { camera });
    if (params.has('viseme')) mouth?.snapViseme(params.get('viseme'));
    limits = createLimits(gltf.scene);
    body = createBody(gltf.scene);
    twist = createTwist(gltf.scene);
    if (body && params.has('colliders')) body.outline();
    if (import.meta.env.DEV) signDefs.restoreDrafts(); // sign definitions changed in the editor and not saved yet
    hands = createHands(gltf.scene, 'R', { body });
    handsL = createHands(gltf.scene, 'L', { body });
    // the fine-tuning dock (and its save button) only exists on the dev server, not in the production build
    if (import.meta.env.DEV) {
      fineTuner = createFineTuner({
        scene, camera, controls, dom: renderer.domElement, tweaks, boneLimits, fingerLimits: limits, letters: Object.keys(SIGNS),
        show: (k) => [hands, handsL].forEach((h) => h?.snapSign(k)),
        play: say,
        freeze: (r) => [hands, handsL].forEach((h) => h?.freezeMotion(r)),
        select: press,
        onStandby: (on) => [hands, handsL].forEach((h) => h?.setStandby(on)),
        currentSign: () => hands?.key,
        handOf: (side) => (side === 'L' ? handsL : hands),
        info: () => {
          const [r, l] = twist?.angles() ?? [0, 0];
          return `Randme väänd: parem ${r}°, vasak ${l}°${Math.abs(r) > 100 || Math.abs(l) > 100 ? '  ⚠ käsivars võib näida keerdus' : ''}`;
        },
        onLayout: setDockHeight,
      });
    }
    // start in the standby pose (or the ?sign= letter) instead of rising from a hanging arm
    hands?.snapSign(params.get('sign'));
    handsL?.snapSign(params.get('sign'));
    if (params.has('at')) [hands, handsL].forEach((h) => h?.freezeMotion(+params.get('at'))); // ?sign=TERE&at=0.5: hold the motion half way
    window.__app = { THREE, root: gltf.scene, camera, controls, mouth, blinker, hands, handsL, tweaks, limits, boneLimits, body, twist, fineTuner, signDefs, morphs, gaze, rig: detectRig(gltf.scene), LETTERS, SIGNS, ORIENT, THUMB_POSES, HAND_CONFIG }; // debugging hook
    window.__modelReady = true;
    if (params.has('blink')) blinker?.apply(+params.get('blink'));
    if (params.has('face')) {
      gltf.scene.updateMatrixWorld(true);
      const l = gltf.scene.getObjectByName('eyeL').getWorldPosition(new THREE.Vector3());
      const r = gltf.scene.getObjectByName('eyeR').getWorldPosition(new THREE.Vector3());
      const mid = l.add(r).multiplyScalar(0.5);
      if (params.get('face') === 'mouth') mid.copy(gltf.scene.getObjectByName('lipTL').getWorldPosition(new THREE.Vector3()));
      controls.target.copy(mid);
      camera.position.copy(mid).add(new THREE.Vector3(0, 0, params.get('face') === 'mouth' ? 0.2 : 0.35));
      camera.near = 0.01;
      camera.updateProjectionMatrix();
      controls.update();
    }
    homeView = { position: camera.position.clone(), target: controls.target.clone() };
    if (gltf.animations.length) {
      mixer = new THREE.AnimationMixer(gltf.scene);
      gltf.animations.forEach((clip) => mixer.clipAction(clip).play());
    }
    splash.done();
  },
  (e) => splash.progress(e.lengthComputable ? e.loaded / e.total : null),
  (err) => {
    console.warn(`Could not load ${MODEL_URL}, showing placeholder cube.`, err);
    splash.done();
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x44aaff }),
    );
    cube.position.y = 0.5;
    scene.add(cube);
  },
);

// The fine-tuning dock covers the bottom of the screen: the view is shifted up so the character stays in the part left over.
let dockHeight = 0;
function updateView() {
  camera.aspect = window.innerWidth / window.innerHeight;
  if (dockHeight) camera.setViewOffset(window.innerWidth, window.innerHeight, 0, dockHeight / 2, window.innerWidth, window.innerHeight);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}
function setDockHeight(px) {
  dockHeight = px;
  updateView();
}
window.addEventListener('resize', () => {
  updateView();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const timer = new THREE.Timer();
timer.connect(document); // ignores the time spent in a hidden tab, so dt doesn't spike on return
renderer.setAnimationLoop((time) => {
  timer.update(time);
  const dt = timer.getDelta();
  // The limits editor: the model stands in its rest pose (no animation, signs, tweaks or expressions), only the bones turned by hand move.
  if (boneLimits?.editing) {
    boneLimits.applyEdit();
    morphs?.reset();
    if (boneLimits.preview) {
      limits?.apply(true);
      boneLimits.apply(true);
    }
    fineTuner?.update();
    controls.update();
    renderer.render(scene, camera);
    return;
  }
  mixer?.update(dt);
  if (!params.has('blink')) blinker?.update(dt);
  // Frozen debug poses (?sign=, ?viseme=) still re-pose every frame with dt = 0, so the tweaks on top don't pile up.
  const frozenSign = params.has('sign');
  tweaks?.setKey(hands?.key ?? null);
  tweaks?.step(dt);
  tweaks?.applyPre(); // body offsets first: the arms' IK reads the shoulders
  hands?.update(frozenSign ? 0 : dt);
  handsL?.update(frozenSign ? 0 : dt);
  mouth?.update(params.has('viseme') ? 0 : dt);
  tweaks?.applyPost(); // face, arms and fingers after hands.js / mouth.js have posed them
  limits?.apply(); // fingers can't bend the wrong way (after the tweaks, which may push them there)
  for (const h of [hands, handsL]) {
    if (!h) continue;
    h.motionPaused = frozenSign || (fineTuner?.holding ?? false); // tuning a sign needs it to hold still
    h.applyMotion(); // signs that move (Z) trace their path on top of the tuned pose
    if (params.get('guard') !== '0') h.avoidBody(); // and last, arms and hands are kept out of the body
  }
  twist?.apply(); // the arms have their final pose: the forearm's twist bones follow the hand
  gaze?.update(dt);
  boneLimits?.apply(); // last of all: nothing may turn a bone past the limits set in limits.json
  morphs?.flush();
  fineTuner?.update();
  controls.update();
  renderer.render(scene, camera);
});

// Alphabet: hold a letter key (or press a panel button) to show that mouth shape; release for rest.
const panel = createLetterPanel(Object.keys(LETTERS), {
  onPress: press,
  onRelease: release,
});

// Text box: the typed letters are signed one after another.
createTextPanel(Object.keys(LETTERS), {
  words: WORD_FORMS,
  // a word sign that moves is held until its motion has played
  holdMs: (sign) => (SIGNS[sign]?.motion ? (MOTION_LEAD + SIGNS[sign].motion.duration) * 1000 + 250 : 450),
  onPress: press,
  onRelease: release,
  onFinish: () => say(null), // the word is done (or stopped): hands back to standby
  // equal letters in a row: the hand(s) that sign the letter make a small push forward and back
  onRepeat: (letter) => {
    hands?.bump();
    if (tweaks?.usesLeftArm(letter)) handsL?.bump();
  },
});

const WORD_SIGNS = new Set(Object.values(WORD_FORMS));

// Sign viewer: search, alphabetical list and A-Z strip; a clicked sign is shown (and repeated, if ticked).
createSignBrowser([...WORD_SIGNS], {
  aliases: WORD_FORMS,
  alphabet: Object.keys(LETTERS),
  holdMs: (sign) => (SIGNS[sign]?.motion ? (MOTION_LEAD + SIGNS[sign].motion.duration) * 1000 + 250 : 450),
  onPress: press,
  onRelease: release,
  onFinish: () => say(null),
});

// text: what was typed for a word sign (an alias such as "PALJU ÕNNE"), which the mouth then says; defaults to the sign's own word
function say(letter, text = letter) {
  if (WORD_FORMS[letter] === letter) { // a word sign (also one just added in the editor)
    // the mouth follows the hand: it starts when the sign's motion does and spreads the word over it
    mouth?.speak(text, { duration: SIGNS[letter].motion?.duration, delay: SIGNS[letter].motion ? MOTION_LEAD : 0 });
  } else mouth?.setViseme(LETTERS[letter] ?? 'rest');
  hands?.setSign(letter);
  handsL?.setSign(letter); // joins in two-handed letters, otherwise stays in standby
  panel.setActive(letter);
}

function press(letter, text) {
  say(letter, text);
  fineTuner?.setSign(letter);
}
// After release the hands stay in the last sign (the panel keeps it highlighted); only the mouth returns to rest.
// Escape sends the hands back to standby.
function release() {
  mouth?.setViseme('rest');
}

let heldKey = null;
window.addEventListener('keydown', (e) => {
  if (boneLimits?.editing) return; // no signs in the limits editor
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.target.tagName === 'SELECT') return;
  if (e.key === 'Escape') return say(null);
  const letter = e.key.toUpperCase();
  if (letter in LETTERS) {
    heldKey = letter;
    press(letter);
  }
});
window.addEventListener('keyup', (e) => {
  if (e.key.toUpperCase() === heldKey) {
    heldKey = null;
    release();
  }
});
