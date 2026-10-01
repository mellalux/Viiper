import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { BLINK_CONFIG, createBlinker } from './blink.js';
import { LETTERS, createMouth } from './mouth.js';
import { createLetterPanel } from './letterPanel.js';

// Put your model at public/models/ViiperGirl.glb (or pass ?model=/models/other.glb)
const MODEL_URL = new URLSearchParams(location.search).get('model') ?? '/models/ViiperGirl.glb';

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

// Debug helpers: ?blink=0..1 freezes the lids at that closure, ?face=1 frames the face (?face=mouth the mouth),
// ?openAngle=, ?closedAngle=, ?scale= override the eyelid dome. ?viseme=O freezes the mouth in that shape.
const params = new URLSearchParams(location.search);

function frameObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const dist = Math.max(size.x, size.y, size.z) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  camera.position.copy(center).add(new THREE.Vector3(1, 0.6, 1).normalize().multiplyScalar(dist * 1.5));
  camera.near = dist / 100;
  camera.far = dist * 100;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

loader.load(
  MODEL_URL,
  (gltf) => {
    scene.add(gltf.scene);
    frameObject(gltf.scene);
    for (const k of ['openAngle', 'closedAngle', 'scale']) if (params.has(k)) BLINK_CONFIG[k] = +params.get(k);
    blinker = createBlinker(gltf.scene);
    mouth = createMouth(gltf.scene);
    if (params.has('viseme')) mouth?.snapViseme(params.get('viseme'));
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
  if (!params.has('viseme')) mouth?.update(dt);
  controls.update();
  renderer.render(scene, camera);
});

// Alphabet: hold a letter key (or press a panel button) to show that mouth shape; release for rest.
const panel = createLetterPanel(Object.keys(LETTERS), {
  onPress: (letter) => say(letter),
  onRelease: () => say(null),
});

function say(letter) {
  mouth?.setViseme(letter ? LETTERS[letter] : 'rest');
  panel.setActive(letter);
}

let heldKey = null;
window.addEventListener('keydown', (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const letter = e.key.toUpperCase();
  if (letter in LETTERS) {
    heldKey = letter;
    say(letter);
  }
});
window.addEventListener('keyup', (e) => {
  if (e.key.toUpperCase() === heldKey) {
    heldKey = null;
    say(null);
  }
});
