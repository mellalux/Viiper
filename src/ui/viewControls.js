import { Vector3 } from 'three';
import { makeDraggable } from './draggable.js';

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

const css = `
.view-panel {
  position: fixed; z-index: 10; width: 168px; border-radius: 12px; user-select: none; touch-action: none;
  font: 13px system-ui, sans-serif; color: #e8e8ec;
  background: rgba(24, 24, 28, 0.88); border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5); backdrop-filter: blur(8px);
}
.view-panel__bar {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 8px 12px; cursor: grab; border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.view-panel.is-dragging .view-panel__bar { cursor: grabbing; }
.view-panel__title { font-weight: 600; letter-spacing: 0.02em; }
.view-panel__grip { color: #888; letter-spacing: 2px; }
.view-panel__body { display: grid; gap: 10px; padding: 10px 12px 12px; }
.view-panel__zoom { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.view-panel__views { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
.view-panel button {
  height: 30px; padding: 0; border-radius: 8px; cursor: pointer; font: inherit; font-size: 12px; line-height: 1;
  color: #e8e8ec; background: #2c2c33; border: 1px solid rgba(255, 255, 255, 0.1);
}
.view-panel__zoom button { font-size: 17px; }
.view-panel button:hover { background: #38383f; }
.view-panel button:active { background: #2f9e6e; }
`;

/** @param home () => { position: Vector3, target: Vector3 } the view that reset returns to */
export function createViewControls({ camera, controls, home }) {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const box = document.createElement('div');
  box.className = 'view-panel';
  box.innerHTML = `
    <div class="view-panel__bar">
      <span class="view-panel__title">Vaade</span>
      <span class="view-panel__grip">⋮⋮</span>
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
  makeDraggable(box, box.querySelector('.view-panel__bar'), POS_KEY, () => [16, 16]);

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
    controls.update();
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
