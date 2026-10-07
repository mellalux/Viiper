import { SIGNS } from '../signing/hands.js';
import { createFineTuner } from '../ui/fineTuner.js';
import { params } from './session.js';
import { say, press } from './signing.js';

/** The fine-tuning dock (and its save button): for signed-in users; saving goes to the server. */
export function createEditorDock(c, { scene, camera, controls, renderer, setDockHeight }) {
  const both = [c.hands, c.handsL];
  return createFineTuner({
    scene, camera, controls, dom: renderer.domElement, tweaks: c.tweaks, boneLimits: c.boneLimits, fingerLimits: c.limits, letters: Object.keys(SIGNS),
    show: (k) => both.forEach((h) => h?.snapSign(k)),
    play: say,
    freeze: (r) => both.forEach((h) => h?.freezeMotion(r)),
    select: press,
    onStandby: (on) => both.forEach((h) => h?.setStandby(on)),
    onGuards: (on) => (c.pose.guards = on),
    onColliders: c.setColliders,
    collidersOn: params.has('colliders'),
    currentSign: () => c.hands?.key,
    handOf: (side) => (side === 'L' ? c.handsL : c.hands),
    info: () => {
      const [r, l] = c.twist?.angles() ?? [0, 0];
      return `Randme väänd: parem ${r}°, vasak ${l}°${Math.abs(r) > 100 || Math.abs(l) > 100 ? '  ⚠ käsivars võib näida keerdus' : ''}`;
    },
    onLayout: setDockHeight,
  });
}
