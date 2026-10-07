import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { app, params } from './session.js';
import { createCharacter } from './character.js';
import { createDevDock } from './devDock.js';
import { installDebug } from '../debug.js';

// Models live in src/assets/models/ and are bundled by Vite. The default is Kati.glb; pass ?model=ViiperGirl (the file name
// without .glb) to load another one from that folder, or a full URL / path for a .glb served from elsewhere.
const MODEL_URLS = Object.fromEntries(
  Object.entries(import.meta.glob('../assets/models/*.glb', { query: '?url', import: 'default', eager: true })).map(([path, url]) => [
    path.split('/').pop().replace(/\.glb$/i, ''),
    url,
  ]),
);
const modelParam = params.get('model') ?? 'Kati';
const MODEL_URL = MODEL_URLS[modelParam] ?? modelParam;

// GLB loader with Meshopt support (Kati.glb is meshopt-compressed). A Draco-compressed model needs a DRACOLoader too, see the README.
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

/** Load the model into the stage and bring it to life; `splash` shows the progress. */
export function loadModel(stage, splash) {
  loader.load(
    MODEL_URL,
    (gltf) => {
      const root = gltf.scene;
      stage.scene.add(root);
      stage.frameUpperBody(root);
      const c = (app.character = createCharacter(gltf, stage));
      if (import.meta.env.DEV) app.dock = createDevDock(c, stage);
      c.start();
      installDebug({ ...c, controls: stage.controls, fineTuner: app.dock }, { params, pose: c.pose });
      if (params.has('blink')) c.blinker?.apply(+params.get('blink'));
      if (params.has('face')) stage.frameFace(root, params.get('face'));
      stage.saveHome();
      splash.done();
    },
    (e) => splash.progress(e.lengthComputable ? e.loaded / e.total : null),
    (err) => {
      console.warn(`Could not load ${MODEL_URL}, showing placeholder cube.`, err);
      splash.done();
      const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x44aaff }));
      cube.position.y = 0.5;
      stage.scene.add(cube);
    },
  );
}
