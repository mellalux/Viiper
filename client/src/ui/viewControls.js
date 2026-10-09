import { Vector3 } from 'three';
import { makeDraggable } from './draggable.js';
import { ICONS } from './topbar.js';

// "Vaade" panel (draggable by its title bar like the others): zoom +/-/reset, and camera presets (front, back, sides,
// top, three-quarter) that swing the camera around the current orbit target at the current distance.
// (The mouse wheel and dragging still work as usual.)
const POS_KEY = 'viiper.viewPanel';
const STEP = 1.25; // each zoom press changes the distance to the target by this factor
const MIN_DISTANCE = 0.05;
const MAX_DISTANCE = 30;

// Directions from the target to the camera. The model faces +Z and its left side is +X.
const VIEWS = [
  { id: 'front', label: 'Ees', title: 'Otse eest', dir: [0, 0, 1] },
  { id: 'back', label: 'Taga', title: 'Tagant', dir: [0, 0, -1] },
  { id: 'left', label: 'Vasak', title: 'Tegelase vasakult küljelt', dir: [1, 0, 0] },
  { id: 'right', label: 'Parem', title: 'Tegelase parempoolselt küljelt', dir: [-1, 0, 0] },
  { id: 'top', label: 'Ülalt', title: 'Ülalt alla', dir: [0, 1, 0.0001] }, // a hair off the pole so the camera keeps an up direction
  { id: 'three-quarter', label: '3/4', title: 'Eest ja vasakult 45°', dir: [0.7071, 0.2, 0.7071] },
];

/** @param home () => { position: Vector3, target: Vector3 } the view that reset returns to */
export function createViewControls({ camera, controls, home }) {
  const box = document.createElement('div');
  box.className = 'panel view-panel';
  box.innerHTML = `
    <div class="panel__bar">
      <span class="panel__title">Vaade</span>
      <span class="panel__grip">⋮⋮</span>
    </div>
    <div class="view-panel__body">
      <div class="view-panel__zoom">
        <button data-role="in" title="Suumi sisse">+</button>
        <button data-role="out" title="Suumi välja">−</button>
        <button data-role="reset" title="Lähtesta vaade">⟲</button>
      </div>
      <div class="view-panel__views">
        ${VIEWS.map((v) => `<button data-view="${v.id}" title="${v.title}">${v.label}</button>`).join('')}
      </div>
    </div>`;
  document.body.appendChild(box);
  makeDraggable(box, box.querySelector('.panel__bar'), POS_KEY, () => [16, 16], { svg: ICONS.eye, label: 'Vaade' });

  const zoom = (factor) => {
    const offset = camera.position.clone().sub(controls.target);
    const distance = Math.min(Math.max(offset.length() * factor, MIN_DISTANCE), MAX_DISTANCE);
    camera.position.copy(controls.target).addScaledVector(offset.normalize(), distance);
    controls.update();
  };
  box.querySelector('[data-role="in"]').addEventListener('click', () => zoom(1 / STEP));
  box.querySelector('[data-role="out"]').addEventListener('click', () => zoom(STEP));
  box.querySelector('[data-role="reset"]').addEventListener('click', () => {
    const view = home();
    if (!view) return;
    controls.target.copy(view.target);
    camera.position.copy(view.position);
    // a drag still coasting (damping) must not carry the camera off the home view again
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = damping;
  });

  for (const view of VIEWS) {
    box.querySelector(`[data-view="${view.id}"]`).addEventListener('click', () => {
      const distance = camera.position.distanceTo(controls.target);
      const dir = new Vector3(...view.dir).normalize();
      camera.position.copy(controls.target).addScaledVector(dir, distance);
      controls.update();
    });
  }
}
