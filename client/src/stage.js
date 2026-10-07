import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createViewControls } from './ui/viewControls.js';
import { detectRig } from './character/rigs.js';

/** The renderer, scene, lights, camera and orbit controls, and the camera framings (upper body, face) the model is shown in. */
export function createStage() {
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

  // The fine-tuning dock covers the bottom of the screen: the view is shifted up so the character stays in the part left over.
  let dockHeight = 0;
  function updateView() {
    camera.aspect = window.innerWidth / window.innerHeight;
    if (dockHeight) camera.setViewOffset(window.innerWidth, window.innerHeight, 0, dockHeight / 2, window.innerWidth, window.innerHeight);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', () => {
    updateView();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const stage = {
    renderer, scene, camera, controls,
    // the view the view panel's reset button returns to; saveHome() makes the current view the one
    homeView: { position: camera.position.clone(), target: controls.target.clone() },
    saveHome() {
      stage.homeView = { position: camera.position.clone(), target: controls.target.clone() };
    },
    setDockHeight(px) {
      dockHeight = px;
      updateView();
    },
    /** Straight on, head to waist, the character centred (her centre line is the middle of the model's bounding box) and the camera
     *  level with the target looking right at her, so the face and the signing hand are both visible. */
    frameUpperBody(root) {
      const centerX = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3()).x;
      controls.target.set(centerX, 1.45, 0);
      camera.position.set(centerX, 1.45, 1.45);
      camera.near = 0.01;
      camera.far = 100;
      camera.updateProjectionMatrix();
      controls.update();
    },
    /** Close up on the eyes, or on the mouth (`what` = 'mouth'). */
    frameFace(root, what) {
      root.updateMatrixWorld(true);
      // the bone names differ per rig (rigs.js); a rig without them leaves the view where it is
      const rig = detectRig(root);
      const at = (name) => root.getObjectByName(name)?.getWorldPosition(new THREE.Vector3());
      const eyes = (rig?.eyes ?? []).map(at).filter(Boolean);
      const mouth = what === 'mouth';
      const mid = (mouth ? at(rig?.mouthBone) : eyes.length && eyes.reduce((a, b) => a.add(b)).multiplyScalar(1 / eyes.length)) || controls.target.clone();
      controls.target.copy(mid);
      camera.position.copy(mid).add(new THREE.Vector3(0, 0, mouth ? 0.2 : 0.35));
      camera.near = 0.01;
      camera.updateProjectionMatrix();
      controls.update();
    },
  };
  createViewControls({ camera, controls, home: () => stage.homeView });
  return stage;
}
