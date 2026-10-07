import * as THREE from 'three';
import { app } from './session.js';

/** The animation loop: the character's frame, the dock, the controls and the render. */
export function startLoop({ renderer, scene, camera, controls }) {
  const timer = new THREE.Timer();
  timer.connect(document); // ignores the time spent in a hidden tab, so dt doesn't spike on return
  renderer.setAnimationLoop((time) => {
    timer.update(time);
    app.character?.update(timer.getDelta());
    app.dock?.update();
    app.character?.updateColliders();
    controls.update();
    renderer.render(scene, camera);
  });
}
