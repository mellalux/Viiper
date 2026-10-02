import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { BLINK_CONFIG, createBlinker } from './blink.js';
import { LETTERS, createMouth } from './mouth.js';
import { createLetterPanel } from './letterPanel.js';
import { SIGNS, ORIENT, THUMB_POSES, HAND_CONFIG, createHands } from './hands.js';
import { createMorphs } from './morphs.js';
import { createTweaks } from './tweaks.js';
import { createBoneEditor } from './boneEditor.js';
import { createViewControls } from './viewControls.js';
import { detectRig } from './rigs.js';

// The default model is public/models/Kati.glb; pass ?model=/models/ViiperGirl.glb (or any other .glb) to load another
const MODEL_URL = new URLSearchParams(location.search).get('model') ?? '/models/Kati.glb';

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
let model = null; // the loaded model's root
// The signer's own view (as in the finger-spelling chart): from just in front of the eyes, looking at the signing hand.
function signerView() {
  const rig = model && detectRig(model);
  if (!rig) return null;
  const [l, r] = rig.eyes.map((n) => model.getObjectByName(n));
  const hand = model.getObjectByName(rig.arm('R').hand);
  if (!l || !r || !hand) return null;
  const eyes = l.getWorldPosition(new THREE.Vector3()).add(r.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
  return { position: eyes.add(new THREE.Vector3(0, 0.01, 0.06)), target: hand.getWorldPosition(new THREE.Vector3()) };
}
const viewControls = createViewControls({ camera, controls, home: () => homeView, signerView });

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
let tweaks = null; // hand-tuned bone offsets (rotation + position) from signs.json
let boneEditor = null;

// Debug helpers: ?blink=0..1 freezes the lids at that closure, ?face=1 frames the face (?face=mouth the mouth),
// ?openAngle=, ?closedAngle=, ?scale= override the eyelid dome. ?viseme=O freezes the mouth in that shape,
// ?sign=B freezes the hand in that letter's finger-spelling sign.
const params = new URLSearchParams(location.search);

// Default view: front-on, head to waist, so the face and the signing hand are both visible.
function frameUpperBody() {
  controls.target.set(-0.05, 1.45, 0);
  camera.position.set(-0.05, 1.5, 1.45);
  camera.near = 0.01;
  camera.far = 100;
  camera.updateProjectionMatrix();
  controls.update();
}

loader.load(
  MODEL_URL,
  (gltf) => {
    model = gltf.scene;
    scene.add(gltf.scene);
    frameUpperBody();
    for (const k of ['openAngle', 'closedAngle', 'scale']) if (params.has(k)) BLINK_CONFIG[k] = +params.get(k);
    morphs = createMorphs(gltf.scene);
    tweaks = createTweaks(gltf.scene, { weight: (side) => (side === 'L' ? handsL : hands)?.weight ?? 0, morphs }); // before anything poses the rig
    blinker = createBlinker(gltf.scene, { morphs });
    mouth = createMouth(gltf.scene, { morphs });
    if (params.has('viseme')) mouth?.snapViseme(params.get('viseme'));
    hands = createHands(gltf.scene, 'R');
    handsL = createHands(gltf.scene, 'L');
    boneEditor = createBoneEditor({
      scene, camera, controls, dom: renderer.domElement, tweaks, letters: Object.keys(SIGNS),
      onLetter: say,
      onStandby: (on) => [hands, handsL].forEach((h) => h?.setStandby(on)),
    });
    // start in the standby pose (or the ?sign= letter) instead of rising from a hanging arm
    hands?.snapSign(params.get('sign'));
    handsL?.snapSign(params.get('sign'));
    window.__app = { THREE, root: gltf.scene, camera, controls, mouth, blinker, hands, handsL, tweaks, morphs, rig: detectRig(gltf.scene), LETTERS, SIGNS, ORIENT, THUMB_POSES, HAND_CONFIG }; // debugging hook
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
  },
  undefined,
  (err) => {
    console.warn(`Could not load ${MODEL_URL}, showing placeholder cube.`, err);
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x44aaff }),
    );
    cube.position.y = 0.5;
    scene.add(cube);
  },
);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
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
  morphs?.flush();
  boneEditor?.update();
  viewControls.update(); // the signer's view follows the hand
  controls.update();
  renderer.render(scene, camera);
});

// Alphabet: hold a letter key (or press a panel button) to show that mouth shape; release for rest.
const panel = createLetterPanel(Object.keys(LETTERS), {
  onPress: press,
  onRelease: release,
});

function say(letter) {
  mouth?.setViseme(LETTERS[letter] ?? 'rest');
  hands?.setSign(letter);
  handsL?.setSign(letter); // joins in two-handed letters, otherwise stays in standby
  panel.setActive(letter);
}

// While the fine-tuning panel is editing, the pressed letter stays shown after release.
function press(letter) {
  say(letter);
  boneEditor?.setLetter(letter);
}
function release() {
  if (!boneEditor?.active) say(null);
}

let heldKey = null;
window.addEventListener('keydown', (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.target.tagName === 'SELECT') return;
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
