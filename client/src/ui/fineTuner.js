import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { api, ApiError } from '../auth.js';
import { versions } from '../data/store.js';
import { askLogin } from './account.js';
import { makeDraggable } from './draggable.js';
import { ICONS, iconButton, topbar } from './topbar.js';
import { canon, fingerprint, fold } from '../util.js';
import { STANDBY, SIGNS, ORIENT, THUMB_POSES, HAND_CONFIG, MOTION_LEAD, pathTimes, tracePoint } from '../signing/hands.js';
import { GROUPS, tweaksFromSigns } from '../signing/tweaks.js';
import * as defs from '../signing/signDefs.js';
import * as orients from '../signing/orients.js';
import { isLetterName } from '../signing/signFormat.js';
import { createWorkingTable } from '../signing/workingTable.js';
import { createBasePose } from './basePose.js';
import { orientLabel, thumbLabel } from './labels.js';
import { mirrorRange, axisMax } from '../signing/limits.js';

// The fine-tuning window (signed-in editors only): one horizontal dock along the bottom of the screen.
//   top    blocks side by side: pick a sign (search), the hand's pose, the fingers, a single bone, copying between signs
//   bottom the timeline of the sign's motion: one track per channel, the playhead, the points of the path
// What makes a sign (where the hand is held, the finger curls, the motion path) is edited per sign and hand and saved in the
// sign's definition (signDefs.js); the rotation of single bones (arms and fingers, face and lips, body) and the weight of face
// shape keys are tweaks (tweaks.js). Edits apply per sign (face, signing arm), only to the standby pose (the other arm) or
// always (body). Both kinds are kept in localStorage as a working copy until "Salvesta" saves them to the server (the database;
// PUT /api/data, for signed-in users). Every sign carries a version: saving a sign somebody else saved meanwhile is refused.
// A bone can also get rotation limits (limits.js): min / max per axis, the same for every sign, saved on the server too
// and kept as a working copy the same way. The limits clamp the final pose of the bone, whatever poses it.
// The base poses (the named orients: where a hand is held and which way it points, shared by many signs) have a mode of their own
// (basePose.js, opened from the hand's block): handles in the scene move the wrist, the elbow and the turn of the hand. The thumb poses
// are edited in the fingers' block. Both are a working copy in this browser (orients.js, workingTable.js) until "Salvesta" saves them
// to the server (the `orients` and `thumbPoses` documents): then everybody who opens the page sees them. (What a base pose does with the
// body's bones, and the keyframes, are kept in this browser only.)
// A selected bone is turned and moved in the scene with a TransformControls gizmo (on a proxy object that follows the bone; what it
// is dragged to is turned back into the bone's tweak, see tweaks.tweakFor); everything else is edited in number fields.
const STORAGE_KEY = 'viiper.tweaks';
const LIMITS_KEY = 'viiper.boneLimits';
const FRAMES_KEY = 'viiper.frames'; // the keyframes (tweaks.js): { frames, n: path length per sign }, this browser only
const STANDBY_KEY = 'viiper.standby';
const UI_KEY = 'viiper.fineTuner'; // { open, height, tlCollapsed, blocksCollapsed, gizmoMode, gizmoSpace }
const SAVE_URL = '/api/data';


const FINGERS = ['Nimetissõrm', 'Keskmine sõrm', 'Sõrmusesõrm', 'Väike sõrm'];
const AXES = ['x', 'y', 'z'];

// The channels of a motion path point (see hands.js). `min` is the smallest half-range of the channel's track.
const CHANNELS = [
  { id: 'x', step: 0.01, min: 0.2, color: '#ff7a7a', title: 'x: randme nihe paremale (vaataja poolt), käe pikkustes' },
  { id: 'y', step: 0.01, min: 0.2, color: '#5fd0a0', title: 'y: randme nihe ülespoole, käe pikkustes' },
  { id: 'z', step: 0.01, min: 0.2, color: '#58c4ff', title: 'z: randme nihe ettepoole (vaataja poole), käe pikkustes' },
  { id: 'tilt', unit: '°', step: 1, min: 30, color: '#c792ea', title: 'tilt: käelaba kalle randmest (°), nagu lehvitamisel' },
  { id: 'flex', unit: '°', step: 1, min: 30, color: '#ffd166', title: 'flex: randme painutus (°), sõrmeotsad peopesa (+) või käeselja (−) poole' },
  { id: 'roll', unit: '°', step: 1, min: 30, color: '#f78c6c', title: 'roll: käelaba keeramine sõrmede telje ümber (°)' },
  { id: 'curl', step: 0.01, min: 1, color: '#9aa5ff', title: 'curl: kõigi sõrmede lisapainutus (0…1)' },
  { id: 'outer', step: 0.01, min: 1, color: '#7fdbd0', title: 'outer: ainult nimetis- ja väikese sõrme lisapainutus (-1…1), nagu sarvede sirgumine' },
];
// timeline geometry (px)
const TL = { gutter: 84, right: 12, ruler: 20, row: 21 };

const css = `
.topbar-icon.fd-launch { order: 3; color: #e8e8ec; } /* a button of the top row (topbar.js) */
.fd-launch[hidden] { display: none; }
body.fd-open .letter-panel { display: none; } /* the dock has its own sign list; the bottom of the screen is the dock's */

.fd {
  position: fixed; z-index: 12; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column; box-sizing: border-box;
  font: 13px system-ui, sans-serif; color: #e8e8ec; user-select: none;
  background: rgba(22, 22, 26, 0.96); border-top: 1px solid rgba(255, 255, 255, 0.16);
  box-shadow: 0 -10px 30px rgba(0, 0, 0, 0.5); backdrop-filter: blur(8px);
}
.fd[hidden], .fd [hidden] { display: none !important; }
/* the gizmo panel: a floating panel (panels.css) with the dock's controls */
.fd-gizmo { z-index: 12; width: 330px; font: 13px system-ui, sans-serif; max-height: calc(100vh - 66px); display: flex; flex-direction: column; }
.fd-gizmo > .fd-gizmo__body { min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; } /* a tall panel scrolls under its title bar */
.fd-gizmo[hidden], .fd-gizmo [hidden] { display: none !important; }
.fd-gizmo__body { display: grid; gap: 8px; padding: 10px 12px 12px; }
.fd-gizmo button, .fd-gizmo input[type=number] { font: inherit; color: inherit; background: #2c2c33; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; }
.fd-gizmo select { font: inherit; color: inherit; min-width: 0; padding: 3px 6px; background: #2c2c33; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; }
.fd-gizmo button.fd__ibtn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.fd-gizmo button.fd__ibtn svg { flex: none; }
.fd-gizmo button { padding: 5px 8px; border-radius: 8px; cursor: pointer; font-size: 12px; }
.fd-gizmo button:hover:not(:disabled) { background: #38383f; }
.fd-gizmo button.fd__on { background: #2f9e6e; border-color: #5fd0a0; color: #fff; }
.fd-gizmo button.fd__on:hover:not(:disabled) { background: #38b07d; }
.fd-gizmo button:disabled, .fd-gizmo input:disabled { opacity: 0.4; cursor: default; }
.fd-gizmo input[type=number] { min-width: 0; padding: 3px 6px; box-sizing: border-box; user-select: text; }
.fd button, .fd select, .fd input[type=number], .fd input[type=search], .fd input[type=text] {
  font: inherit; color: inherit; background: #2c2c33; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px;
}
.fd button { padding: 5px 10px; border-radius: 8px; cursor: pointer; font-size: 12px; }
.fd button:hover:not(:disabled) { background: #38383f; }
.fd button:disabled, .fd input:disabled, .fd select:disabled { opacity: 0.4; cursor: default; }
.fd select { min-width: 0; padding: 3px 6px; }
.fd input[type=number], .fd input[type=search], .fd input[type=text] { min-width: 0; padding: 3px 6px; box-sizing: border-box; }
.fd button.fd__on { background: #2f9e6e; border-color: #5fd0a0; color: #fff; }
.fd button.fd__primary { background: #2f9e6e; border-color: #5fd0a0; color: #fff; }
.fd button.fd__primary:hover:not(:disabled), .fd button.fd__on:hover:not(:disabled) { background: #38b07d; }
.fd__resize { position: absolute; left: 0; right: 0; top: -4px; height: 8px; cursor: ns-resize; touch-action: none; }
.fd__bar { display: flex; align-items: center; gap: 10px; flex: none; padding: 6px 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
.fd__title { font-weight: 600; letter-spacing: 0.02em; }
.fd__current { padding: 2px 10px; border-radius: 6px; font-weight: 600; background: #2f9e6e; color: #fff; }
.fd__status { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #9a9aa5; font-size: 12px; }
.fd__status--dirty { color: #ffb347; }
.fd__blocks { display: flex; gap: 10px; flex: 1; min-height: 110px; padding: 10px 12px; overflow-x: auto; overflow-y: hidden; }
.fd__block {
  flex: none; display: flex; flex-direction: column; gap: 6px; box-sizing: border-box; padding: 8px 10px 10px; overflow-y: auto; overflow-x: hidden;
  border-radius: 10px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.07);
}
/* a card folds sideways into a narrow strip with its title written upright (the button sits in the card's top right corner) */
.fd__block { position: relative; }
.fd__fold { position: sticky; top: 0; z-index: 2; flex: none; align-self: flex-end; height: 0; margin-bottom: -6px; }
.fd__fold button { position: absolute; right: -2px; top: -4px; width: 22px; height: 22px; padding: 0 !important; line-height: 1; border-radius: 6px !important; font-size: 11px !important; }
.fd__block > .fd__h, .fd__block--folded { cursor: grab; }
.fd__block--moving, .fd__block--moving > .fd__h { cursor: grabbing; }
.fd__block--moving { outline: 1px solid #5fd0a0; background: rgba(95, 208, 160, 0.1); }
.fd__block--folded { width: 34px !important; padding: 8px 0 !important; align-items: center; overflow: hidden; }
.fd__block--folded > *:not(.fd__fold) { display: none !important; }
.fd__block--folded .fd__fold { position: static; height: auto; margin: 0; align-self: center; }
.fd__block--folded .fd__fold button { position: static; }
.fd__block--folded::after { content: attr(data-title); margin-top: 10px; writing-mode: vertical-rl; color: #c8c8d0; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; white-space: nowrap; }
.fd__h { flex: none; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: #c8c8d0; }
.fd__sub { color: #9a9aa5; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 4px; }
.fd__note { color: #9a9aa5; font-size: 12px; line-height: 1.4; }
.fd__note b { color: #ffb347; font-weight: 600; }
.fd__warn { color: #ffb347; }
.fd__row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.fd__row > select { flex: 1; max-width: 190px; }
.fd__buttons { display: flex; gap: 6px; }
.fd__buttons > button { flex: 1; padding: 5px 4px; }
.fd__handtabs { flex: none; }
.fd__handtabs > button { flex: none; padding: 5px 10px; }
/* (the label may shrink and wrap: with a fixed-width label the row grew wider than its column and ran into the next one) */
.fd__num { display: grid; grid-template-columns: minmax(0, 0.8fr) minmax(24px, 1fr) 56px 12px; align-items: center; gap: 6px; min-width: 0; }
.fd__num--axis { grid-template-columns: 14px minmax(24px, 1fr) 56px 12px; }
.fd__num > span { min-width: 0; overflow-wrap: anywhere; }
.fd__num input[type=number] { width: 100%; }
.fd input[type=range] { width: 100%; min-width: 0; margin: 0; padding: 0; height: 18px; accent-color: #5fd0a0; background: none; border: 0; cursor: pointer; }
.fd input[type=range]:disabled { cursor: default; }
.fd__cell { display: grid; grid-template-columns: minmax(36px, 1fr) 58px; align-items: center; gap: 6px; }
.fd__cell input[type=number] { width: 100%; }
.fd__num span:last-child { color: #9a9aa5; font-size: 12px; }
.fd__xyz { display: grid; grid-template-columns: 64px repeat(3, minmax(0, 1fr)); align-items: center; gap: 4px; }
.fd__xyz input { width: 100%; }
.fd-gizmo .fd__sliders { margin-top: -2px; }
.fd-gizmo input[type=range] { width: 100%; min-width: 0; margin: 0; padding: 0; height: 18px; accent-color: #5fd0a0; background: none; border: 0; cursor: pointer; }
.fd-gizmo input[type=range]:disabled { cursor: default; }
.fd-gizmo .fd__weight { display: grid; grid-template-columns: 34px minmax(0, 1fr) 74px; align-items: center; gap: 8px; }
.fd__xyzhead { display: grid; grid-template-columns: 64px repeat(3, minmax(0, 1fr)); gap: 4px; color: #9a9aa5; font-size: 11px; text-align: center; }
.fd__lim { display: grid; grid-template-columns: 14px 52px 52px 24px 24px minmax(0, 1fr); align-items: center; gap: 4px; }
.fd__lim input { width: 100%; }
.fd__lim button { padding: 3px 0; }
.fd__lim output { text-align: right; font-variant-numeric: tabular-nums; color: #9a9aa5; font-size: 12px; }
.fd__lim output.fd__atlimit { color: #ff7a7a; font-weight: 600; }
.fd__cols { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px 14px; }
.fd__cols > .fd__col { min-width: 0; overflow: hidden; } /* (what is too wide for its column is cut, never over the next one) */
.fd__cols .fd__row { min-width: 0; }
.fd__col[hidden] { display: none; }
.fd__col { display: grid; gap: 3px; align-content: start; }
.fd__fingers { display: grid; grid-template-columns: 92px repeat(3, minmax(0, 1fr)); gap: 3px 10px; align-items: center; }
.fd__fingers > .fd__sub { margin: 0; }
.fd__cell input { width: 100%; }
.fd__search { width: 100%; }
.fd__chips { display: flex; flex-wrap: wrap; align-content: flex-start; gap: 4px; flex: 1; min-height: 40px; overflow-y: auto; padding: 5px; border-radius: 8px; background: rgba(0, 0, 0, 0.25); }
.fd__chip {
  min-width: 26px; height: 24px; box-sizing: border-box; padding: 0 7px !important; border-radius: 6px !important; font-size: 12px !important; font-weight: 600;
}
.fd__chip--word { font-weight: 500; }
.fd__chip--current, .fd__chip--current:hover:not(:disabled) { background: #2f9e6e !important; border-color: #5fd0a0 !important; color: #fff; }
.fd__chip--hint { outline: 1px dashed #5fd0a0; }
.fd__chip--changed::after { content: ' •'; color: #ffb347; }
.fd__chip--current.fd__chip--changed::after { color: #ffe0a8; }
.fd__empty { margin: auto 2px; color: #7a7a85; font-size: 12px; }

.fd__tl { flex: none; display: flex; flex-direction: column; gap: 4px; padding: 6px 12px 8px; border-top: 1px solid rgba(255, 255, 255, 0.08); }
.fd__tltop { display: flex; align-items: flex-start; gap: 8px; }
.fd__tltop > button { flex: none; margin-top: 1px; }
.fd__tltop > .fd__tlhead { flex: 1; min-width: 0; }
.fd__tl--collapsed [data-role="tl-body"] { display: none; }
.fd--noblocks .fd__blocks, .fd--noblocks .fd__resize { display: none; }
.fd__tlhead { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; min-height: 26px; }
.fd__tlhead label { display: flex; align-items: center; gap: 5px; }
.fd__tlhead input[type=number] { width: 62px; }
.fd__time { min-width: 92px; font-variant-numeric: tabular-nums; color: #c8c8d0; }
.fd__pt { display: flex; align-items: center; gap: 4px; padding-left: 10px; border-left: 1px solid rgba(255, 255, 255, 0.12); }
.fd__pt label { gap: 3px; color: #9a9aa5; font-size: 11px; }
.fd__pt input { width: 54px !important; padding: 2px 4px !important; font-size: 12px; }
.fd__svg { display: block; width: 100%; touch-action: none; cursor: crosshair; }
.fd__svg text { font: 11px system-ui, sans-serif; fill: #9a9aa5; pointer-events: none; }
.fd__svg .fd__val { fill: #e8e8ec; font-variant-numeric: tabular-nums; }
.fd__svg circle { cursor: ns-resize; }
.fd__none { padding: 14px 4px; color: #9a9aa5; font-size: 12px; }
`;

const el = (tag, className, text) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
};
// small line icons (24 x 24, drawn in the text colour) for the gizmo's buttons
const GIZMO_ICONS = {
  rotate: 'M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5', // a circular arrow
  move: 'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3', // arrows in four directions
  local: 'M12 13L5.5 18M12 13V4M12 13l7 4M5.5 18l1-3.5M5.5 18l3.5.5M12 4l-2 3M12 4l2 3M19 17l-3.5.5M19 17l-1.5-3', // axes tilted with the bone
  world: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18M3 12h18M12 3c3.2 3 3.2 15 0 18M12 3c-3.2 3-3.2 15 0 18', // a globe
};
const gizmoIcon = (name) => {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) svg.setAttribute(k, v);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', GIZMO_ICONS[name]);
  svg.appendChild(path);
  return svg;
};
/** A button with an icon and its text (set again only when it changed: the gizmo's buttons are refreshed a lot). */
const setIconButton = (button, name, label) => {
  if (button.dataset.icon === name + label) return;
  button.dataset.icon = name + label;
  button.replaceChildren(gizmoIcon(name), el('span', '', label));
};
const input = (type, props = {}) => Object.assign(document.createElement('input'), { type }, props);
const round = (v, step) => (step >= 1 ? Math.round(v) : Math.round(v * 100) / 100);
const round3 = (v) => Math.round(v * 1000) / 1000;
const { clamp } = THREE.MathUtils;
// a point's trailing zeros are left out of the file ([0, 0] stays the shortest)
const trim = (pt) => {
  while (pt.length > 2 && pt[pt.length - 1] === 0) pt.pop();
};

/**
 * @param tweaks       the bone / shape-key tweaks (tweaks.js)
 * @param boneLimits   the rotation limits of single bones (limits.js)
 * @param fingerLimits the curl / spread / twist limits of the finger joints (limits.js; null on a rig without fingers)
 * @param letters      every sign key (letters, words, STANDBY), in the order they are listed
 * @param show         (key) => the character shows that sign right now (no smoothing, the motion held where it is)
 * @param play         (key) => start the sign over, motion playing
 * @param freeze       (fraction | null) => hold the motion at that fraction of its path, or let it play
 * @param select       (key) => show the sign everywhere (mouth, letter panel, text panel)
 * @param onStandby    (on) => whether the hands wait in the standby pose between signs
 * @param onGuards     (on) => the body and hand-to-hand guards (kept out of the body and out of each other) switched on / off; they start on
 * @param onColliders  (on) => the collision shapes (body, hand capsules) shown / hidden; `collidersOn` is how they start
 * @param handOf       (side 'R' | 'L') => that hand (hands.js): its bones and the pose they are in
 * @param currentSign  () => the key the character is signing now, if any
 * @param info         () => text with the arms' current state (the wrist twist)
 * @param onLayout     (px) => height of the dock when open, 0 when closed: the scene moves up to stay above it
 */
export function createFineTuner({ scene, camera, controls, dom, tweaks, boneLimits, fingerLimits = null, letters, show, play, freeze, select, onStandby, onGuards = () => {}, onColliders = () => {}, collidersOn = false, handOf, currentSign = () => null, info = () => '', onLayout = () => {} }) {
  // The list: the standby pose first, then the letters (sõrmendid), then the words (viiped), each in alphabetical order (Estonian: Š after S,
  // Z Ž before T, Õ Ä Ö Ü after W). A sign added in the editor goes to its place in it.
  const collator = new Intl.Collator('et');
  const sortSigns = (list) => {
    const rank = (l) => (l === STANDBY ? 0 : [...l].length === 1 ? 1 : 2);
    return [...list].sort((a, b) => rank(a) - rank(b) || collator.compare(a, b));
  };
  letters = sortSigns(letters);
  const readLS = (k) => {
    try {
      return JSON.parse(localStorage.getItem(k));
    } catch {
      return null;
    }
  };
  const writeLS = (k, v) => {
    try {
      localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    } catch {}
  };

  // ---------------------------------------------------------------- working copy of the bone tweaks
  let fileState = canon(tweaks.export()); // what the server held when the page loaded
  let fileData = JSON.parse(fileState);
  const same = (a, b) => canon(a ?? null) === canon(b ?? null);
  // The working copy is kept per sign, with a fingerprint of what the server held for that sign when it was made. A sign that somebody
  // else has saved since is dropped from the working copy (it would overwrite their work); the others stay.
  const GLOBAL = '*';
  const baseOf = (k) => fingerprint(canon((k === GLOBAL ? fileData.global : fileData.keys?.[k]) ?? null));
  const working = readLS(STORAGE_KEY);
  if (working?.drafts) {
    const next = structuredClone(fileData);
    next.keys ??= {};
    for (const [k, d] of Object.entries(working.drafts)) {
      if (d.base !== baseOf(k)) {
        console.info(`Dropped the working copy of the tweaks of ${k} (it was saved by someone else since).`);
        continue;
      }
      if (k === GLOBAL) next.global = d.data ?? {};
      else if (d.data) next.keys[k] = d.data;
      else delete next.keys[k];
    }
    tweaks.load(next);
  }
  // The keyframes are only kept here (never on the server): a sign whose path has other points now than when they were made loses them.
  // The arm bones turned for a base pose ("poses", see tweaks.js) are kept in the same place.
  const savedFrames = readLS(FRAMES_KEY);
  if (savedFrames?.frames || savedFrames?.poses) {
    const frames = {};
    for (const [k, f] of Object.entries(savedFrames.frames ?? {})) {
      if (SIGNS[k]?.motion?.path.length === savedFrames.n?.[k]) frames[k] = f;
      else console.info(`Dropped the keyframes of ${k} (its path has other points now).`);
    }
    const poses = Object.fromEntries(Object.entries(savedFrames.poses ?? {}).filter(([k]) => orients.names().includes(k)));
    tweaks.load({ ...tweaks.export(), frames, poses });
  }

  // The working copy only lives in localStorage while it differs from the server's data.
  const saveTweaks = () => {
    try {
      const drafts = tweakDrafts();
      if (!Object.keys(drafts).length) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify({ drafts: Object.fromEntries(Object.entries(drafts).map(([k, data]) => [k, { base: baseOf(k), data }])) }));
    } catch {}
    saveFrames();
  };
  const saveFrames = () => {
    try {
      const { frames, poses } = tweaks.export();
      if (!Object.keys(frames).length && !Object.keys(poses).length) localStorage.removeItem(FRAMES_KEY);
      else localStorage.setItem(FRAMES_KEY, JSON.stringify({ frames, poses, n: Object.fromEntries(Object.keys(frames).map((k) => [k, SIGNS[k]?.motion?.path.length ?? 0])) }));
    } catch {}
  };
  /** What differs from the loaded data: { sign: its tweaks (null: none left), '*': the body's tweaks }. */
  const tweakDrafts = () => {
    const now = tweaks.export();
    const out = {};
    if (!same(now.global, fileData.global)) out[GLOBAL] = now.global ?? {};
    for (const k of new Set([...Object.keys(now.keys), ...Object.keys(fileData.keys ?? {})])) if (!same(now.keys[k], fileData.keys?.[k])) out[k] = now.keys[k] ?? null;
    return out;
  };
  /** Signs (and '*' for the body) whose bone tweaks differ from the files. */
  const changedTweakKeys = () => {
    const now = tweaks.export();
    const out = [];
    if (!same(now.global, fileData.global)) out.push('keha');
    for (const k of new Set([...Object.keys(now.keys), ...Object.keys(fileData.keys ?? {})])) if (!same(now.keys[k], fileData.keys?.[k])) out.push(k);
    return out;
  };

  // ---------------------------------------------------------------- working copy of the limits (same idea): single bones and finger joints
  const limitsExport = () => ({ bones: boneLimits.export(), finger: fingerLimits?.export() ?? {} });
  const limitsLoad = (d) => {
    boneLimits.load(d?.bones);
    fingerLimits?.load(d?.finger);
  };
  let limitsFileState = canon(limitsExport());
  let limitsFileData = JSON.parse(limitsFileState);
  let limitsBase = fingerprint(limitsFileState);
  const workingLimits = readLS(LIMITS_KEY);
  if (workingLimits) {
    if (workingLimits.base === limitsBase && workingLimits.data) limitsLoad(workingLimits.data);
    else console.info('Dropped a stale working copy of the limits (the limits were saved by someone else since).');
  }
  try {
    if (workingLimits?.base !== limitsBase) localStorage.removeItem(LIMITS_KEY);
  } catch {}
  const limitsChanged = () => canon(limitsExport()) !== limitsFileState;
  const saveLimits = () => {
    try {
      if (!limitsChanged()) localStorage.removeItem(LIMITS_KEY);
      else localStorage.setItem(LIMITS_KEY, JSON.stringify({ base: limitsBase, data: limitsExport() }));
    } catch {}
  };

  // the thumb poses (the thumb's three joints, per named pose) are changed here too, as a working copy until they are saved to the server
  const thumbs = createWorkingTable(handOf('R')?.thumbPoses ?? {}, 'viiper.thumbPoses', 'thumb pose');
  thumbs.restoreDrafts();

  let standbyOn = localStorage.getItem(STANDBY_KEY) !== '0';

  // ---------------------------------------------------------------- DOM
  const style = el('style');
  style.textContent = css;
  document.head.appendChild(style);

  const launch = iconButton(ICONS.gear, 'Peenhäälestus');
  launch.classList.add('fd-launch');
  const dock = el('div', 'fd');
  dock.hidden = true;
  dock.innerHTML = `
    <div class="fd__resize" title="Muuda akna kõrgust"></div>
    <div class="fd__bar">
      <span class="fd__title">Peenhäälestus</span>
      <button data-role="blocks-toggle" title="Näita / peida seadete plokid (märk, käe asend, sõrmed, luu, kopeerimine). Sama teeb topeltklõps ribal"></button>
      <span class="fd__current" data-role="current"></span>
      <span data-role="hands"></span>
      <span class="fd__status" data-role="status"></span>
      <button data-role="undo" title="Võta viimane muudatus tagasi (Ctrl+Z)">↶ Tagasi</button>
      <button data-role="redo" title="Tee tagasivõetud muudatus uuesti (Ctrl+Shift+Z või Ctrl+Y)">↷ Uuesti</button>
      <button data-role="reset-sign" title="Märgi viipe seaded (käe asend, sõrmed, liikumine) tagasi sellele, mis serveris on">Lähtesta märk</button>
      <button data-role="load-file" title="Kustutab brauseri töökoopia ja laeb seaded nii, nagu leht need serverist laadis">Lae uuesti</button>
      <button data-role="save-file" class="fd__primary" title="Salvestab muudatused serverisse (andmebaasi); nähtavad kõigile">Salvesta</button>
      <button data-role="close" title="Sulge">✕</button>
    </div>
    <div class="fd__blocks">
      <section class="fd__block" data-role="b-sign" style="width: 260px"></section>
      <section class="fd__block" data-role="b-orient" style="width: 680px"></section>
      <section class="fd__block" data-role="b-fingers" style="width: 460px"></section>
      <section class="fd__block" data-role="b-bone" style="width: 340px"></section>
      <section class="fd__block" data-role="b-copy" style="width: 220px"></section>
    </div>
    <div class="fd__tl">
      <div class="fd__tltop">
        <button data-role="tl-toggle" title="Näita / peida liikumise ajajoon. Sama teeb topeltklõps ajajoone päisel"></button>
        <div class="fd__tlhead" data-role="tl-head"></div>
      </div>
      <div data-role="tl-body"></div>
    </div>`;
  topbar().appendChild(launch);
  document.body.appendChild(dock);
  const $ = (role) => dock.querySelector(`[data-role="${role}"]`);
  // typing in the fields must not reach the letter shortcuts
  dock.addEventListener('keydown', (e) => e.stopPropagation());
  dock.addEventListener('keyup', (e) => e.stopPropagation());
  // letting go of a slider (change) or the focus leaving it or a field (focusout) ends the gesture: the next edit is a new undo step
  dock.addEventListener('change', () => endGesture());
  dock.addEventListener('focusout', () => endGesture());

  const statusEl = $('status');
  const undoBtn = $('undo');
  const redoBtn = $('redo');
  const currentEl = $('current');
  const saveBtn = $('save-file');
  const resetSignBtn = $('reset-sign');
  const blockSign = $('b-sign');
  const blockOrient = $('b-orient');
  const blockFingers = $('b-fingers');
  const blockBone = $('b-bone');
  const blockCopy = $('b-copy');
  const tlHead = $('tl-head');
  const tlBox = dock.querySelector('.fd__tl');
  const tlToggle = $('tl-toggle');
  const blocksToggle = $('blocks-toggle');
  const tlBody = $('tl-body');
  tlBody.style.minHeight = `${TL.ruler + TL.row * CHANNELS.length + 4}px`; // the same height with or without a motion, so the blocks above don't jump

  // ---------------------------------------------------------------- state
  let isOpen = false; // the dock
  let key = null; // the sign being edited
  let hand = 'R'; // which hand's definition the middle blocks and the timeline edit
  let scrub = 0; // where on its path the motion is held while editing (0..1)
  let selPoint = 0; // the selected point of the motion path
  let playing = null; // { t0, timer } while the motion plays
  let playR = 0; // the playhead while playing
  let base = null; // the base-pose mode (basePose.js), made below
  const BLOCK_TITLES = { 'b-sign': 'Sõrmendid ja viiped', 'b-orient': 'Käe asend', 'b-fingers': 'Sõrmed', 'b-bone': 'Luu peenhäälestus', 'b-copy': 'Kopeeri teisest märgist' };
  let boneKind = readLS(UI_KEY)?.boneKind === 'skin' ? 'skin' : 'joints'; // what the bone block lists: the joints' bones, or the skin's helper bones
  const foldedBlocks = new Set((readLS(UI_KEY)?.folded ?? []).filter((r) => r in BLOCK_TITLES)); // the cards folded into a strip
  let frameMode = false; // keyframes: the bone, shape and gizmo edits go to the selected point of the path (see syncFrame)

  const sign = () => (key ? SIGNS[key] : null);
  // the named orient a hand is in when the sign names none (the standby pose has one per hand)
  const defaultDir = () => (key === STANDBY ? (hand === 'R' ? 'ready' : 'relaxed') : 'up');
  const part = () => (hand === 'R' ? sign() : sign()?.left) ?? null;
  const letterLabel = (l) => (l === STANDBY ? 'Ooteasend' : l);

  // ---------------------------------------------------------------- the status line and the buttons in the bar
  // the signs whose definition differs from the files; only the sign being edited is checked again after an edit
  const dirtySigns = new Set(defs.changedKeys());
  const recheck = (k) => (defs.isChanged(k) ? dirtySigns.add(k) : dirtySigns.delete(k));
  const recheckAll = () => {
    dirtySigns.clear();
    defs.changedKeys().forEach((k) => dirtySigns.add(k));
  };
  function updateStatus() {
    const signs = [...dirtySigns];
    const bones = changedTweakKeys();
    const parts = [];
    if (signs.length) parts.push(`viipe seaded: ${signs.join(', ')}`);
    if (bones.length) parts.push(`luud: ${bones.join(', ')}`);
    if (limitsChanged()) parts.push('luude piirid');
    if (orients.changedNames().length) parts.push(`põhiasendid: ${orients.changedNames().join(', ')}`);
    if (thumbs.changedNames().length) parts.push(`pöidla asendid: ${thumbs.changedNames().join(', ')}`);
    // (the keyframes and the bones of a base pose are not saved to the server: they only stay in this browser, so they don't count for the save button)
    const frames = tweaks.frameSigns();
    const poseBones = tweaks.poseNames();
    const local = [
      poseBones.length && `põhiasendite keha ja luud ainult selles brauseris: ${poseBones.join(', ')}`,
      frames.length && `keyframe'id ainult selles brauseris: ${frames.join(', ')}`,
    ].filter(Boolean).join(' · ');
    statusEl.textContent = parts.length ? `Salvestamata – ${[...parts, ...(local ? [local] : [])].join(' · ')}` : local || 'Salvestamata muudatusi pole.';
    statusEl.classList.toggle('fd__status--dirty', parts.length > 0);
    statusEl.title = statusEl.textContent;
    saveBtn.disabled = !parts.length;
    resetSignBtn.disabled = !key || !dirtySigns.has(key);
    delBtn.hidden = !key || !defs.isNew(key);
    refreshChips(new Set([...signs, ...bones]));
  }
  /** A sign's definition changed (or its motion): store it, show it, update the marks. `id` names a continuous gesture (see commit). */
  function changed(id) {
    stopPlay(false);
    recheck(key);
    defs.persist();
    show(key);
    freeze(scrub);
    commit(id);
    updateStatus();
  }
  function bonesChanged(id) {
    saveTweaks();
    commit(id);
    updateStatus();
  }
  function limitsEdited(id) {
    saveLimits();
    commit(id);
    updateStatus();
  }

  // ---------------------------------------------------------------- undo / redo
  // Every edit, sign definitions and bone tweaks alike, leaves a snapshot of the whole working copy (the changed signs'
  // definitions and the tweaks). Undo goes back to the sign that was edited and puts the snapshot before the edit back.
  // Edits with the same `id` in a row (a slider being dragged, a number being typed) count as one step, however long they
  // take: the gesture ends when the slider is let go or the field loses focus (see endGesture). No id: one step each.
  const HISTORY_MAX = 200;
  const snapshot = () => canon({ defs: Object.fromEntries([...dirtySigns].map((k) => [k, defs.currentDef(k)])), tweaks: tweaks.export(), limits: limitsExport(), orients: orients.exportAll(), thumbs: thumbs.exportAll() });
  const undoStack = []; // { snap, key, hand }: the state before the edit, and where it was made
  const redoStack = [];
  let last = null; // the state after the latest edit
  let lastEdit = { id: null };
  // A gizmo drag edits at the pointer's pace (up to 100 a second); the keeping of the working copy, the undo snapshot and the screen
  // are brought up to date once a frame instead (and for good when the gesture ends).
  // The keeping (the whole tweak table is compared, written to localStorage, made into an undo snapshot) is heavy, so it waits until the
  // editing pauses for a moment (a drag that goes on does not run it at all: it would hitch the dragging); the fields show the bone's
  // numbers a few times a second meanwhile.
  const SETTLE_MS = 160;
  let soon = 0; // the timer that will do it
  let soonId = null;
  let liveAt = 0; // when the fields were last brought up to date during a drag
  const flushBones = () => {
    if (!soon) return;
    clearTimeout(soon);
    soon = 0;
    bonesChanged(soonId);
    refreshBone();
  };
  const bonesChangedSoon = (id) => {
    soonId = id;
    clearTimeout(soon);
    soon = setTimeout(flushBones, SETTLE_MS);
    const t = performance.now();
    if (t - liveAt > 90) {
      liveAt = t;
      refreshBone();
    }
  };
  // the base-pose mode edits just as fast (a handle being dragged): the working copy and the undo snapshot follow once a frame
  let orientSoon = 0;
  let orientSoonId = null;
  const flushOrients = () => {
    if (!orientSoon) return;
    clearTimeout(orientSoon);
    orientSoon = 0;
    orients.persist();
    saveFrames(); // (a base pose's bone tweaks go with it)
    if (base?.boneEdit) refreshBone(); // (the bone's numbers, after a limb was put back)
    commit(orientSoonId);
    updateStatus();
  };
  /** An orient changed: show the sign with it at once; keep the rest until the editing pauses (see SETTLE_MS). */
  const orientsChangedSoon = (id) => {
    show(key);
    freeze(scrub);
    orientSoonId = id;
    clearTimeout(orientSoon);
    orientSoon = setTimeout(flushOrients, SETTLE_MS);
  };
  const endGesture = () => {
    flushBones();
    flushOrients();
    lastEdit.id = null;
  };
  function commit(id) {
    const snap = snapshot();
    if (snap === last) return;
    if (!id || id !== lastEdit.id) {
      undoStack.push({ snap: last, key, hand });
      if (undoStack.length > HISTORY_MAX) undoStack.shift();
    }
    redoStack.length = 0;
    last = snap;
    lastEdit = { id };
    syncHistory();
  }
  function syncHistory() {
    undoBtn.disabled = !undoStack.length;
    redoBtn.disabled = !redoStack.length;
  }
  /** The files now hold the working copy: older snapshots would be measured against a different baseline. */
  function clearHistory() {
    undoStack.length = 0;
    redoStack.length = 0;
    last = snapshot();
    endGesture();
    syncHistory();
  }
  function step(from, to) {
    const entry = from.pop();
    if (!entry) return;
    to.push({ snap: last, key: entry.key, hand: entry.hand });
    const s = JSON.parse(entry.snap);
    stopPlay(false);
    for (const k of new Set([...dirtySigns, ...Object.keys(s.defs)])) defs.applyDef(k, s.defs[k] ?? defs.baselineDef(k));
    tweaks.load(s.tweaks);
    limitsLoad(s.limits);
    orients.loadAll(s.orients);
    thumbs.loadAll(s.thumbs);
    recheckAll();
    defs.persist();
    orients.persist();
    thumbs.persist();
    saveTweaks();
    saveLimits();
    last = entry.snap;
    endGesture();
    if (entry.key && entry.key !== key) pick(entry.key); // show what is being undone
    hand = entry.hand === 'L' && !sign()?.left ? 'R' : entry.hand;
    renderHand();
    refreshBone();
    show(key);
    freeze(scrub);
    updateStatus();
    syncHistory();
  }
  const undo = () => step(undoStack, redoStack);
  const redo = () => step(redoStack, undoStack);
  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);
  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y anywhere while the dock is open, except in the search field (its own text undo)
  window.addEventListener(
    'keydown',
    (e) => {
      if (!isOpen || !(e.ctrlKey || e.metaKey) || e.altKey || e.target.type === 'search') return;
      const k = e.key.toLowerCase();
      if (k !== 'z' && k !== 'y') return;
      e.preventDefault();
      e.stopPropagation();
      (k === 'y' || e.shiftKey ? redo : undo)();
    },
    true,
  );

  // ---------------------------------------------------------------- block: sign
  const search = input('search', { placeholder: 'Otsi sõrmendit või viipet…', className: 'fd__search', autocomplete: 'off', spellcheck: false });
  const chipBox = el('div', 'fd__chips');
  const chips = new Map(); // key -> button
  const folded = letters.map((l) => [l, fold(letterLabel(l))]);
  const noMatch = el('div', 'fd__empty', 'Midagi ei leitud');
  noMatch.hidden = true;
  const makeChip = (l) => {
    const b = el('button', `fd__chip${l.length > 1 && l !== STANDBY ? ' fd__chip--word' : ''}`, letterLabel(l));
    b.addEventListener('click', () => pick(l));
    chips.set(l, b);
    chipBox.insertBefore(b, noMatch);
  };
  chipBox.appendChild(noMatch);
  letters.forEach(makeChip);
  let hint = null; // the chip Enter picks

  function filterChips() {
    const q = fold(search.value.trim());
    let first = null;
    let prefix = null;
    for (const [l, f] of folded) {
      // letters match by their start, words anywhere
      const hit = !q || (l.length === 1 ? f.startsWith(q) : f.includes(q));
      chips.get(l).hidden = !hit;
      if (hit && !first) first = l;
      if (hit && !prefix && f.startsWith(q)) prefix = l;
    }
    first = prefix ?? first;
    noMatch.hidden = !!first;
    hint = q ? first : null;
    refreshChips();
  }
  function refreshChips(changedSigns = new Set([...dirtySigns, ...changedTweakKeys()])) {
    for (const [l, b] of chips) {
      b.classList.toggle('fd__chip--current', l === key);
      b.classList.toggle('fd__chip--hint', l === hint && l !== key);
      b.classList.toggle('fd__chip--changed', changedSigns.has(l));
    }
  }
  search.addEventListener('input', filterChips);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && hint) {
      pick(hint);
      search.select();
    } else if (e.key === 'Escape') {
      search.value = '';
      filterChips();
    }
  });

  // the hand the middle blocks and the timeline edit: in the bar, so it is at hand with the blocks folded away too
  const handTabs = el('div', 'fd__buttons fd__handtabs');
  const tabR = el('button', '', 'Parem käsi');
  const tabL = el('button', '', 'Vasak käsi');
  tabR.title = 'Käe asend, sõrmed ja liikumine: parem käsi';
  tabL.title = 'Käe asend, sõrmed ja liikumine: vasak käsi';
  handTabs.append(tabR, tabL);
  $('hands').replaceWith(handTabs);
  tabR.addEventListener('click', () => setHand('R'));
  tabL.addEventListener('click', () => setHand('L'));
  const standbyBox = input('checkbox', { checked: standbyOn });
  const standbyRow = el('label', 'fd__row');
  standbyRow.append(el('span', '', 'Ooteasend tähtede vahel'), standbyBox);
  standbyBox.addEventListener('change', () => {
    writeLS(STANDBY_KEY, standbyBox.checked ? '1' : '0');
    onStandby(standbyBox.checked);
  });
  // the collision guards keep the arms out of the body and out of each other; off, a bone can be posed freely (not remembered: they start on)
  const guardsBox = input('checkbox', { checked: true });
  guardsBox.title = 'Välja lülitatuna ei hoia kaitse käsi kehast, käsi teineteisest ega sõrmi ja pöialt teineteisest eemal';
  const guardsRow = el('label', 'fd__row');
  guardsRow.append(el('span', '', 'Kokkupõrke kaitse (keha, käed, sõrmed)'), guardsBox);
  guardsBox.addEventListener('change', () => onGuards(guardsBox.checked));
  const collidersBox = input('checkbox', { checked: collidersOn });
  collidersBox.title = 'Joonistab keha ja käte kolliderid; punane on teise sees (sama mis ?colliders=1)';
  const collidersRow = el('label', 'fd__row');
  collidersRow.append(el('span', '', 'Näita kolliderid'), collidersBox);
  collidersBox.addEventListener('change', () => onColliders(collidersBox.checked));
  // a new word sign: its name is what gets typed to show it; it starts as a flat hand, or as a copy of the sign being edited
  const newName = input('text', { placeholder: 'Üks täht (sõrmend, nt Å) või viipe nimi (nt KASS)…', className: 'fd__search', maxLength: 40, autocomplete: 'off', spellcheck: false });
  const newCopy = input('checkbox', { checked: false });
  const newBtn = el('button', '', '＋ Lisa sõrmend või viip');
  const delBtn = el('button', '', 'Kustuta see uus');
  delBtn.title = 'Eemaldab märgi, mida pole veel faili salvestatud';
  delBtn.hidden = true;
  const newNote = el('div', 'fd__note');
  const newCopyRow = el('label', 'fd__row');
  newCopyRow.append(el('span', '', 'Alusta valitud märgi koopiast'), newCopy);
  blockSign.append(el('div', 'fd__h', 'Sõrmendid ja viiped'), search, chipBox, standbyRow, guardsRow, collidersRow, el('div', 'fd__sub', 'Uus sõrmend või viip'), newName, newCopyRow, newBtn, delBtn, newNote);

  function createSign() {
    const name = defs.normalizeName(newName.value);
    const problem = defs.checkName(name);
    newNote.classList.toggle('fd__warn', !!problem); // (a refused name is shown in orange, it was easy to miss)
    if (problem) return void (newNote.textContent = problem);
    const from = newCopy.checked && key && key !== STANDBY ? key : null;
    defs.addSign(name, from ? defs.currentDef(from) : undefined);
    if (from) {
      tweaks.copy(from, name, items.map((x) => x.name)); // its bone tweaks come along
      tweaks.copyFrames(from, name); // ... and its keyframes (the path is the same)
    }
    letters.splice(0, letters.length, ...sortSigns([...letters, name])); // (to its place in the list)
    folded.splice(0, folded.length, ...letters.map((l) => [l, fold(letterLabel(l))]));
    makeChip(name);
    for (const l of letters) chipBox.insertBefore(chips.get(l), noMatch);
    const copyWas = copyFrom.value;
    copyFrom.replaceChildren(...letters.map((l) => new Option(letterLabel(l), l)));
    copyFrom.value = copyWas;
    newName.value = '';
    search.value = '';
    saveTweaks();
    defs.persist();
    filterChips();
    pick(name);
    recheckAll();
    clearHistory(); // the older steps know nothing of this sign
    updateStatus();
    newNote.textContent = `${isLetterName(name) ? 'Sõrmend' : 'Viip'} ${name} lisatud${from ? ` (${letterLabel(from)} koopiana)` : ''}. Määra selle käe asend, sõrmed ja liikumine; Salvesta lisab selle serverisse (nähtav kõigile).`;
  }
  function deleteSign() {
    const gone = key;
    if (!gone || !defs.isNew(gone)) return;
    if (!confirm(`Kustutan märgi ${gone}? Seda pole veel failis, nii et see läheb päriselt kaduma.`)) return;
    const next = letters.find((l) => l !== gone && l !== STANDBY);
    pick(next); // away from it first
    tweaks.reset(gone, items.map((x) => x.name));
    tweaks.dropFrames(gone);
    defs.removeSign(gone);
    letters.splice(letters.indexOf(gone), 1);
    folded.splice(folded.findIndex(([l]) => l === gone), 1);
    chips.get(gone)?.remove();
    chips.delete(gone);
    copyFrom.querySelector(`option[value="${CSS.escape(gone)}"]`)?.remove();
    saveTweaks();
    defs.persist();
    recheckAll();
    filterChips();
    clearHistory();
    updateStatus();
    newNote.textContent = `${isLetterName(gone) ? 'Sõrmend' : 'Viip'} ${gone} kustutatud.`;
  }
  newBtn.addEventListener('click', createSign);
  delBtn.addEventListener('click', deleteSign);
  newName.addEventListener('keydown', (e) => e.key === 'Enter' && createSign());

  function setHand(next) {
    hand = next;
    renderHand();
  }

  // ---------------------------------------------------------------- building blocks for the number fields
  /**
   * A number field for `get()`; typing (or the arrows) calls `set` with the value kept within min..max and rounded to 3 decimals.
   * The field's text is left alone while it is being typed in and tidied up when it loses focus.
   */
  const numberField = ({ min, max, step, value }) => {
    const field = input('number', { min, max, step, value: round3(value) });
    const clamped = () => clamp(Math.round(+field.value * 1000) / 1000, min ?? -Infinity, max ?? Infinity);
    field.addEventListener('change', () => {
      if (field.value !== '' && Number.isFinite(+field.value)) field.value = clamped();
    });
    return { field, read: () => (field.value === '' || !Number.isFinite(+field.value) ? null : clamped()) };
  };
  /**
   * A slider for a number field, over the field's own range: dragging it types the value into the field (whose own listeners do the
   * rest, so a slider and a typed number are the same edit) and typing moves the slider.
   */
  const linkSlider = (field, min, max, step, title) => {
    const slider = input('range', { min, max, step, value: field.value === '' ? 0 : field.value });
    slider.title = title;
    slider.addEventListener('input', () => {
      field.value = round3(+slider.value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    field.addEventListener('input', () => {
      if (field.value !== '' && Number.isFinite(+field.value) && document.activeElement !== slider) slider.value = field.value;
    });
    return slider;
  };
  let fieldSeq = 0; // each field's own undo gesture id
  function numRow(parent, label, min, max, step, get, set, unit = '', axis = false) {
    const row = el('label', `fd__num${axis ? ' fd__num--axis' : ''}`);
    const { field, read } = numberField({ min, max, step, value: get() });
    const id = `field${++fieldSeq}`;
    field.addEventListener('input', () => {
      const v = read();
      if (v === null) return;
      set(v);
      changed(id);
    });
    row.append(el('span', '', label), linkSlider(field, min, max, step, label), field, el('span', '', unit));
    parent.appendChild(row);
  }

  const effective = (field) => {
    const p = part();
    return p.orient?.[field] ?? ORIENT[p.dir ?? defaultDir()]?.[field] ?? (field === 'pole' ? HAND_CONFIG.pole : [0, 0, 0]);
  };
  const setOrient = (field, value) => {
    const p = part();
    p.orient = { ...p.orient, [field]: value };
  };
  function vector(parent, label, field, min, max, step) {
    parent.appendChild(el('div', 'fd__sub', label));
    AXES.forEach((axis, i) =>
      numRow(parent, axis.toUpperCase(), min, max, step, () => effective(field)[i], (v) => {
        const next = [...effective(field)];
        next[i] = v;
        setOrient(field, next);
      }, '', true),
    );
  }

  // ---------------------------------------------------------------- block: the hand's pose (orient)
  const twistEl = el('div', 'fd__note');
  function fillOrient() {
    blockOrient.replaceChildren(el('div', 'fd__h', `Käe asend${key ? ` – ${hand === 'R' ? 'parem' : 'vasak'} käsi` : ''}`));
    const p = part();
    if (!p) {
      blockOrient.append(...noPartNote(true), twistEl);
      return;
    }
    if (!Array.isArray(p.curl)) {
      // (without finger data the hand is not posed by the sign at all, so its orient would do nothing)
      blockOrient.append(...fingerDataNote(), twistEl);
      return;
    }
    const dirSel = document.createElement('select');
    for (const name of Object.keys(ORIENT)) dirSel.add(new Option(orientLabel(name), name));
    dirSel.value = p.dir ?? defaultDir();
    dirSel.addEventListener('change', () => {
      dirSel.blur();
      p.dir = dirSel.value;
      delete p.orient; // the sign's own changes belonged to the old orient
      renderHand();
      changed();
    });
    const dirRow = el('label', 'fd__row');
    dirRow.append(el('span', '', 'Põhiasend'), dirSel);
    const note = el('div', 'fd__note', ORIENT[p.dir ?? defaultDir()]?.note ?? '');
    const cols = el('div', 'fd__cols');
    const colPose = el('div', 'fd__col');
    const colArm = el('div', 'fd__col');
    const colHand = el('div', 'fd__col');
    colPose.append(dirRow, note);
    numRow(colPose, 'Randme painutus', 20, 120, 1, () => p.orient?.maxBend ?? ORIENT[p.dir ?? defaultDir()]?.maxBend ?? HAND_CONFIG.maxWristBend, (v) => setOrient('maxBend', v), '°');
    const own = el('div', 'fd__note', p.orient ? 'Selle viipe oma muudatused põhiasendis: ' + Object.keys(p.orient).join(', ') : 'Põhiasendit pole selle viipe jaoks muudetud.');
    const undo = el('button', '', 'Lähtesta põhiasendile');
    undo.disabled = !p.orient;
    undo.addEventListener('click', () => {
      delete p.orient;
      renderHand();
      changed();
    });
    colPose.append(own, undo);
    // the base pose itself (for every sign that uses it) is edited in a mode of its own
    const baseOpen = base?.active && base.name === (p.dir ?? defaultDir());
    const baseBtn = el('button', baseOpen ? 'fd__on' : '', baseOpen ? 'Põhiasendi režiim ✓ (sulge)' : `Muuda põhiasendit „${p.dir ?? defaultDir()}“…`);
    baseBtn.title = 'Muudab põhiasendit ennast, kõigile märkidele, mis seda kasutavad (mitte ainult selle viipe oma muudatusi): käepidemed ekraanil. „Salvesta“ viib muudatuse serverisse (nähtav kõigile)';
    baseBtn.addEventListener('click', () => {
      if (baseOpen) base.close();
      else openBasePose(p.dir ?? defaultDir());
    });
    colPose.append(baseBtn);
    vector(colArm, 'Randme asukoht (õlast, käe pikkustes)', 'reach', -1, 1, 0.01);
    vector(colArm, 'Küünarnuki suund', 'pole', -1, 1, 0.05);
    vector(colHand, 'Sõrmede suund', 'finger', -1, 1, 0.05);
    vector(colHand, 'Pöidla suund', 'thumb', -1, 1, 0.05);
    cols.append(colPose, colArm, colHand);
    blockOrient.append(cols);
    // a one-handed sign has no hand tabs: the left hand is added here (the standby pose has its tabs always)
    if (hand === 'R' && !sign().left && key !== STANDBY) blockOrient.append(addLeftBtn());
    blockOrient.append(twistEl);
  }

  /** A button that lets the left hand take part in the sign (a mirror image of the right one) and shows it. */
  function addLeftBtn() {
    const add = el('button', '', 'Lisa vasak käsi (parema peegelpilt)');
    add.addEventListener('click', () => {
      const s = sign();
      const { curl, thumb, dir, orient, spread, knuckle } = s;
      const zero = (a) => Array.isArray(a) && a.every((x) => x === 0);
      s.left = structuredClone(Object.fromEntries(Object.entries({ curl, thumb, dir, orient, spread, knuckle }).filter(([f, v]) => v !== undefined && !(zero(v) && (f === 'spread' || f === 'knuckle')))));
      if (key === STANDBY) {
        // the left hand waits relaxed at the side, not raised like the right
        s.left.dir = 'relaxed';
        delete s.left.orient;
      }
      hand = 'L'; // (the hand tabs show up now, on the new hand)
      renderHand();
      changed();
    });
    return add;
  }

  // what the hand blocks say when there is nothing to edit: standby, no sign, or the left hand not taking part
  function noPartNote(withAction) {
    if (!key) return [el('div', 'fd__note', 'Vali märk.')];
    if (hand === 'L' && !sign().left) {
      const add = addLeftBtn();
      const text = key === STANDBY ? 'Vasak käsi ootab oma nimelises asendis (relaxed), parema käe sõrmeandmetega. Lisa vasaku käe enda andmed, kui tahad neid muuta.' : 'Vasak käsi ei osale selles viipes: ta jääb ooteasendisse.';
      return [el('div', 'fd__note', text), ...(withAction ? [add] : [])];
    }
    return [];
  }

  // a hand whose sign has no finger data: only the bone tweaks pose it. Giving it finger data hands the pose over to the sign
  // without changing how the hand looks.
  function fingerDataNote() {
    const p = part();
    const add = el('button', '', 'Määra sõrmeandmed');
    add.addEventListener('click', () => {
      // Keep the pose: the sign's data are read from the bones as they are now (wrist, elbow, finger curls), and what those
      // can't say stays in the bone tweaks as the difference between the sign's own pose and the one shown now.
      const h = handOf(hand);
      // In the standby sign the left hand without a pose of its own copies the right hand's finger data (relaxed at the side), so
      // it changes with this button too: its bones are kept as they are as well.
      const followers = key === STANDBY && hand === 'R' && !sign().left ? ['L'] : [];
      const sides = [hand, ...followers];
      const target = new Map(sides.flatMap((side) => handOf(side).boneList.map((b) => [b, b.quaternion.clone()])));
      const read = h.readPose();
      p.thumb ??= 'rest';
      p.dir ??= defaultDir();
      p.curl = read.curl;
      if (read.spread.some((v) => v)) p.spread = read.spread;
      if (read.knuckle.some((v) => v)) p.knuckle = read.knuckle;
      p.orient = { ...read.orient };
      const named = ORIENT[p.dir]?.maxBend ?? HAND_CONFIG.maxWristBend;
      if (read.bend > named) p.orient.maxBend = Math.min(Math.ceil(read.bend) + 1, 120);
      const act = `finger-data:${key}:${hand}`; // the definition and the tweaks below are one step
      changed(act); // shows the sign: the bones are now in its own pose, without tweaks
      let moved = 0;
      for (const e of tweaks.bones) {
        const was = target.get(e.bone);
        if (!was || !sides.some((side) => e.group === (side === 'R' ? 'right' : 'left'))) continue;
        const d = e.bone.quaternion.clone().invert().multiply(was);
        const eul = new THREE.Euler().setFromQuaternion(d, 'XYZ');
        const rot = [eul.x, eul.y, eul.z].map((r) => Math.round(THREE.MathUtils.radToDeg(r) * 10) / 10);
        const k = tweaks.keyOf(e.name, key);
        tweaks.set(k, e.name, { rot, pos: tweaks.get(k, e.name).pos });
        if (rot.some((r) => r !== 0)) moved++;
      }
      copyNote.textContent = `Käe asend ja sõrmed võeti praegusest poosist${moved ? `; ${moved} luu erinevus jäi luude seadetesse` : ''}.`;
      bonesChanged(act);
      refreshBone();
      renderHand();
    });
    return [
      el('div', 'fd__note', 'Selle käe asendit ja sõrmi ei määra andmed: need on ainult luude peenhäälestuse järgi. „Määra sõrmeandmed“ võtab käe praeguse asendi märgi andmeteks (poos ei muutu), et seda siin edasi muuta.'),
      add,
    ];
  }

  // ---------------------------------------------------------------- block: the fingers
  function fillFingers() {
    blockFingers.replaceChildren(el('div', 'fd__h', 'Sõrmed'));
    const p = part();
    if (!p) {
      blockFingers.append(...noPartNote(false));
      return;
    }
    if (!Array.isArray(p.curl)) {
      blockFingers.append(...fingerDataNote());
      return;
    }
    const thumbSel = document.createElement('select');
    for (const name of Object.keys(THUMB_POSES)) thumbSel.add(new Option(thumbLabel(name), name));
    thumbSel.value = p.thumb ?? 'rest';
    thumbSel.addEventListener('change', () => {
      thumbSel.blur();
      p.thumb = thumbSel.value;
      renderHand(); // (the editor below shows the pose now chosen)
      changed();
    });
    const thumbRow = el('label', 'fd__row');
    thumbRow.append(el('span', '', 'Pöidla asend'), thumbSel);
    const arrays = [['curl', 'Painutus (0 sirge … 1 rusikas)', 0, 1, 0.01], ['spread', 'Laialiminek (rad)', -0.5, 0.5, 0.01], ['knuckle', 'Sõrmealus (rad)', -0.3, 1.5, 0.01]];
    const grid = el('div', 'fd__fingers');
    grid.appendChild(el('span'));
    for (const [, label] of arrays) grid.appendChild(el('div', 'fd__sub', label.split(' (')[0]));
    FINGERS.forEach((name, i) => {
      grid.appendChild(el('span', '', name));
      for (const [field, label, min, max, step] of arrays) {
        const cell = el('label', 'fd__cell');
        cell.title = `${name}: ${label}`;
        const { field: box, read } = numberField({ min, max, step, value: p[field]?.[i] ?? 0 });
        box.addEventListener('input', () => {
          const v = read();
          if (v === null) return;
          p[field] ??= [0, 0, 0, 0];
          p[field][i] = v;
          changed(`${field}${i}:${key}:${hand}`);
        });
        cell.append(linkSlider(box, min, max, step, `${name}: ${label}`), box);
        grid.appendChild(cell);
      }
    });
    blockFingers.append(thumbRow, thumbEditor(p.thumb ?? 'rest'), grid);
  }

  // ---- the thumb poses: the three joints' rotations (Euler XYZ, radians) of the named pose, for every sign that uses it
  let thumbEditorOpen = false;
  function thumbChanged(id) {
    stopPlay(false);
    thumbs.persist();
    show(key);
    freeze(scrub);
    commit(id);
    updateStatus();
  }
  function thumbEditor(name) {
    const box = el('details');
    box.open = thumbEditorOpen;
    box.addEventListener('toggle', () => (thumbEditorOpen = box.open));
    box.append(el('summary', 'fd__sub', `Muuda pöidla asendit „${name}“`));
    const entry = thumbs.get(name);
    if (!entry.joints) {
      box.append(el('div', 'fd__note', 'Selle mudeli pöidla asendeid ei saa siin muuta.'));
      return box;
    }
    const JOINTS = ['Tüvi', 'Keskmine', 'Ots'];
    const grid = el('div', 'fd__fingers');
    grid.appendChild(el('span'));
    for (const a of AXES) grid.appendChild(el('div', 'fd__sub', a.toUpperCase()));
    JOINTS.forEach((joint, j) => {
      grid.appendChild(el('span', '', joint));
      AXES.forEach((axis, k) => {
        const cell = el('label', 'fd__cell');
        cell.title = `Pöidla liiges ${j + 1} (${joint.toLowerCase()}), pööre ümber ${axis.toUpperCase()} (radiaanid)`;
        const { field, read } = numberField({ min: -3, max: 3, step: 0.01, value: entry.joints[j]?.[k] ?? 0 });
        field.addEventListener('input', () => {
          const v = read();
          if (v === null) return;
          const next = thumbs.get(name);
          next.joints[j][k] = v;
          thumbs.set(name, next);
          thumbChanged(`thumb:${name}:${j}${k}`);
        });
        cell.append(linkSlider(field, -3, 3, 0.01, cell.title), field);
        grid.appendChild(cell);
      });
    });
    const users = Object.values(SIGNS).reduce((n, s) => n + (s.thumb === name) + (s.left?.thumb === name), 0);
    const reset = el('button', '', 'Lähtesta algandmetele');
    reset.disabled = !thumbs.isChanged(name);
    reset.addEventListener('click', () => {
      endGesture();
      thumbs.reset(name);
      thumbChanged(`thumb:${name}:reset`);
      endGesture();
      renderHand();
    });
    box.append(
      grid,
      el('div', 'fd__note', `Kehtib kõigile märkidele, mis seda pöidla asendit kasutavad (${users}). „Salvesta“ viib selle serverisse (nähtav kõigile).`),
      reset,
    );
    return box;
  }

  // ---------------------------------------------------------------- the order of the cards
  const blocksBox = dock.querySelector('.fd__blocks');
  const cardOrder = () => [...blocksBox.children].map((c) => c.dataset.role).filter(Boolean);
  {
    // the saved order first (a card the list doesn't know stays where it is, after them)
    const saved = readLS(UI_KEY)?.order;
    if (Array.isArray(saved)) for (const role of saved.filter((r) => r in BLOCK_TITLES)) blocksBox.appendChild($(role));
    const rest = Object.keys(BLOCK_TITLES).filter((r) => !saved?.includes(r));
    for (const role of rest) blocksBox.appendChild($(role));
  }
  /** Move `block` along the row with the pointer (the cards before / after it make way); a short press that moves nowhere is a click. */
  function startMove(block, down) {
    const x0 = down.clientX;
    let moving = false;
    const onMove = (e) => {
      if (!moving) {
        if (Math.abs(e.clientX - x0) < 6) return;
        moving = true;
        block.classList.add('fd__block--moving');
        getSelection()?.removeAllRanges();
      }
      // the card the pointer is over (not itself): in front of it when the pointer is on its left half, behind it on its right half
      for (const other of blocksBox.children) {
        if (other === block) continue;
        const r = other.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right) continue;
        const ref = e.clientX < r.left + r.width / 2 ? other : other.nextElementSibling;
        if (ref !== block && block.nextElementSibling !== ref) blocksBox.insertBefore(block, ref); // (else it is there already)
        break;
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      block.classList.remove('fd__block--moving');
      if (moving) saveUi();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  // ---------------------------------------------------------------- folding the cards sideways
  // (the hand blocks are rebuilt now and then and lose their fold button: renderHand puts it back)
  function ensureFolds() {
    for (const [role, title] of Object.entries(BLOCK_TITLES)) {
      const block = $(role);
      const folded = foldedBlocks.has(role);
      const flip = () => {
        if (foldedBlocks.has(role)) foldedBlocks.delete(role);
        else foldedBlocks.add(role);
        ensureFolds();
        saveUi();
      };
      block.dataset.title = title;
      block.classList.toggle('fd__block--folded', folded);
      // a double click folds a card on its title (the card's first line), and opens a folded one anywhere on its strip
      if (!block.dataset.foldDbl) {
        block.dataset.foldDbl = '1';
        block.addEventListener('dblclick', (e) => {
          if (e.target.closest('button, input, select, label, output')) return;
          if (block.classList.contains('fd__block--folded') || e.target.closest('.fd__h')) {
            getSelection()?.removeAllRanges(); // (the double click selects the word under it)
            flip();
          }
        });
      }
      // dragging the card by its title (or anywhere on a folded strip) puts it elsewhere in the row
      if (!block.dataset.moveInit) {
        block.dataset.moveInit = '1';
        block.addEventListener('pointerdown', (e) => {
          if (e.button !== 0 || e.target.closest('button, input, select, label, output')) return;
          if (block.classList.contains('fd__block--folded') || e.target.closest('.fd__h')) startMove(block, e);
        });
      }
      block.querySelector(':scope > .fd__h')?.setAttribute('title', 'Lohista, et kaarti vahetada; topeltklõps voldib kaardi kokku');
      let fold = block.querySelector(':scope > .fd__fold');
      if (!fold) {
        fold = el('div', 'fd__fold');
        const b = el('button');
        b.addEventListener('click', flip);
        fold.appendChild(b);
        block.prepend(fold);
      }
      fold.firstChild.textContent = folded ? '▸' : '◂';
      fold.firstChild.title = folded ? `Näita kaarti „${title}“` : `Voldi kaart „${title}“ kitsaks ribaks`;
    }
  }

  // ---------------------------------------------------------------- the hand blocks and the timeline together
  function renderHand() {
    base?.refresh();
    tabR.classList.toggle('fd__on', hand === 'R');
    tabL.classList.toggle('fd__on', hand === 'L');
    tabL.disabled = !sign();
    tabR.disabled = !sign();
    // only a sign the left hand takes part in (and the standby pose) has hand tabs; any other has just the right hand
    handTabs.hidden = !sign() || !(sign().left || key === STANDBY);
    fillOrient();
    fillFingers();
    buildTimeline();
    // a left-hand part can be dropped again (in the orient block, below everything else)
    if (hand === 'L' && sign()?.left) {
      const remove = el('button', '', 'Eemalda vasak käsi (jääb ooteasendisse)');
      remove.addEventListener('click', () => {
        delete sign().left;
        hand = 'R';
        renderHand();
        changed();
      });
      blockOrient.appendChild(remove);
    }
    ensureFolds();
  }

  // ---------------------------------------------------------------- block: a single bone (markers and lines in the scene)
  const items = [...tweaks.bones, ...tweaks.shapes]; // bones first, so a bone's index is the same in both
  const bones = tweaks.bones;
  const groupSel = document.createElement('select');
  const boneSel = document.createElement('select');
  const focusBtn = el('button', '', 'Fookus');
  focusBtn.title = 'Too kaamera valitud luu juurde';
  const mirrorBox = input('checkbox', { checked: true });
  const linesBox = input('checkbox', { checked: true });
  const boneLabel = el('div', 'fd__note');
  // what the list and the markers show: the joints (the bones that pose the body) or the skin (the helper bones that only shape the skin at
  // one spot: the elbow's share bone, the twist bones; turning one does not turn a limb, it tunes the skin there)
  const jointsKindBtn = el('button', '', 'Liigesed');
  const skinKindBtn = el('button', '', 'Nahk');
  jointsKindBtn.title = 'Liigeste luud: need liigutavad keha, käsi ja sõrmi';
  skinKindBtn.title = 'Naha abiluud (nt küünarnuki ShareBone, Twist-luud): need ei liiguta jäset, vaid timmivad nahka selles kohas';
  jointsKindBtn.addEventListener('click', () => setBoneKind('joints'));
  skinKindBtn.addEventListener('click', () => setBoneKind('skin'));
  const bodyBtn = el('button', '', 'Keha');
  const faceBtn = el('button', '', 'Nägu');
  bodyBtn.title = 'Kogu luustik: käed, sõrmed, keha, nägu (luude markerid ja gizmo)';
  faceBtn.title = 'Näo vormid (liugurid); kui mudelil vorme pole, näo luud';
  const boneTitle = el('span', '', 'Luu');
  // the gizmo's mode and space, and the tweak's numbers: rotation (degrees) and position offset (millimetres) per axis, or a shape key's weight
  const modeRotBtn = el('button', 'fd__ibtn');
  const modeMoveBtn = el('button', 'fd__ibtn');
  const spaceBtn = el('button', 'fd__ibtn');
  setIconButton(modeRotBtn, 'rotate', 'Pööra');
  setIconButton(modeMoveBtn, 'move', 'Liiguta');
  setIconButton(spaceBtn, 'local', 'Luu telgedes');
  modeRotBtn.title = 'Gizmo pöörab luud (hiirega rõnga otsast)';
  modeMoveBtn.title = 'Gizmo liigutab luud (hiirega noole otsast); nihe salvestatakse millimeetrites';
  const gizmoRow = el('div', 'fd__buttons');
  gizmoRow.append(modeRotBtn, modeMoveBtn, spaceBtn);
  const xyzRow = (label, step, title) => {
    const row = el('label', 'fd__xyz');
    row.title = title;
    const fields = AXES.map((axis) => {
      const f = numberField({ step, value: 0 });
      f.field.title = `${label} ${axis.toUpperCase()}`;
      return f;
    });
    row.append(el('span', '', label), ...fields.map((f) => f.field));
    return { row, fields };
  };
  const rotRow = xyzRow('Pööre °', 0.1, 'Luu pööre puhkeasendi peal, kraadides (Euler XYZ, luu enda telgedes)');
  const posRow = xyzRow('Nihe mm', 0.1,'Luu nihe millimeetrites mudeli teljestikus (+X = tegelase vasak, +Y üles, +Z ette)');
  const weightRow = el('label', 'fd__weight');
  const weight = numberField({ min: -1, max: 1, step: 0.01, value: 0 });
  // A slider for a number field, as another way to set the same number: dragging it types the value into the field (the field's own
  // listeners do the rest), and the field's value is shown on it. The slider's range is `span` either side of 0, widened (in steps of
  // `span`) when the field holds more, so a big value is not pulled back to the end of the slider by touching it.
  const sliders = new Map();
  const addSlider = (field, span, step, title) => {
    const slider = input('range', { min: -span, max: span, step, value: 0 });
    slider.title = title;
    slider.addEventListener('input', () => {
      field.value = round3(+slider.value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    sliders.set(field, { slider, span });
    field.addEventListener('input', () => syncSlider(field));
    return slider;
  };
  const syncSlider = (field) => {
    const s = sliders.get(field);
    if (!s || document.activeElement === s.slider) return; // (not under the thumb being dragged)
    const v = +field.value || 0;
    const range = s.span * Math.max(1, Math.ceil(Math.abs(v) / s.span));
    s.slider.min = -range;
    s.slider.max = range;
    s.slider.value = v;
    s.slider.disabled = field.disabled;
  };
  const sliderRow = (fields, span, step, title) => {
    const row = el('div', 'fd__xyz fd__sliders');
    row.append(el('span'), ...fields.map(({ field }, i) => addSlider(field, span, step, `${title} ${AXES[i].toUpperCase()}`)));
    return row;
  };
  const rotSliders = sliderRow(rotRow.fields, 45, 0.1, 'Pööre °');
  const posSliders = sliderRow(posRow.fields, 20, 0.1, 'Nihe mm');
  weightRow.append(el('span', '', 'Kaal'), addSlider(weight.field, 1, 0.01, 'Kaal'), weight.field);
  const axisHead = el('div', 'fd__xyzhead');
  axisHead.append(el('span'), ...AXES.map((a) => el('span', '', a.toUpperCase())));
  // They live in a floating panel of their own (draggable, shown while the dock is open), so they stay in reach whatever the dock shows.
  const gizmoPanel = el('div', 'panel fd-gizmo');
  gizmoPanel.hidden = true;
  const gizmoBone = el('div', 'fd__note');
  const gizmoHint = el('div', 'fd__note');
  // for a skin helper bone: a button to the joint's own bone (the elbow's helper -> the forearm, an upper arm helper -> the upper arm)
  const helperBtn = el('button', '', 'Vali liigese enda luu');
  helperBtn.hidden = true;
  helperBtn.addEventListener('click', () => {
    const e = sel();
    const side = /_([LR])_/.exec(e?.name ?? '')?.[1];
    const target = `CC_Base_${side}_${/Upperarm/i.test(e?.name) ? 'Upperarm' : 'Forearm'}`;
    const i = bones.findIndex((b) => b.name === target);
    if (i < 0) return;
    setBoneKind('joints'); // (the joint's own bone is listed with the joints)
    if (!listed(bones[i])) {
      groupSel.value = 'all';
      fillBones();
    }
    selectBone(i);
  });
  gizmoPanel.innerHTML = '<div class="panel__bar"><span class="panel__title">Luu gizmo</span><span class="panel__grip">⋮⋮</span></div>';
  const gizmoBody = el('div', 'fd-gizmo__body');
  gizmoBody.append(gizmoBone, gizmoRow, gizmoHint, helperBtn, axisHead, rotRow.row, rotSliders, posRow.row, posSliders, weightRow);
  gizmoPanel.appendChild(gizmoBody);
  document.body.appendChild(gizmoPanel);
  makeDraggable(gizmoPanel, gizmoPanel.querySelector('.panel__bar'), 'viiper.gizmoPanel', () => [Math.max(0, window.innerWidth - 346), 58]); // below the account button
  // (as in the dock: typing in the fields must not reach the letter shortcuts, and a field being let go ends the undo gesture)
  gizmoPanel.addEventListener('keydown', (e) => e.stopPropagation());
  gizmoPanel.addEventListener('keyup', (e) => e.stopPropagation());
  gizmoPanel.addEventListener('change', () => endGesture());
  gizmoPanel.addEventListener('focusout', () => endGesture());

  // ---------------------------------------------------------------- the base-pose mode (basePose.js)
  // While it is open the bone gizmo and markers are put away, and the collision guards are off (they would push the hand away from the
  // handles); they come back as they were.
  let guardsWere = true;
  let gizmoWas = null; // where the gizmo panel was before it made room for the base-pose panel
  base = createBasePose({
    scene, camera, controls, dom, tweaks, handOf,
    getKey: () => key,
    pickSign: (k) => pick(k),
    refreshHands: () => {
      if (!key || !isOpen) return;
      show(key);
      freeze(scrub);
    },
    onEdit: orientsChangedSoon,
    onEnd: () => endGesture(),
    onToggle: (on) => {
      if (on) {
        guardsWere = guardsBox.checked;
        guardsBox.checked = false;
        onGuards(false);
      } else {
        guardsBox.checked = guardsWere;
        onGuards(guardsWere);
      }
      markers.visible = isOpen && !on;
      gizmoPanel.hidden = !isOpen || on;
      lines.visible = hot.visible = isOpen && !on && linesBox.checked;
      refreshBone(); // (the bone gizmo goes or comes back)
      renderHand(); // (the button of the hand's block)
    },
    // the arm's bones turned for the base pose (the bone gizmo, markers and fields are back, their tweaks go to the base pose: tweaks.js)
    onBones: (on, orient, side) => {
      endGesture();
      tweaks.setEditOrient(on ? { name: orient, side } : null);
      selected = -1;
      markers.visible = isOpen && on;
      gizmoPanel.hidden = !isOpen || !on;
      // The two panels start in the same corner: with the bone tools up the gizmo panel goes beside the base-pose panel, not under it
      // (and back where it was when they are put away).
      if (on && !gizmoWas) {
        gizmoWas = { left: gizmoPanel.style.left, top: gizmoPanel.style.top };
        const bp = base.panelEl;
        gizmoPanel.style.left = `${Math.max(0, bp.offsetLeft - 330 - 12)}px`;
        gizmoPanel.style.top = `${bp.offsetTop}px`;
      } else if (!on && gizmoWas) {
        gizmoPanel.style.left = gizmoWas.left;
        gizmoPanel.style.top = gizmoWas.top;
        gizmoWas = null;
      }
      lines.visible = hot.visible = isOpen && on && linesBox.checked;
      if (on) {
        groupSel.value = side === 'R' ? 'right' : 'left';
        fillBones();
      }
      refreshBone();
    },
  });
  function openBasePose(name) {
    if (!key || !isOpen) return;
    stopPlay(false);
    base.open(name, name === 'relaxed' ? 'L' : hand); // ('relaxed' is the left hand's waiting pose; the panel has its own hand choice)
  }
  // rotation limits of the selected bone: per axis a min and a max (blank = free), buttons that take the bone's current angle
  const limitsOnBox = input('checkbox', { checked: true });
  limitsOnBox.title = 'Välja lülitatuna saab luu vabalt poosida (piirid jäävad alles)';
  const limitRow = (axis, i, max, label, title) => {
    const lo = input('number', { min: -max, max, step: 1, placeholder: 'min' });
    const hi = input('number', { min: -max, max, step: 1, placeholder: 'max' });
    const setLo = el('button', '', '⇤');
    const setHi = el('button', '', '⇥');
    setLo.title = 'Minimaalne piir = praegune nurk';
    setHi.title = 'Maksimaalne piir = praegune nurk';
    const now = el('output', '', '0°');
    const row = el('div', 'fd__lim');
    row.title = title;
    row.append(el('span', '', label), lo, hi, setLo, setHi, now);
    return { axis, i, row, lo, hi, setLo, setHi, now };
  };
  const limitRows = AXES.map((axis, i) => limitRow(axis, i, axisMax(axis), axis.toUpperCase(), 'Luu pööre ümber telje ' + axis.toUpperCase()));
  // a finger joint (mcp / pip / dip): the limits are shared by the same joint of every finger and both hands, in curl / spread / twist
  const FINGER_AXES = [['curl', 'P', 'Painutus (+ peopesa poole)'], ['spread', 'L', 'Laialiminek (+ väikese sõrme poole)'], ['twist', 'V', 'Väänd sõrme enda telje ümber']];
  const fingerHead = el('div', 'fd__sub');
  const fingerRows = FINGER_AXES.map(([axis, label, title], i) => limitRow(axis, i, 180, label, title));
  const fingerBox = el('div', 'fd__col');
  fingerBox.hidden = true;
  fingerBox.append(fingerHead, ...fingerRows.map((r) => r.row), el('div', 'fd__note', 'P = painutus, L = laialiminek, V = väänd. Kehtib selle liigese kõigile sõrmedele, mõlemal käel.'));
  const clearLimitsBtn = el('button', '', 'Eemalda luu piirid');
  const resetBoneBtn = el('button', '', 'Luu nulli');
  const resetGroupBtn = el('button', '', 'Rühma nulli');
  const copyJsonBtn = el('button', '', 'Kopeeri JSON');
  // "to the GLB": the bone (or all bones of the group) in the pose it has in the model's file, whatever the hand's IK or the tweaks make of it;
  // "nulli" above only takes the tweak away, which leaves an arm in the pose the hand code gives it
  const restBoneBtn = el('button', '', 'Luu GLB-asendisse');
  const restGroupBtn = el('button', '', 'Rühm GLB-asendisse');
  restBoneBtn.title = 'Valitud luu (liiges) mudeli GLB-faili puhkeasendisse, sõltumata käe IK-st ja märgi seadetest. „Luu nulli“ võtab ainult muudatuse ära.';
  restGroupBtn.title = 'Kõik valitud rühma luud ja vormid mudeli GLB-faili puhkeasendisse (vormid 0)';
  {
    const row = (...kids) => {
      const r = el('label', 'fd__row');
      r.append(...kids);
      return r;
    };
    const pickRow = el('div', 'fd__row');
    const pickLabel = el('label', 'fd__row');
    pickLabel.style.flex = '1';
    pickLabel.append(boneTitle, boneSel);
    boneSel.style.flex = '1';
    boneSel.style.maxWidth = 'none';
    focusBtn.style.flex = 'none';
    pickRow.append(pickLabel, focusBtn);
    const buttons = el('div', 'fd__buttons');
    buttons.append(resetBoneBtn, resetGroupBtn, copyJsonBtn);
    const restButtons = el('div', 'fd__buttons');
    restButtons.append(restBoneBtn, restGroupBtn);
    // two buttons for what is edited most: the body (every bone) and the face (its shape keys, or the face bones where there are none)
    // the finer groups stay behind a fold
    const goTo = (id) => {
      groupSel.value = id;
      groupSel.dispatchEvent(new Event('change'));
    };
    bodyBtn.addEventListener('click', () => goTo('all'));
    faceBtn.addEventListener('click', () => goTo(tweaks.shapes.length ? 'shapes' : 'face'));
    const quick = el('div', 'fd__buttons');
    quick.append(bodyBtn, faceBtn);
    const kindRow = el('div', 'fd__buttons');
    kindRow.append(jointsKindBtn, skinKindBtn);
    const finer = el('details');
    finer.append(el('summary', 'fd__sub', 'Täpsemad rühmad'), row(el('span', '', 'Rühm'), groupSel));
    blockBone.append(
      el('div', 'fd__h', 'Luu peenhäälestus'),
      kindRow,
      quick,
      finer,
      pickRow,
      row(el('span', '', 'Peegelda vastasküljele'), mirrorBox),
      row(el('span', '', 'Näita luujooni'), linesBox),
      boneLabel,
      buttons,
      restButtons,
      el('div', 'fd__sub', 'Pöörde piirid – kõigile märkidele (° puhkeasendist)'),
      row(el('span', '', 'Piirid kehtivad'), limitsOnBox),
      ...limitRows.map((r) => r.row),
      clearLimitsBtn,
      fingerBox,
      el('div', 'fd__note', '⇤ / ⇥ võtavad piiriks luu praeguse nurga. Punane nurk: luu on piiril ja see kärbiti. Tühi väli = piiranguta.'),
    );
  }
  // the groups of tweaks.js, and two that join them: both hands at once, the whole skeleton (markers, bone list, reset and copy follow)
  const JOINED = { hands: ['right', 'left'], all: ['right', 'left', 'face', 'body'] };
  const groupOptions = [...GROUPS.filter((g) => g.id !== 'shapes' || tweaks.shapes.length), { id: 'hands', label: 'Mõlemad käed' }, { id: 'all', label: 'Kogu luustik' }];
  const inGroup = (e, id = groupSel.value) => (JOINED[id] ? JOINED[id].includes(e.group) : e.group === id);
  for (const g of groupOptions) groupSel.add(new Option(g.label, g.id));
  groupSel.value = 'all'; // the body (every bone) is what is tuned first; the face is one button away (its shape keys on a shape-key face, Character Creator)

  // markers on the bones of the chosen group
  const markerGeo = new THREE.SphereGeometry(1, 12, 8);
  const mat = (color) => new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85 });
  const idleMat = mat(0x58c4ff);
  const pickedMat = mat(0xffb347);
  const markers = new THREE.Group();
  markers.visible = false;
  bones.forEach((e, i) => {
    const m = new THREE.Mesh(markerGeo, idleMat);
    m.renderOrder = 999;
    m.userData.index = i;
    markers.add(m);
  });
  scene.add(markers);

  // skeleton lines: every bone of the group joined to its parent; the selected bone's links glow orange.
  // Fat lines (plain GL lines are 1px). The buffer is allocated once at full size and rewritten each frame.
  const lineMaterials = [];
  const makeLines = (color, width, opacity, order, capacity) => {
    const geo = new LineSegmentsGeometry();
    geo.setPositions(new Float32Array(capacity * 6));
    geo.instanceCount = 0;
    const material = new LineMaterial({ color, linewidth: width, transparent: true, opacity, depthTest: false });
    material.resolution.set(window.innerWidth, window.innerHeight);
    lineMaterials.push(material);
    const obj = new LineSegments2(geo, material);
    obj.renderOrder = order;
    obj.frustumCulled = false; // the bounding sphere is never refreshed
    obj.visible = false;
    obj.userData.capacity = capacity;
    scene.add(obj);
    return obj;
  };
  window.addEventListener('resize', () => lineMaterials.forEach((m) => m.resolution.set(window.innerWidth, window.innerHeight)));
  const lines = makeLines(0x58c4ff, 1.5, 0.7, 997, bones.length);
  const hot = makeLines(0xffb347, 3.5, 1, 998, 32);
  const pa = new THREE.Vector3();
  const pb = new THREE.Vector3();
  const addSegment = (obj, n, a, b) => {
    if (n >= obj.userData.capacity) return n;
    obj.geometry.attributes.instanceStart.data.array.set([a.x, a.y, a.z, b.x, b.y, b.z], n * 6);
    return n + 1;
  };
  const flush = (obj, n) => {
    obj.geometry.attributes.instanceStart.data.needsUpdate = true;
    obj.geometry.instanceCount = n;
  };

  // The arm's twist helper bones (CC_Base_R_UpperarmTwist01 ...) only twist the skin between the joints: they turn about their own
  // long axis (Y); any other turn just crumples the skin and moves nothing, so the limits editor locks X and Z for them.
  const isTwist = (e) => !!e && !e.shape && /Twist\d*$/i.test(e.name);
  // The skin's helper bones (the arm's twist bones, CC_Base_R_ElbowShareBone ...): they only shape the skin at one spot, they are not the joint:
  // turning the elbow's helper moves the tip of the elbow, not the hand. They get no marker in the scene (the joint's own bone is
  // in the same place and easy to miss for them) and are picked from the list.
  const isHelper = (e) => !!e && !e.shape && /(Twist|Share)(Bone)?\d*$/i.test(e.name);
  /**
   * Whether the bone block lists a bone (list, markers, group buttons): "Liigesed" the joints' bones and shape keys of the chosen group,
   * "Nahk" the skin's helper bones (the elbow's share bone, the twist bones ...) of the chosen group (an arm's: those of that side).
   */
  const listed = (e) => {
    if (boneKind === 'joints') return inGroup(e) && !isHelper(e);
    if (!isHelper(e)) return false;
    const g = groupSel.value;
    if (g === 'right') return /_R_/.test(e.name);
    if (g === 'left') return /_L_/.test(e.name);
    if (g === 'hands') return /_[LR]_/.test(e.name);
    return g !== 'face' && g !== 'shapes'; // (the body, the whole skeleton)
  };
  function setBoneKind(next) {
    if (next === boneKind) return;
    boneKind = next;
    selected = -1;
    adjust.bone = null;
    fillBones();
    refreshBone();
    saveUi();
  }
  const locked = (e, axisIndex) => isTwist(e) && axisIndex !== 1;
  let selected = -1;
  const sel = () => (selected >= 0 ? items[selected] : null);
  const editKey = () => tweaks.keyOf(sel().name, key);

  const fillBones = () => {
    boneSel.replaceChildren(new Option('–', ''));
    items.forEach((e, i) => listed(e) && boneSel.add(new Option(e.name, String(i))));
  };

  /** The limit fields of the selected bone (not while a shape key is selected: it has no rotation). */
  function refreshLimits() {
    const e = sel();
    const usable = !!e && !e.shape;
    const range = (usable && boneLimits.get(e.name)) || {};
    limitRows.forEach(({ axis, lo, hi, setLo, setHi }) => {
      // an end at the full turn is the same as no limit on that side: shown blank
      const [min, max] = range[axis] ?? [];
      lo.value = min > -axisMax(axis) ? min : '';
      hi.value = max < axisMax(axis) ? max : '';
      for (const c of [lo, hi, setLo, setHi]) c.disabled = !usable || locked(e, AXES.indexOf(axis));
    });
    clearLimitsBtn.disabled = !usable || !boneLimits.get(e.name);
    const joint = usable ? fingerLimits?.jointOf(e.name) : null;
    fingerBox.hidden = !joint;
    if (joint) {
      fingerHead.textContent = 'Sõrmeliigese piirid – kõigile märkidele: ' + joint.toUpperCase();
      const fr = fingerLimits.get(joint) ?? {};
      fingerRows.forEach(({ axis, lo, hi }) => {
        const [min, max] = fr[axis] ?? [];
        lo.value = min > -180 ? min : '';
        hi.value = max < 180 ? max : '';
      });
    }
  }

  // A bone that is being turned (with the gizmo or in the fields) stops where the limits hold it: the limits clamp the final pose, so
  // when they had to turn the bone back, the tweak's rotation goes back by that much (see update).
  const adjust = { bone: null, until: 0 }; // the bone being edited, and until when (Infinity while the gizmo is held)
  const editId = (e) => `bone:${e.name}:${key}`; // one undo gesture for the gizmo, the fields and the limit correction alike

  // The gizmo (TransformControls) sits on a proxy object that follows the selected bone; what it is dragged to is turned back into
  // the bone's tweak (tweaks.tweakFor). Only while it is held does the gizmo move the proxy, the rest of the time the proxy follows the bone.
  const proxy = new THREE.Object3D();
  scene.add(proxy);
  const gizmo = new TransformControls(camera, dom);
  gizmo.setSize(0.9);
  gizmo.setMode(readLS(UI_KEY)?.gizmoMode === 'translate' ? 'translate' : 'rotate');
  gizmo.setSpace(readLS(UI_KEY)?.gizmoSpace === 'world' ? 'world' : 'local');
  gizmo.detach(); 
  scene.add(gizmo.getHelper());
  gizmo.addEventListener('dragging-changed', (ev) => {
    controls.enabled = !ev.value; // the orbit must not turn the view with it
    if (ev.value) return;
    endGesture();
    if (adjust.until === Infinity) adjust.until = performance.now() + 300;
  });
  const gizmoQ = new THREE.Quaternion();
  const gizmoP = new THREE.Vector3();
  // A press on the gizmo is a click until the pointer has gone a few pixels: a click picks the marker under the gizmo (see below),
  // so the gizmo changes nothing before that. (It works from the pointer's place, so nothing is lost by waiting.)
  const CLICK_PX = 4;
  const press = { onGizmo: false, armed: false, x: 0, y: 0, lx: 0, ly: 0 }; // where it started, and where the pointer is now
  gizmo.addEventListener('objectChange', () => {
    const e = sel();
    if (!e?.bone || !key) return;
    if (press.onGizmo && !press.armed) {
      if (Math.hypot(press.lx - press.x, press.ly - press.y) <= CLICK_PX) return;
      press.armed = true;
    }
    proxy.getWorldQuaternion(gizmoQ);
    proxy.getWorldPosition(gizmoP);
    // An arm or finger bone is not moved off its joint: moving it turns the bone it hangs on (the forearm for the wrist) about that
    // bone's own joint, so the arm stays in one piece. Other bones (face, body, the upper arm) are offset.
    const aim = gizmo.mode === 'translate' ? tweaks.aimParent(e.name, gizmoP) : null;
    if (aim) {
      const turned = bones.find((b) => b.name === aim.name);
      Object.assign(adjust, { bone: turned, until: Infinity });
      writeBone(turned, { rot: aim.rot, pos: tweaks.get(tweaks.keyOf(turned.name, key), turned.name).pos }, editId(e), eased(turned)); // (the screen follows once a frame)
      return;
    }
    const now = tweaks.get(editKey(), e.name);
    const t = tweaks.tweakFor(e.name, gizmoQ, gizmoP, now.rot); // (the turn written nearest to the numbers it has: no leaps)
    Object.assign(adjust, { bone: e, until: Infinity });
    writeBone(e, gizmo.mode === 'rotate' ? { rot: t.rot, pos: now.pos } : { rot: now.rot, pos: t.pos }, editId(e), eased(e)); // (only what the gizmo is turning changes)
  });
  /** The gizmo is shown on the selected bone while the dock is open (a shape key has nothing to turn). */
  const attachGizmo = () => {
    const e = sel();
    if (isOpen && key && e?.bone && !base?.handles) gizmo.attach(proxy);
    else if (gizmo.object) gizmo.detach();
  };
  /** How far the limits turned the selected bone back at the last frame, degrees per Euler axis (x, y, z). */
  function overflow(e) {
    const out = [...boneLimits.excess(e.name)];
    const axes = fingerLimits?.axes(e.name);
    if (axes) {
      const f = fingerLimits.excess(e.name);
      ['curl', 'spread', 'twist'].forEach((n, k) => (out[axes[n][0]] += f[k] * axes[n][1]));
    }
    return out;
  }

  const refreshBone = () => {
    const e = sel();
    const shapes = groupSel.value === 'shapes';
    const val = e && key ? tweaks.get(editKey(), e.name) : { rot: [0, 0, 0], pos: [0, 0, 0], w: 0 };
    boneTitle.textContent = shapes ? 'Vorm' : 'Luu';
    // a shape key has a single number, its weight; a bone has its rotation and position offset, and the gizmo to change them
    const usable = !!e && !!key;
    gizmoRow.hidden = axisHead.hidden = rotRow.row.hidden = posRow.row.hidden = rotSliders.hidden = posSliders.hidden = shapes;
    weightRow.hidden = !shapes;
    // (a field being typed in keeps its text until it loses focus)
    const put = (field, value) => {
      field.disabled = !usable;
      if (document.activeElement !== field) field.value = round3(value);
      syncSlider(field);
    };
    rotRow.fields.forEach(({ field }, i) => put(field, val.rot[i]));
    posRow.fields.forEach(({ field }, i) => put(field, val.pos[i]));
    // a twist helper bone turns about Y only: its other fields are locked and the gizmo shows just the Y ring
    const twist = !!e && !e.shape && isTwist(e);
    if (twist) {
      for (const { field } of [rotRow.fields[0], rotRow.fields[2], ...posRow.fields]) {
        field.disabled = true;
        syncSlider(field);
      }
    }
    gizmo.showX = gizmo.showZ = !twist;
    gizmo.showY = !twist || gizmo.mode === 'rotate';
    put(weight.field, val.w);
    jointsKindBtn.classList.toggle('fd__on', boneKind === 'joints');
    skinKindBtn.classList.toggle('fd__on', boneKind === 'skin');
    bodyBtn.classList.toggle('fd__on', groupSel.value === 'all');
    faceBtn.classList.toggle('fd__on', groupSel.value === 'shapes' || groupSel.value === 'face');
    modeRotBtn.classList.toggle('fd__on', gizmo.mode === 'rotate');
    modeMoveBtn.classList.toggle('fd__on', gizmo.mode === 'translate');
    setIconButton(spaceBtn, gizmo.space === 'local' ? 'local' : 'world', gizmo.space === 'local' ? 'Luu telgedes' : 'Maailma telgedes');
    spaceBtn.title = 'Gizmo teljed: luu enda telgedes või maailma telgedes (vahetamiseks klõpsa)';
    modeRotBtn.disabled = modeMoveBtn.disabled = spaceBtn.disabled = !usable || !e.bone;
    attachGizmo();
    refreshLimits();
    resetBoneBtn.disabled = restBoneBtn.disabled = !e || !key;
    restGroupBtn.disabled = !key;
    mirrorBox.disabled = !e?.mirrorName;
    boneSel.value = e ? String(selected) : '';
    let note = '';
    if (e && key) {
      const k = editKey();
      note = k === key ? '' : k.includes('@') ? ` (keyframe ${selPoint + 1})` : e.group === 'body' ? ' (kehtib alati)' : ' (ooteasend)';
    }
    const aimName = e?.bone && gizmo.mode === 'translate' ? tweaks.aimParentOf(e.name) : null;
    const helper = isHelper(e);
    helperBtn.hidden = !helper;
    gizmoHint.textContent = helper
      ? 'Nahk: see abiluu kujundab ainult nahka selles kohas (nt küünarnuki otsa), see ei pööra kätt ega küünarvart. Muudatus kehtib kõigile märkidele ja peegeldub teisele küljele, kui „Peegelda vastasküljele“ on sees. Käe suuna muutmiseks lülita „Liigesed“ peale ja pööra liigese enda luud (Upperarm / Forearm).'
      : aimName ? `Liigutamine pöörab luud ${aimName}, et valitud luu jääks külge. Nihke lahtrid nihutavad luud ennast.` : '';
    gizmoBone.innerHTML = e ? `<b>${e.name}</b>${frameActive() ? ` · keyframe ${selPoint + 1}` : ''}` : shapes ? 'Vali vorm' : 'Vali luu (nimekirjast või markerilt)';
    boneLabel.innerHTML = e ? `Valitud: <b>${e.name}</b>${note}` : shapes ? 'Vali vorm nimekirjast' : boneKind === 'skin' ? 'Vali naha abiluu nimekirjast või klõpsa markeril' : 'Vali luu nimekirjast või klõpsa markeril';
    markers.children.forEach((m, i) => {
      m.material = i === selected ? pickedMat : idleMat;
      m.visible = listed(bones[i]); // (the joints' bones or the skin's helper bones, as chosen: "Liigesed" / "Nahk")
    });
  };
  const selectBone = (i) => {
    selected = i;
    adjust.bone = null;
    refreshBone();
  };

  groupSel.addEventListener('change', () => {
    groupSel.blur();
    selected = -1;
    fillBones();
    refreshBone();
  });
  boneSel.addEventListener('change', () => {
    boneSel.blur();
    selectBone(boneSel.value === '' ? -1 : +boneSel.value);
  });
  focusBtn.addEventListener('click', () => {
    const shapes = groupSel.value === 'shapes';
    // shape keys have no bone of their own: look at the face instead
    const target = sel()?.bone ?? bones.find((b) => (shapes ? b.group === 'face' : listed(b)))?.bone;
    if (!target) return;
    const wide = ['body', 'hands', 'all'].includes(groupSel.value); // (those keep the distance the camera has)
    const dist = groupSel.value === 'face' || shapes ? 0.3 : wide ? camera.position.distanceTo(controls.target) : 0.6;
    const dir = camera.position.clone().sub(controls.target).normalize();
    const p = target.getWorldPosition(new THREE.Vector3());
    controls.target.copy(p);
    camera.position.copy(p).addScaledVector(dir, dist);
    controls.update();
  });

  // mirrored bones: rotation about local X keeps its sign, Y and Z flip (Rigify mirrors with local X negated); X position flips
  // (a shape key's weight is the same on both sides)
  const mirrored = (v) => v && ('w' in v ? { w: v.w } : { rot: [v.rot[0], -v.rot[1], -v.rot[2]], pos: [-v.pos[0], v.pos[1], v.pos[2]] });
  // a twist helper bone only turns about Y: the other turns and any move are dropped, whatever the gizmo or the fields say
  const twistOnly = (e, v) => (e && !e.shape && isTwist(e) ? { rot: [0, v.rot?.[1] ?? 0, 0], pos: [0, 0, 0] } : v);
  // A bone dragged with the gizmo eases to where the pointer is (the pose follows it a little behind, which smooths the pointer's jitter) instead of
  // jumping there; typed numbers and sliders jump. A bone with rotation limits is not eased: the limit's correction (see update) measures
  // the pose that is shown and would fight a lagging one.
  const eased = (e) => !e.shape && !boneLimits.get(e.name) && !fingerLimits?.jointOf(e.name);
  const writeBone = (e, value, id, ease = false) => {
    value = twistOnly(e, value);
    holdAtFrame();
    tweaks.set(tweaks.keyOf(e.name, key), e.name, value, !ease); // (e is not always the selected bone: the gizmo may turn its parent)
    if (mirrorBox.checked && e.mirrorName) tweaks.set(tweaks.keyOf(e.mirrorName, key), e.mirrorName, mirrored(value), !ease);
    bonesChangedSoon(id);
  };
  // the numbers typed in: the rotation or the position offset (the other one stays as it is)
  const typed = (part, row) => () => {
    const e = sel();
    if (!e || !key || e.shape) return;
    const now = tweaks.get(editKey(), e.name);
    const next = row.fields.map((f, i) => f.read() ?? now[part][i]); // (a field that is empty or half typed keeps its value)
    Object.assign(adjust, { bone: e, until: performance.now() + 300 });
    writeBone(e, { rot: part === 'rot' ? next : now.rot, pos: part === 'pos' ? next : now.pos }, editId(e));
    refreshBone();
  };
  for (const [part, row] of [['rot', rotRow], ['pos', posRow]]) {
    for (const { field } of row.fields) {
      field.addEventListener('input', typed(part, row));
      field.addEventListener('blur', () => refreshBone()); // shows what the limits made of it
    }
  }
  weight.field.addEventListener('input', () => {
    const e = sel();
    const w = weight.read();
    if (!e?.shape || !key || w === null) return;
    writeBone(e, { w }, editId(e));
    refreshBone();
  });
  weight.field.addEventListener('blur', () => refreshBone());
  const setGizmo = (apply) => {
    apply();
    saveUi();
    refreshBone();
  };
  modeRotBtn.addEventListener('click', () => setGizmo(() => gizmo.setMode('rotate')));
  modeMoveBtn.addEventListener('click', () => setGizmo(() => gizmo.setMode('translate')));
  spaceBtn.addEventListener('click', () => setGizmo(() => gizmo.setSpace(gizmo.space === 'local' ? 'world' : 'local')));
  // The limits: stored for the bone, and for its mirror twin when the mirror box is ticked. A blank side stays free (the full turn).
  const orderRange = (lo, hi, side) => (lo !== null && hi !== null && lo > hi ? (side === 'lo' ? [lo, lo] : [hi, hi]) : [lo, hi]); // (the side that was just set wins)
  const setLimit = (e, axis, lo, hi, id, side) => {
    [lo, hi] = orderRange(lo, hi, side);
    const range = boneLimits.get(e.name) ?? {};
    if (lo === null && hi === null) delete range[axis];
    else range[axis] = [lo ?? -axisMax(axis), hi ?? axisMax(axis)];
    boneLimits.set(e.name, range);
    if (mirrorBox.checked && e.mirrorName) boneLimits.set(e.mirrorName, mirrorRange(boneLimits.get(e.name)));
    limitsEdited(id);
    refreshBone();
  };
  const num = (field) => (field.value === '' || !Number.isFinite(+field.value) ? null : +field.value);
  limitRows.forEach(({ axis, i, lo, hi, setLo, setHi }) => {
    const edit = (field) => () => {
      const e = sel();
      if (!e || e.shape) return;
      setLimit(e, axis, num(lo), num(hi), `limit:${e.name}:${axis}`, field === lo ? 'lo' : 'hi');
    };
    lo.addEventListener('change', edit(lo));
    hi.addEventListener('change', edit(hi));
    const take = (side) => () => {
      const e = sel();
      if (!e || e.shape) return;
      const angle = Math.round(boneLimits.current(e.name)[i] * 10) / 10;
      const now = boneLimits.get(e.name)?.[axis];
      setLimit(e, axis, side === 'lo' ? angle : (now?.[0] ?? null), side === 'hi' ? angle : (now?.[1] ?? null), undefined, side);
    };
    setLo.addEventListener('click', take('lo'));
    setHi.addEventListener('click', take('hi'));
  });
  // the finger joint's limits: one table per joint kind, edited from whichever finger bone is selected
  const setFingerLimit = (joint, axis, lo, hi, id, side) => {
    [lo, hi] = orderRange(lo, hi, side);
    const range = fingerLimits.get(joint) ?? {};
    if (lo === null && hi === null) delete range[axis];
    else range[axis] = [lo ?? -180, hi ?? 180];
    fingerLimits.set(joint, range);
    limitsEdited(id);
    refreshBone();
  };
  fingerRows.forEach(({ axis, i, lo, hi, setLo, setHi }) => {
    const joint = () => (sel() && !sel().shape ? fingerLimits?.jointOf(sel().name) : null);
    const edit = (field) => () => {
      const j = joint();
      if (!j) return;
      setFingerLimit(j, axis, num(lo), num(hi), `fingerlimit:${j}:${axis}`, field === lo ? 'lo' : 'hi');
    };
    lo.addEventListener('change', edit(lo));
    hi.addEventListener('change', edit(hi));
    const take = (side) => () => {
      const j = joint();
      if (!j) return;
      const angle = Math.round(fingerLimits.current(sel().name)[i] * 10) / 10;
      const now = fingerLimits.get(j)?.[axis];
      setFingerLimit(j, axis, side === 'lo' ? angle : (now?.[0] ?? null), side === 'hi' ? angle : (now?.[1] ?? null), undefined, side);
    };
    setLo.addEventListener('click', take('lo'));
    setHi.addEventListener('click', take('hi'));
  });
  limitsOnBox.addEventListener('change', () => {
    boneLimits.enabled = limitsOnBox.checked;
    if (fingerLimits) fingerLimits.enabled = limitsOnBox.checked;
    refreshBone();
  });
  clearLimitsBtn.addEventListener('click', () => {
    const e = sel();
    if (!e) return;
    boneLimits.set(e.name, null);
    if (mirrorBox.checked && e.mirrorName) boneLimits.set(e.mirrorName, null);
    limitsEdited();
    refreshBone();
  });
  resetBoneBtn.addEventListener('click', () => {
    const e = sel();
    if (!e || !key) return;
    writeBone(e, null);
    refreshBone();
  });
  resetGroupBtn.addEventListener('click', () => {
    if (!key) return;
    if (groupSel.value === 'all' && !confirm('Nullin kogu luustiku seaded selle märgi jaoks (ja keha seaded, mis kehtivad alati)? Ctrl+Z võtab tagasi.')) return;
    for (const e of items) if (listed(e)) tweaks.set(tweaks.keyOf(e.name, key), e.name, null);
    bonesChanged();
    refreshBone();
  });
  restBoneBtn.addEventListener('click', () => {
    const e = sel();
    if (!e || !key) return;
    writeBone(e, tweaks.restTweak(e.name), `rest:${key}:${e.name}`);
    refreshBone();
  });
  restGroupBtn.addEventListener('click', () => {
    if (!key) return;
    if (groupSel.value === 'all' && !confirm('Panen kogu luustiku mudeli GLB-faili puhkeasendisse (käed lähevad alla, ka keha seaded)? Ctrl+Z võtab tagasi.')) return;
    const id = `rest-group:${key}:${groupSel.value}`; // (one undo step)
    for (const e of items) if (listed(e)) writeBone(e, tweaks.restTweak(e.name), id);
    refreshBone();
  });
  copyJsonBtn.addEventListener('click', async () => {
    const text = JSON.stringify(tweaks.export(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      copyJsonBtn.textContent = 'Kopeeritud ✓';
    } catch {
      console.log(text);
      copyJsonBtn.textContent = 'Vaata konsooli';
    }
    setTimeout(() => (copyJsonBtn.textContent = 'Kopeeri JSON'), 1500);
  });

  // picking: a click (not an orbit drag) on a marker selects its bone
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down = null;
  dom.addEventListener('pointermove', (e) => Object.assign(press, { lx: e.clientX, ly: e.clientY }));
  dom.addEventListener('pointerdown', (e) => {
    Object.assign(press, { onGizmo: !!gizmo.axis, armed: false, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY });
    down = e.button === 0 ? { x: e.clientX, y: e.clientY, onGizmo: !!gizmo.axis } : null;
  });
  dom.addEventListener('pointerup', (e) => {
    if (!isOpen || !down || base?.handles) return; // (with the base-pose handles up the markers are away)
    const { onGizmo } = down;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    press.onGizmo = false;
    if (moved > CLICK_PX) return;
    const r = dom.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(markers.children.filter((m) => m.visible), false)[0];
    if (hit) selectBone(hit.object.userData.index);
    else if (selected >= 0 && !onGizmo) selectBone(-1); // a click on nothing lets go of the bone, and the gizmo goes
  });

  // ---------------------------------------------------------------- block: copy another sign's bone tweaks onto this one
  const copyFrom = document.createElement('select');
  for (const l of letters) copyFrom.add(new Option(letterLabel(l), l));
  const copyScope = document.createElement('select');
  // what a sign is made of: its hand definition (the fingers, the base pose, the thumb, the motion; they pose the hand) and its bone tweaks
  // (on top of that). "Kogu märk" takes both, so the hand looks like the other sign's.
  copyScope.add(new Option('Kogu märk (käsi ja luud)', 'sign'));
  copyScope.add(new Option('Ainult käe määratlus (sõrmed, asend, liikumine)', 'def'));
  copyScope.add(new Option('Ainult luude seaded (kogu märk)', 'all'));
  copyScope.add(new Option('Luude seaded: valitud rühm', 'group'));
  copyScope.add(new Option('Luude seaded: valitud luu / vorm', 'bone'));
  const copyApply = el('button', '', 'Kopeeri siia');
  const copyNote = el('div', 'fd__note');
  // one hand's pose onto the other (the same numbers, which pose the left hand as the mirror image) or the two swapped
  const copyRL = el('button', '', 'Parem → vasak');
  const copyLR = el('button', '', 'Vasak → parem');
  const swapBtn = el('button', '', '⇄ Vaheta käed');
  copyRL.title = 'Vasak käsi saab parema käe peegelpildi';
  copyLR.title = 'Parem käsi saab vasaku käe peegelpildi';
  swapBtn.title = 'Parem ja vasak käsi vahetavad asendid (peegelpildina)';
  const handsRow = el('div', 'fd__buttons');
  handsRow.append(copyRL, copyLR, swapBtn);
  const handsBoneBox = input('checkbox', { checked: true });
  const handsBones = el('label', 'fd__row');
  handsBones.title = 'Võtab kaasa ka käsivarre, küünarvarre, käe ja sõrmeluude seaded (samad numbrid)';
  handsBones.append(el('span', '', 'Käeluude seaded kaasa'), handsBoneBox);
  const handsNote = el('div', 'fd__note');
  const PART_FIELDS = ['curl', 'thumb', 'spread', 'knuckle', 'dir', 'orient', 'motion'];
  const sidePart = (side) => (side === 'R' ? sign() : sign()?.left);
  // What a hand is made of now: the fields of its definition (none: only its bones' tweaks pose it, as in Q). A left hand that takes
  // no part in the sign waits in the standby pose: the standby sign's fingers, in the relaxed orient (as hands.js poses it).
  const takePart = (side) => {
    const own = sidePart(side);
    const out = {};
    if (!own) {
      const st = SIGNS[STANDBY];
      if (Array.isArray(st?.curl)) {
        for (const f of ['curl', 'thumb', 'spread', 'knuckle']) if (st[f] !== undefined) out[f] = structuredClone(st[f]);
        out.dir = 'relaxed';
      }
      return out;
    }
    for (const f of PART_FIELDS) if (own[f] !== undefined) out[f] = structuredClone(own[f]);
    return out;
  };
  const putPart = (side, data) => {
    const dst = side === 'R' ? sign() : (sign().left ??= {});
    for (const f of PART_FIELDS) delete dst[f];
    Object.assign(dst, data);
  };
  // (the numbers of the two hands mean the same: the hand code and tweaks.js mirror the left one, so they are copied as they are)
  const handsDo = (mode) => () => {
    if (!key) return void (handsNote.textContent = 'Vali kõigepealt märk.');
    const sides = mode === 'RL' ? ['R', 'L'] : mode === 'LR' ? ['L', 'R'] : ['R', 'L']; // [from, to] (a swap goes both ways)
    // the arm and finger bones' tweaks, read before anything changes: [the twin bone, the value it gets]
    const moves = [];
    if (handsBoneBox.checked) {
      for (const [from, to] of mode === 'swap' ? [['R', 'L'], ['L', 'R']] : [sides]) {
        const group = from === 'R' ? 'right' : 'left';
        for (const e of tweaks.bones) {
          const twin = e.group === group ? tweaks.twinOf(e.name) : null;
          if (!twin) continue;
          const now = tweaks.get(tweaks.keyOf(e.name, key), e.name);
          moves.push([twin, { rot: now.rot, pos: now.pos }]);
        }
      }
    }
    const a = takePart(sides[0]);
    const b = mode === 'swap' ? takePart(sides[1]) : null;
    putPart(sides[1], a);
    if (b) putPart(sides[0], b);
    // (the left hand has its own key now, if it had none: the bones' keys are asked for after that)
    for (const [twin, value] of moves) tweaks.set(tweaks.keyOf(twin, key), twin, value);
    const act = `hands:${mode}:${Date.now()}`; // the definition and the tweaks are one step
    renderHand();
    changed(act);
    bonesChanged(act);
    refreshBone();
    endGesture();
    handsNote.textContent = mode === 'swap' ? `Käed vahetatud${handsBoneBox.checked ? '' : ' (ilma luude seadeteta)'}.` : mode === 'RL' ? 'Vasak käsi on nüüd parema peegelpilt.' : 'Parem käsi on nüüd vasaku peegelpilt.';
  };
  copyRL.addEventListener('click', handsDo('RL'));
  copyLR.addEventListener('click', handsDo('LR'));
  swapBtn.addEventListener('click', handsDo('swap'));
  {
    const r1 = el('label', 'fd__row');
    r1.append(el('span', '', 'Märgilt'), copyFrom);
    const r2 = el('label', 'fd__row');
    r2.append(el('span', '', 'Mida'), copyScope);
    const buttons = el('div', 'fd__buttons');
    buttons.append(copyApply);
    blockCopy.append(el('div', 'fd__h', 'Kopeeri teisest märgist'), r1, r2, buttons, el('div', 'fd__sub', 'Käte vahel (selles märgis)'), handsRow, handsBones, handsNote, copyNote);
  }
  copyApply.addEventListener('click', () => {
    const from = copyFrom.value;
    const to = key;
    if (!to) return void (copyNote.textContent = 'Vali kõigepealt märk.');
    if (from === to) return void (copyNote.textContent = 'Vali lähtemärk, mis erineb praegusest.');
    const scope = copyScope.value;
    const e = sel();
    if (scope === 'bone' && !e) return void (copyNote.textContent = 'Vali kõigepealt luu või vorm.');
    const act = `copy:${from}:${to}:${Date.now()}`; // the definition and the tweaks are one undo step
    const withDef = scope === 'sign' || scope === 'def';
    const boneScope = scope === 'sign' ? 'all' : scope === 'def' ? null : scope;
    // the hand definition first (the left hand's bones are keyed by whether the sign has a left hand: asked for after that)
    if (withDef) {
      stopPlay(false);
      defs.applyDef(to, defs.currentDef(from));
      if (hand === 'L' && !sign()?.left) hand = 'R';
      renderHand();
      changed(act);
    }
    let copied = 0;
    let cleared = 0;
    if (boneScope) {
      // (the mirror twin follows when the mirror box is ticked, as it does for the sliders)
      const names =
        boneScope === 'bone' ? [e.name, ...(mirrorBox.checked && e.mirrorName ? [e.mirrorName] : [])]
        : items.filter((x) => boneScope === 'all' || inGroup(x)).map((x) => x.name);
      ({ copied, cleared } = tweaks.copy(from, to, names));
      if (scope === 'sign') tweaks.copyFrames(from, to); // (the keyframes ride on the path, which came with the definition)
    }
    bonesChanged(withDef ? act : undefined);
    refreshBone();
    endGesture();
    const parts = [withDef && 'käe määratlus', boneScope && (copied || cleared ? `${copied} luukirjet${cleared ? `, ${cleared} eemaldatud` : ''}` : null)].filter(Boolean);
    copyNote.textContent = parts.length ? `Kopeeritud ${letterLabel(from)} → ${letterLabel(to)}: ${parts.join(', ')}.` : `${letterLabel(from)} ja ${letterLabel(to)} ei erine selles ulatuses (või pole siin märgipõhiseid kirjeid).`;
  });

  // ---------------------------------------------------------------- the bar: reset, load, save
  resetSignBtn.addEventListener('click', () => {
    if (!key) return;
    defs.resetSign(key);
    renderHand();
    changed();
  });
  $('load-file').addEventListener('click', () => {
    const dirty = dirtySigns.size || canon(tweaks.export()) !== fileState || limitsChanged() || orients.changedNames().length || thumbs.changedNames().length;
    if (dirty && !confirm('Kustutan brauseri töökoopia ja laen seaded nii, nagu leht need serverist laadis? Salvestamata muudatused (ka keyframe\'id ja põhiasendite luumuudatused, mis on ainult selles brauseris) lähevad kaduma.')) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LIMITS_KEY);
      localStorage.removeItem(FRAMES_KEY);
    } catch {}
    tweaks.load(tweaksFromSigns());
    limitsLoad(limitsFileData);
    orients.resetAll();
    thumbs.resetAll();
    for (const k of [...dirtySigns]) defs.resetSign(k);
    recheckAll();
    defs.persist();
    copyNote.textContent = 'Laetud (nagu leht need serverist laadis), töökoopia kustutatud (Ctrl+Z võtab tagasi). Teiste uuemad muudatused tulevad lehe uuesti laadimisega.';
    renderHand();
    refreshBone();
    show(key);
    freeze(scrub);
    commit();
    updateStatus();
  });
  /** PUT the changes; when the session has run out, ask for the password again and retry once. */
  const putChanges = async (body) => {
    try {
      return await api('PUT', SAVE_URL, body);
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 401) throw err;
      if (!(await askLogin('Seanss on lõppenud. Logi uuesti sisse, et muudatused salvestada.'))) throw new Error('salvestamine tühistati');
      return api('PUT', SAVE_URL, body);
    }
  };
  saveBtn.addEventListener('click', async () => {
    const label = saveBtn.textContent;
    const signKeys = [...dirtySigns];
    const created = signKeys.filter(defs.isNew); // signs that the server does not have yet
    const state = tweaks.export();
    const drafts = tweakDrafts();
    const limitsState = limitsExport();
    const limitsDirty = limitsChanged();
    const orientsDirty = orients.changedNames().length > 0; // the base poses and the thumb poses go to the server too (everybody sees them)
    const thumbsDirty = thumbs.changedNames().length > 0;
    try {
      if (!Object.keys(versions).length) throw new Error('lehe andmed pole serverist (server ei vastanud lehe laadimisel)');
      // one request, saved all or nothing: every sign with the version it was edited from
      const signs = {};
      const entry = (k) => (signs[k] ??= defs.isNew(k) ? { create: true } : { base: versions[k] });
      for (const k of signKeys) entry(k).def = defs.currentDef(k);
      for (const [k, data] of Object.entries(drafts)) if (k !== GLOBAL) entry(k).tweaks = data;
      const body = { signs };
      if (GLOBAL in drafts) body.global = { tweaks: drafts[GLOBAL], base: versions['*global'] };
      if (limitsDirty) body.limits = { ...limitsState, base: versions['*limits'] };
      if (orientsDirty) body.orients = { base: versions['*orients'] ?? 0, data: orients.all() };
      if (thumbsDirty) body.thumbPoses = { base: versions['*thumbPoses'] ?? 0, data: { [handOf('R')?.rigId ?? 'cc']: thumbs.all() } };
      if (!Object.keys(signs).length && !body.global && !body.limits && !body.orients && !body.thumbPoses) {
        saveBtn.textContent = 'Pole midagi salvestada';
      } else {
        const res = await putChanges(body);
        Object.assign(versions, res.versions);
        if (signKeys.length) {
          defs.markSaved(signKeys);
          recheckAll();
        }
        fileState = canon(state);
        fileData = JSON.parse(fileState);
        saveTweaks(); // now equal to the server's data, so the working copy is dropped
        if (limitsDirty) {
          limitsFileState = canon(limitsState);
          limitsFileData = JSON.parse(limitsFileState);
          limitsBase = fingerprint(limitsFileState);
          saveLimits();
        }
        if (orientsDirty) orients.markSaved(); // (they are the baseline now)
        if (thumbsDirty) thumbs.markSaved();
        clearHistory(); // the server's data is the baseline now
        saveBtn.textContent = created.length ? 'Salvestatud ✓ – laen uuesti…' : 'Salvestatud ✓';
        // the text box and the sign list read the word signs when the page loads: a new sign shows up there after a reload
        if (created.length) setTimeout(() => location.reload(), 700);
      }
    } catch (err) {
      console.warn('Could not save', err);
      const conflicts = err.body?.conflicts;
      saveBtn.textContent = conflicts?.length
        ? `Keegi teine salvestas vahepeal: ${conflicts.map((k) => (k === '*global' ? 'keha' : k === '*limits' ? 'piirid' : k === '*orients' ? 'põhiasendid' : k === '*thumbPoses' ? 'pöidla asendid' : k)).join(', ')} – lae leht uuesti: nende märkide töökoopia asendub teise salvestatuga, ülejäänud muudatused säilivad`
        : `Ei õnnestunud: ${err.message}`;
      setTimeout(() => (saveBtn.textContent = label), conflicts?.length ? 9000 : 2500);
      updateStatus();
      return;
    }
    updateStatus();
    setTimeout(() => {
      saveBtn.textContent = label;
      updateStatus();
    }, 2500);
  });

  // ---------------------------------------------------------------- the timeline
  // One track per channel. The points of the path sit where the character reaches them (every segment gets a share of the
  // time in proportion to its length, so moving a point also moves the points after it). Drag a dot up or down to change that
  // channel of the point; drag in the ruler or between the tracks to move the playhead; double-click to add a point there.
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'fd__svg');
  const timeLabel = el('span', 'fd__time');
  let ptInputs = []; // the selected point's number fields
  let timeField = null; // ... its time (the middle points only)
  let autoBtn = null;
  let frameCopyBtn = null; // "copy from the previous keyframe"
  let ranges = CHANNELS.map((c) => c.min); // half-range of each track; held still while a dot is dragged
  let drag = null;
  let lastDown = null; // the last press on the tracks' background, for the double click
  let plotW = 600;

  const motion = () => part()?.motion ?? null;
  const shownR = () => (playing ? playR : scrub);
  const xOf = (r) => TL.gutter + r * plotW;
  const yMid = (c) => TL.ruler + c * TL.row + TL.row / 2;
  const half = TL.row / 2 - 3;
  // The points' times: by default worked out from the segment lengths, so editing one point would shift all the others. The
  // first edit pins them (motion.times, see hands.js), so a keyframe stays where it is while another one is changed.
  const pin = (m) => {
    if (m.times?.length === m.path.length) return;
    m.times = pathTimes(m.path).map((t) => Math.round(t * 10000) / 10000);
    m.times[0] = 0;
    m.times[m.times.length - 1] = 1;
  };
  const fit = () => {
    const m = motion();
    if (!m) return;
    ranges = CHANNELS.map((c, i) => Math.max(c.min, 1.15 * Math.max(...m.path.map((pt) => Math.abs(pt[i] ?? 0)))));
  };

  // ---- keyframes (tweaks.js): each point of the right hand's path can hold a whole-body pose
  // In frame mode every bone, shape and gizmo edit goes to the selected point ("keyframe N"): the whole skeleton, body and face. The
  // playhead then sits on that point, and a bone no frame says anything about keeps the sign's own tweak. Playing mixes the frames.
  function frameActive() {
    return frameMode && isOpen && hand === 'R' && !!key && key !== STANDBY && !!motion() && !base?.boneEdit;
  }
  const frameTime = () => {
    const m = motion();
    return m ? (pathTimes(m.path, m.times)[selPoint] ?? 0) : 0;
  };
  /** Point the tweaks at the selected point's keyframe (or at none); with `moveHead` the playhead goes to the point. */
  function syncFrame(moveHead = true) {
    const on = frameActive();
    tweaks.setEditFrame(on ? key : null, selPoint);
    if (frameCopyBtn) frameCopyBtn.disabled = selPoint <= 0;
    if (on && moveHead) {
      scrub = frameTime();
      stopPlay(false);
      freeze(scrub);
    }
    refreshBone();
    drawTimeline();
  }
  /** Before an edit in frame mode: the playhead is on the point being edited (what is dragged is that frame's pose, not a mix). */
  function holdAtFrame() {
    if (!frameActive()) return;
    stopPlay(false);
    const t = frameTime();
    if (Math.abs(scrub - t) <= 1e-4) return;
    scrub = t;
    freeze(scrub);
    drawTimeline();
  }
  /** Path points came or went: the keyframes move with them. */
  const framesFollow = (fn) => {
    if (hand !== 'R' || !key) return;
    fn();
    saveTweaks();
  };

  function buildTimeline() {
    stopPlay(false);
    tweaks.setEditFrame(null);
    tlHead.replaceChildren();
    const p = part();
    if (!p) {
      tlHead.append(el('b', '', 'Liikumine'), el('span', 'fd__note', !key ? 'Vali märk.' : 'Vasak käsi ei osale selles viipes.'));
      tlBody.replaceChildren();
      return;
    }
    if (key === STANDBY) {
      tlHead.append(el('b', '', 'Liikumine'), el('span', 'fd__note', 'Ooteasendil pole liikumist.'));
      tlBody.replaceChildren();
      return;
    }
    const m = p.motion;
    selPoint = m ? clamp(selPoint, 0, m.path.length - 1) : 0;
    const on = input('checkbox', { checked: !!m });
    on.addEventListener('change', () => {
      if (on.checked) p.motion = { path: [[0, 0], [0, 0]], duration: 1 };
      else {
        delete p.motion;
        framesFollow(() => tweaks.dropFrames(key)); // (no path: no points to hold keyframes)
      }
      selPoint = 0;
      buildTimeline();
      changed();
    });
    const onRow = el('label');
    onRow.append(on, el('span', '', `Käsi liigub (${hand === 'R' ? 'parem' : 'vasak'})`));
    tlHead.appendChild(onRow);
    if (!m) {
      // keyframes ride on the points of the path: a path of two points that stay put gives a sign with no hand movement a timeline too
      if (hand === 'R') {
        const start = el('button', '', '◆ Keyframe\'i keha');
        start.title = 'Lisab ajajoone (kaks punkti, käsi jääb paigale) ja lülitab keyframe\'i režiimi sisse: muudad kogu keha, luustikku ja nägu punkti kaupa';
        start.addEventListener('click', () => {
          p.motion = { path: [[0, 0], [0, 0]], duration: 1 };
          selPoint = 0;
          frameMode = true;
          buildTimeline();
          changed();
        });
        tlHead.appendChild(start);
      }
      const ring = el('button', '', '◯ Ring…');
      ring.title = 'Käsi liigub ringis: raadius, tasapind, pöörete ja punktide arv';
      ring.addEventListener('click', openRing);
      tlHead.appendChild(ring);
      tlBody.replaceChildren(el('div', 'fd__none', 'Selle viipe käsi ei liigu. „◆ Keyframe\'i keha“ lisab ajajoone, kus käsi jääb paigale ja muutuda saavad keha ja nägu; „Käsi liigub“ lisab ajajoone käe liikumisega.'));
      return;
    }
    const playBtn = el('button', '', '▶ Mängi');
    playBtn.dataset.role = 'play';
    playBtn.addEventListener('click', () => (playing ? stopPlay(true) : startPlay()));
    const dur = input('number', { min: 0.2, max: 10, step: 0.1, value: m.duration });
    dur.addEventListener('input', () => {
      m.duration = Math.max(0.2, +dur.value || 1);
      changed(`duration:${key}:${hand}`);
      drawTimeline();
    });
    const durLabel = el('label');
    durLabel.append(el('span', '', 'Kestus (s)'), dur);
    const stagger = input('number', { min: 0, max: 0.33, step: 0.01, value: m.stagger ?? 0 });
    stagger.title = 'Sõrmed painduvad üksteise järel (0 … 0,33 teekonnast)';
    stagger.addEventListener('input', () => {
      const v = clamp(+stagger.value || 0, 0, 0.33);
      if (v) m.stagger = v;
      else delete m.stagger;
      changed(`stagger:${key}:${hand}`);
    });
    const staggerLabel = el('label');
    staggerLabel.append(el('span', '', 'Hajutus'), stagger);
    // smooth: one curve through the points, no slowing down at each of them (a circle drawn from few points is round, not a polygon)
    const smoothBox = input('checkbox', { checked: !!m.smooth });
    smoothBox.addEventListener('change', () => {
      if (smoothBox.checked) m.smooth = true;
      else delete m.smooth;
      changed(`smooth:${key}:${hand}`);
      drawTimeline();
    });
    const smoothLabel = el('label');
    smoothLabel.title = 'Sile liikumine: käsi liigub ühe sileda kõverana läbi punktide ega aeglusta iga punkti juures (ring vähestest punktidest on ümar, mitte hulknurk). Ilma selleta aeglustub käsi igas punktis. Kehtib ka keyframe\'ide vahel.';
    smoothLabel.append(smoothBox, el('span', '', 'Sile'));
    const ringBtn = el('button', '', '◯ Ring…');
    ringBtn.title = 'Käe liikumistee ringiks: raadius, tasapind, pöörete ja punktide arv; asendab praegused punktid';
    ringBtn.addEventListener('click', openRing);
    const addBtn = el('button', '', '+ Punkt');
    addBtn.title = 'Lisa punkt mänguoleku kohale (topeltklõps rajal teeb sama)';
    addBtn.addEventListener('click', () => addPointAt(scrub));
    const delBtn = el('button', '', '− Punkt');
    delBtn.title = 'Eemalda valitud punkt';
    delBtn.disabled = m.path.length <= 2;
    delBtn.addEventListener('click', () => {
      pin(m);
      framesFollow(() => tweaks.removeFrame(key, selPoint));
      m.path.splice(selPoint, 1);
      m.times.splice(selPoint, 1);
      selPoint = clamp(selPoint, 0, m.path.length - 1);
      buildTimeline();
      changed();
    });
    // keyframes: edit a whole-body pose for the selected point (see syncFrame)
    const frameBtn = el('button', frameMode ? 'fd__on' : '', '◆ Keyframe\'i keha');
    frameBtn.title =
      'Keyframe\'i režiim: valitud punkti (kf) jaoks muudad kogu keha, luustikku ja nägu olemasolevate vahenditega (gizmo, liugurid, luu ja vormide valik). Muudatus jääb sellele punktile; esitusel liiguvad luud ja näovormid punktide vahel. Kehtib parema käe ajajoonele. Keyframe\'id jäävad ainult sinu brauserisse.';
    frameBtn.disabled = hand !== 'R';
    frameBtn.addEventListener('click', () => {
      frameMode = !frameMode;
      buildTimeline();
    });
    const frameCopy = el('button', '', 'Kopeeri eelmisest');
    frameCopy.title = 'Valitud keyframe saab eelmise punkti keyframe\'i (kui eelmisel pole midagi, siis vabaneb see ise)';
    frameCopyBtn = frameCopy;
    frameCopy.addEventListener('click', () => {
      const act = `frame-copy:${key}:${selPoint}`;
      tweaks.copyFrame(key, selPoint - 1, selPoint);
      bonesChanged(act);
      refreshBone();
      drawTimeline();
    });
    const frameClear = el('button', '', 'Tühjenda kf');
    frameClear.title = 'Valitud keyframe ei muuda midagi: keha järgib selles punktis märgi enda seadeid';
    frameClear.addEventListener('click', () => {
      const act = `frame-clear:${key}:${selPoint}`;
      tweaks.clearFrame(key, selPoint);
      bonesChanged(act);
      refreshBone();
      drawTimeline();
    });
    frameCopy.hidden = frameClear.hidden = !frameMode || hand !== 'R';
    const pt = el('div', 'fd__pt');
    ptInputs = CHANNELS.map((c, i) => {
      const field = input('number', { step: c.step });
      field.title = c.title;
      field.addEventListener('input', () => {
        pin(m);
        const point = m.path[selPoint];
        while (point.length <= i) point.push(0);
        point[i] = Number.isFinite(+field.value) ? +field.value : 0;
        trim(point);
        changed(`point:${key}:${hand}:${selPoint}:${i}`);
        fit();
        drawTimeline();
      });
      const label = el('label');
      label.append(el('span', '', c.id), field);
      pt.appendChild(label);
      return field;
    });
    timeField = input('number', { min: 0, max: m.duration, step: 0.01 });
    timeField.title = 'Millal valitud punkti jõutakse (s); jääb alles, kui teisi punkte muudetakse';
    timeField.addEventListener('input', () => {
      pin(m);
      const i = selPoint;
      if (i <= 0 || i >= m.path.length - 1 || !Number.isFinite(+timeField.value)) return;
      m.times[i] = Math.round(clamp(+timeField.value / m.duration, m.times[i - 1], m.times[i + 1]) * 10000) / 10000;
      changed(`time:${key}:${hand}:${i}`);
      drawTimeline();
    });
    const timeLabelField = el('label');
    timeLabelField.append(el('span', '', 't'), timeField);
    autoBtn = el('button', '', 'Ajad automaatselt');
    autoBtn.title = 'Unusta punktide kindlad ajad: iga lõik saab aega oma pikkuse järgi';
    autoBtn.addEventListener('click', () => {
      delete m.times;
      changed();
      fillPointInputs();
      drawTimeline();
    });
    pt.append(timeLabelField, autoBtn);
    pt.prepend(el('span', 'fd__note', `Punkt ${selPoint + 1}/${m.path.length}:`));
    pt.title = 'Esimene punkt on viipe enda asend, kui see on [0, 0]';
    tlHead.append(playBtn, timeLabel, durLabel, staggerLabel, smoothLabel, ringBtn, addBtn, delBtn, frameBtn, frameCopy, frameClear, pt);
    tlBody.replaceChildren(svg);
    fit();
    fillPointInputs();
    drawTimeline();
    syncFrame();
  }

  function fillPointInputs() {
    const point = motion()?.path[selPoint];
    ptInputs.forEach((field, i) => {
      if (document.activeElement !== field) field.value = point?.[i] ?? 0;
    });
    const m = motion();
    if (timeField && m) {
      const t = pathTimes(m.path, m.times)[selPoint] ?? 0;
      if (document.activeElement !== timeField) timeField.value = round(t * m.duration, 0.01);
      timeField.disabled = selPoint <= 0 || selPoint >= m.path.length - 1;
      autoBtn.disabled = !m.times;
    }
  }

  function drawTimeline() {
    const m = motion();
    if (!m || !isOpen) return;
    const width = tlBody.clientWidth || 800;
    plotW = Math.max(100, width - TL.gutter - TL.right);
    const height = TL.ruler + TL.row * CHANNELS.length + 4;
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const times = pathTimes(m.path, m.times);
    const r = shownR();
    const tmp = new Array(CHANNELS.length).fill(0);
    let s = '';
    // tracks: background, zero line, label with the value under the playhead
    const here = tracePoint(m.path, r, [...tmp], m.times, m.smooth);
    CHANNELS.forEach((c, i) => {
      const top = TL.ruler + i * TL.row;
      s += `<rect x="${TL.gutter}" y="${top}" width="${plotW}" height="${TL.row}" fill="${i % 2 ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.06)'}"/>`;
      s += `<line x1="${TL.gutter}" x2="${TL.gutter + plotW}" y1="${yMid(i)}" y2="${yMid(i)}" stroke="rgba(255,255,255,0.18)" stroke-dasharray="3 3"/>`;
      s += `<text x="6" y="${yMid(i) + 4}" style="fill:${c.color}">${c.id}</text>`;
      s += `<text class="fd__val" x="${TL.gutter - 6}" y="${yMid(i) + 4}" text-anchor="end">${round(here[i], c.step)}${c.unit ?? ''}</text>`;
    });
    // ruler: seconds
    const steps = [0.05, 0.1, 0.25, 0.5, 1, 2];
    const stepS = steps.find((t) => (t / m.duration) * plotW >= 56) ?? 2;
    for (let t = 0; t <= m.duration + 1e-9; t += stepS) {
      const x = xOf(t / m.duration);
      s += `<line x1="${x}" x2="${x}" y1="${TL.ruler - 5}" y2="${TL.ruler}" stroke="#777"/><text x="${x + 3}" y="12">${round(t * 100, 1) / 100}s</text>`;
    }
    // the curves
    const n = clamp(Math.round(plotW / 3), 24, 240);
    const samples = Array.from({ length: n + 1 }, (_, k) => tracePoint(m.path, k / n, [...tmp], m.times, m.smooth));
    CHANNELS.forEach((c, i) => {
      const pts = samples.map((v, k) => `${xOf(k / n).toFixed(1)},${(yMid(i) - (v[i] / ranges[i]) * half).toFixed(1)}`).join(' ');
      s += `<polyline points="${pts}" fill="none" stroke="${c.color}" stroke-width="1.5" opacity="0.9" pointer-events="none"/>`;
    });
    // the points: a guide through every track, a dot per channel
    m.path.forEach((pt, p) => {
      const x = xOf(times[p]);
      const on = p === selPoint;
      s += `<line x1="${x}" x2="${x}" y1="${TL.ruler}" y2="${TL.ruler + TL.row * CHANNELS.length}" stroke="${on ? '#ffb347' : 'rgba(255,255,255,0.14)'}" pointer-events="none"/>`;
      // a keyframe (a whole-body pose) on the point: a diamond on the ruler; in frame mode the selected point has an outline even without one
      const held = hand === 'R' && key && tweaks.frameHas(key, p);
      if (held || (on && frameActive())) s += `<path d="M${x},3 l5,5 l-5,5 l-5,-5 z" fill="${held ? '#ffb347' : 'none'}" stroke="#ffb347" stroke-width="1.5" pointer-events="none"><title>keyframe ${p + 1}</title></path>`;
      CHANNELS.forEach((c, i) => {
        const y = yMid(i) - (clamp(pt[i] ?? 0, -ranges[i], ranges[i]) / ranges[i]) * half;
        s += `<circle data-p="${p}" data-c="${i}" cx="${x}" cy="${y}" r="${on ? 5 : 4}" fill="${on ? '#ffb347' : c.color}" stroke="#16161a" stroke-width="1.5"><title>${c.id} = ${round(pt[i] ?? 0, c.step)}${c.unit ?? ''} (punkt ${p + 1})</title></circle>`;
      });
    });
    // the playhead
    const px = xOf(r);
    s += `<line x1="${px}" x2="${px}" y1="2" y2="${TL.ruler + TL.row * CHANNELS.length}" stroke="#5fd0a0" stroke-width="2" pointer-events="none"/><path d="M${px - 6},1 L${px + 6},1 L${px},11 Z" fill="#5fd0a0" pointer-events="none"/>`;
    svg.innerHTML = s;
    timeLabel.textContent = `${(r * m.duration).toFixed(2)} / ${m.duration.toFixed(2)} s`;
  }

  const fractionAt = (e) => clamp((e.clientX - svg.getBoundingClientRect().left - TL.gutter) / plotW, 0, 1);
  /** Select point `p` of the path (its numbers show, and in frame mode its keyframe is the one being edited and the playhead goes to it). */
  function selectPoint(p) {
    const m = motion();
    if (!m || p === selPoint) return;
    selPoint = p;
    const label = tlHead.querySelector('.fd__pt > span');
    if (label) label.textContent = `Punkt ${p + 1}/${m.path.length}:`;
    fillPointInputs();
    if (frameActive()) syncFrame();
  }
  const setScrub = (r) => {
    // In frame mode a playhead put on a point (its keyframe) selects that point: what is edited is what is shown, never another keyframe.
    const m = motion();
    if (m && frameActive()) {
      const times = pathTimes(m.path, m.times);
      const near = times.findIndex((t) => Math.abs(t - r) <= 0.015);
      if (near >= 0) {
        r = times[near];
        if (near !== selPoint) return selectPoint(near);
      }
    }
    scrub = r;
    stopPlay(false);
    freeze(scrub);
    drawTimeline();
  };
  svg.addEventListener('pointerdown', (e) => {
    const m = motion();
    if (!m || e.button !== 0) return;
    svg.setPointerCapture(e.pointerId);
    const t = e.target;
    if (t.dataset?.p !== undefined) {
      const p = +t.dataset.p;
      const c = +t.dataset.c;
      const newSel = p !== selPoint;
      selPoint = p;
      fit();
      drag = { type: 'dot', p, c, y0: e.clientY, v0: m.path[p][c] ?? 0, range: ranges[c] };
      if (newSel) {
        tlHead.querySelector('.fd__pt > span').textContent = `Punkt ${p + 1}/${m.path.length}:`;
        fillPointInputs();
        if (frameActive()) syncFrame(); // the keyframe of this point is edited now, the playhead goes to it
      }
      drawTimeline();
    } else {
      // (a double click is spotted here: the tracks are redrawn between the clicks, which swallows the browser's own dblclick)
      const again = lastDown && e.timeStamp - lastDown.t < 350 && Math.hypot(e.clientX - lastDown.x, e.clientY - lastDown.y) < 6;
      lastDown = { t: e.timeStamp, x: e.clientX, y: e.clientY };
      if (again && e.clientY - svg.getBoundingClientRect().top >= TL.ruler) {
        lastDown = null;
        return addPointAt(fractionAt(e));
      }
      drag = { type: 'scrub' };
      setScrub(fractionAt(e));
    }
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const m = motion();
    if (!m) return;
    if (drag.type === 'scrub') return setScrub(fractionAt(e));
    pin(m); // before the first change, so the other points keep their times
    const step = CHANNELS[drag.c].step;
    const v = drag.v0 - ((e.clientY - drag.y0) / half) * drag.range;
    const point = m.path[drag.p];
    while (point.length <= drag.c) point.push(0);
    point[drag.c] = Math.round(clamp(v, -drag.range * 1.5, drag.range * 1.5) / step) * step;
    point[drag.c] = Math.round(point[drag.c] * 1000) / 1000;
    trim(point);
    ranges[drag.c] = drag.range; // the track keeps its scale until the dot is let go
    changed(`dot:${key}:${hand}:${drag.p}:${drag.c}`);
    fillPointInputs();
    drawTimeline();
  });
  const endDrag = () => {
    if (!drag) return;
    const wasDot = drag.type === 'dot';
    drag = null;
    endGesture();
    if (wasDot) {
      fit(); // now the track may rescale
      drawTimeline();
    }
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  // ---- a ring: the path of the hand set to a circle, from a small form (a panel of its own)
  let ringPanel = null;
  const RING_PLANES = { xy: [0, 1], xz: [0, 2], yz: [1, 2] };
  /** The hand's path becomes a circle (or several turns) in a plane; `o` = { radius, plane, turns, points, clockwise, centred, duration, smooth }. */
  function makeRing(o) {
    const p = part();
    if (!p || !key || key === STANDBY) return;
    if (hand === 'R' && tweaks.frameSigns().includes(key) && !confirm('Ring asendab tee punktid. Selle viipe keyframe\'id kustutatakse (need on seotud punktidega). Jätkan?')) return;
    const [a, b] = RING_PLANES[o.plane] ?? RING_PLANES.xy;
    const n = clamp(Math.round(o.points), 4, 64); // points per turn
    const total = Math.max(1, Math.round(o.turns * n));
    const path = [];
    for (let k = 0; k <= total; k++) {
      const angle = ((o.clockwise ? -1 : 1) * 2 * Math.PI * k) / n;
      // (the ring starts at the hand's own place; or the hand is the middle of it: it then starts a radius below / behind that)
      const u = o.radius * Math.sin(angle);
      const v = o.centred ? -o.radius * Math.cos(angle) : o.radius * (1 - Math.cos(angle));
      const pt = [0, 0, 0];
      pt[a] = round3(u);
      pt[b] = round3(v);
      trim(pt);
      path.push(pt);
    }
    p.motion = { ...(p.motion ?? {}), path, duration: clamp(o.duration, 0.2, 10) };
    delete p.motion.times; // (the segments of a ring are all as long: equal shares of the time)
    if (o.smooth) p.motion.smooth = true;
    else delete p.motion.smooth;
    framesFollow(() => tweaks.dropFrames(key));
    selPoint = 0;
    buildTimeline();
    changed();
  }
  function openRing() {
    if (!ringPanel) {
      const box = el('div', 'panel fd-gizmo fd-ring');
      box.innerHTML = '<div class="panel__bar"><span class="panel__title">Ring</span><span class="panel__grip">⋮⋮</span></div>';
      const body = el('div', 'fd-gizmo__body');
      const f = {}; // the form's fields
      const row = (label, control, title) => {
        const r = el('label', 'fd__row');
        r.title = title ?? '';
        r.append(el('span', '', label), control);
        return r;
      };
      const num = (min, max, step, value) => input('number', { min, max, step, value });
      const select = (options, value) => {
        const s = document.createElement('select');
        for (const [v, label] of options) s.add(new Option(label, v));
        s.value = value;
        return s;
      };
      f.radius = num(0.01, 1, 0.01, 0.1);
      f.plane = select([['xy', 'x / y (ees, püsti)'], ['xz', 'x / z (laual, vaadatuna ülalt)'], ['yz', 'y / z (küljelt)']], 'xy');
      f.turns = num(0.25, 6, 0.25, 1);
      f.points = num(4, 64, 1, 12);
      f.clockwise = select([['0', 'Vastupäeva (vaataja poolt)'], ['1', 'Päripäeva (vaataja poolt)']], '0');
      f.centred = select([['0', 'Algab käe asendist'], ['1', 'Käe asend on ringi keskel']], '0');
      f.duration = num(0.2, 10, 0.1, 1.5);
      f.smooth = input('checkbox', { checked: true });
      f.smooth.title = 'Sile: käsi liigub ühe sileda kõverana läbi punktide, nii on ring ümar';
      const make = el('button', 'fd__on', 'Tee ring');
      make.addEventListener('click', () =>
        makeRing({
          radius: clamp(+f.radius.value || 0.1, 0.01, 1),
          plane: f.plane.value,
          turns: clamp(+f.turns.value || 1, 0.25, 6),
          points: +f.points.value || 12,
          clockwise: f.clockwise.value === '1',
          centred: f.centred.value === '1',
          duration: +f.duration.value || 1.5,
          smooth: f.smooth.checked,
        }),
      );
      const close = el('button', '', 'Sulge');
      close.addEventListener('click', () => (box.hidden = true));
      const buttons = el('div', 'fd__buttons');
      buttons.append(make, close);
      body.append(
        row('Raadius (käe pikkust)', f.radius, 'Ringi raadius käe pikkustes (nagu punktide x / y / z)'),
        row('Tasapind', f.plane, 'Mis suunas ring käib: x = paremale, y = üles, z = ettepoole'),
        row('Pöördeid', f.turns, 'Mitu ringi (0,25 = veerand)'),
        row('Punkte pöörde kohta', f.points, 'Mida rohkem punkte, seda ümaram ring (sileda liikumisega piisab 8-st)'),
        row('Suund', f.clockwise),
        row('Alguskoht', f.centred),
        row('Kestus (s)', f.duration, 'Terve ringi aeg sekundites'),
        row('Sile liikumine', f.smooth),
        buttons,
        el('div', 'fd__note', 'Ring asendab selle käe liikumistee punktid (muud kanalid jäävad nulli). Punkte saab hiljem ajajoonel muuta.'),
      );
      box.appendChild(body);
      box.hidden = true;
      document.body.appendChild(box);
      makeDraggable(box, box.querySelector('.panel__bar'), 'viiper.ringPanel', () => [Math.max(0, window.innerWidth - 346), 120]);
      box.addEventListener('keydown', (e) => e.stopPropagation());
      box.addEventListener('keyup', (e) => e.stopPropagation());
      ringPanel = box;
    }
    ringPanel.hidden = false;
  }

  /** Insert a point on the path at fraction r, with the values the path has there. */
  function addPointAt(r) {
    const m = motion();
    if (!m) return;
    pin(m);
    const times = m.times;
    const at = tracePoint(m.path, r, new Array(CHANNELS.length).fill(0), times, m.smooth).map((v) => Math.round(v * 1000) / 1000);
    const next = times.findIndex((t) => t > r);
    const insertAt = next < 0 ? m.path.length - 1 : Math.max(1, next); // never after the last point, which stays the end
    const point = [...at];
    trim(point);
    m.path.splice(insertAt, 0, point);
    m.times.splice(insertAt, 0, Math.round(r * 10000) / 10000);
    framesFollow(() => tweaks.insertFrame(key, insertAt)); // (the new point has the pose the path had there)
    selPoint = insertAt;
    buildTimeline();
    changed();
  }

  // playing: the character restarts the sign; the playhead follows the clock, then the motion is held again at the scrub position
  function startPlay() {
    const m = motion();
    if (!m || !key) return;
    freeze(null);
    play(key);
    const total = MOTION_LEAD + m.duration + 0.6;
    playing = { t0: performance.now(), timer: setTimeout(() => stopPlay(true), total * 1000), raf: 0 };
    const tick = () => {
      if (!playing) return;
      const elapsed = (performance.now() - playing.t0) / 1000;
      playR = clamp((elapsed - MOTION_LEAD) / m.duration, 0, 1);
      drawTimeline();
      playing.raf = requestAnimationFrame(tick);
    };
    tick();
    const btn = tlHead.querySelector('[data-role="play"]');
    if (btn) btn.textContent = '■ Peata';
  }
  function stopPlay(hold) {
    if (!playing) return;
    clearTimeout(playing.timer);
    cancelAnimationFrame(playing.raf);
    playing = null;
    const btn = tlHead.querySelector('[data-role="play"]');
    if (btn) btn.textContent = '▶ Mängi';
    if (hold && key) {
      show(key);
      freeze(scrub);
    }
    drawTimeline();
  }

  new ResizeObserver(() => drawTimeline()).observe(tlBody);

  // ---------------------------------------------------------------- choosing a sign
  /** The user chose a sign here: show it everywhere. */
  function pick(next) {
    setSign(next);
    select(next);
  }
  /** Follow the sign that was picked elsewhere (does not call `select`). */
  function setSign(next) {
    if (!SIGNS[next] || next === key) return;
    stopPlay(false);
    endGesture();
    key = next;
    if (hand === 'L' && !sign()?.left) hand = 'R';
    currentEl.textContent = letterLabel(key);
    renderHand();
    if (isOpen) {
      show(key);
      freeze(scrub);
    }
    refreshBone();
    updateStatus();
    chips.get(key)?.scrollIntoView({ block: 'nearest' });
  }

  // ---------------------------------------------------------------- opening, closing, the height
  const MIN_H = 380;
  const TL_TRACKS_H = TL.ruler + TL.row * CHANNELS.length + 4 + 4; // what hiding the tracks frees (their height and the gap above them)
  let tlCollapsed = !!readLS(UI_KEY)?.tlCollapsed;
  let blocksCollapsed = !!readLS(UI_KEY)?.blocksCollapsed; // with the blocks hidden the dock is only as tall as its bar and timeline
  const shown = () => height - (tlCollapsed ? TL_TRACKS_H : 0); // the dock's height on screen
  const saveUi = () => writeLS(UI_KEY, { open: isOpen, height, tlCollapsed, blocksCollapsed, folded: [...foldedBlocks], order: cardOrder(), boneKind, gizmoMode: gizmo.mode, gizmoSpace: gizmo.space });
  let height = clamp(readLS(UI_KEY)?.height ?? Math.min(500, Math.round(window.innerHeight * 0.58)), MIN_H, Math.max(MIN_H, window.innerHeight * 0.85));
  const applyHeight = () => {
    height = clamp(height, MIN_H, Math.max(MIN_H, window.innerHeight * 0.85));
    dock.style.height = blocksCollapsed ? '' : `${shown()}px`;
    if (isOpen) onLayout(blocksCollapsed ? dock.offsetHeight : shown());
  };
  const showBlocks = () => {
    dock.classList.toggle('fd--noblocks', blocksCollapsed);
    blocksToggle.textContent = blocksCollapsed ? '▸ Seaded' : '▾ Seaded';
  };
  const toggleBlocks = () => {
    blocksCollapsed = !blocksCollapsed;
    showBlocks();
    applyHeight();
    saveUi();
  };
  blocksToggle.addEventListener('click', toggleBlocks);
  // a double click on the empty part of the bar folds / unfolds the blocks, on the timeline's head its tracks (not on a control)
  const onEmpty = (toggle) => (e) => {
    if (!e.target.closest('button, input, select, label, output')) toggle();
  };
  dock.querySelector('.fd__bar').addEventListener('dblclick', onEmpty(toggleBlocks));
  showBlocks();
  // (the timeline's head can change height by itself, e.g. when it wraps: the dock then follows, and so must the scene above it)
  new ResizeObserver(() => isOpen && blocksCollapsed && onLayout(dock.offsetHeight)).observe(dock);
  const showTimeline = () => {
    tlBox.classList.toggle('fd__tl--collapsed', tlCollapsed);
    tlToggle.textContent = tlCollapsed ? '▸ Ajajoon' : '▾ Ajajoon';
  };
  const toggleTimeline = () => {
    tlCollapsed = !tlCollapsed;
    showTimeline();
    applyHeight();
    saveUi();
  };
  tlToggle.addEventListener('click', toggleTimeline);
  dock.querySelector('.fd__tltop').addEventListener('dblclick', (e) => {
    if (!e.target.closest('button, input, select, label, output')) toggleTimeline();
  });
  showTimeline();
  window.addEventListener('resize', applyHeight);
  let resizing = null;
  const grip = dock.querySelector('.fd__resize');
  grip.addEventListener('pointerdown', (e) => {
    grip.setPointerCapture(e.pointerId);
    resizing = { y: e.clientY, h: shown() };
  });
  grip.addEventListener('pointermove', (e) => {
    if (!resizing) return;
    height = resizing.h - (e.clientY - resizing.y) + (tlCollapsed ? TL_TRACKS_H : 0);
    applyHeight();
  });
  const endResize = () => {
    if (!resizing) return;
    resizing = null;
    saveUi();
  };
  grip.addEventListener('pointerup', endResize);
  grip.addEventListener('pointercancel', endResize);

  function open(next) {
    isOpen = true;
    dock.hidden = false;
    launch.hidden = true;
    document.body.classList.add('fd-open');
    markers.visible = true;
    gizmoPanel.hidden = false;
    saveUi();
    applyHeight();
    const start = next ?? currentSign() ?? key ?? letters.find((l) => l !== STANDBY);
    if (start && SIGNS[start]) {
      if (start !== key) setSign(start);
      else renderHand();
      select(start);
    }
    show(key);
    freeze(scrub);
    refreshBone();
    updateStatus();
    drawTimeline();
  }
  function close() {
    base.close();
    if (ringPanel) ringPanel.hidden = true;
    stopPlay(false);
    tweaks.setEditFrame(null); // (the keyframe being edited is let go with the dock; syncFrame takes it up again)
    isOpen = false;
    dock.hidden = true;
    launch.hidden = false;
    document.body.classList.remove('fd-open');
    markers.visible = false;
    gizmoPanel.hidden = true;
    lines.visible = hot.visible = false;
    attachGizmo();
    freeze(null);
    saveUi();
    onLayout(0);
  }

  launch.addEventListener('click', () => open());
  $('close').addEventListener('click', close);

  // ---------------------------------------------------------------- start
  last = snapshot(); // the working copy as restored from the browser: the first edit's "before"
  syncHistory();
  filterChips();
  fillBones();
  refreshBone();
  renderHand();
  onStandby(standbyOn);
  applyHeight();
  if (readLS(UI_KEY)?.open) open();

  return {
    /** True while the character must hold the sign still: the dock is open and the motion is not playing. */
    get holding() {
      return isOpen && !playing;
    },
    setSign,
    /** Keep markers and lines on their bones (markers at a constant on-screen size); call once per frame after everything is posed. */
    update() {
      if (!isOpen) return;
      base.update();
      const text = info();
      if (twistEl.textContent !== text) {
        twistEl.textContent = text;
        twistEl.classList.toggle('fd__warn', text.includes('⚠'));
      }
      const showLines = linesBox.checked;
      lines.visible = hot.visible = showLines;
      let n = 0;
      for (const m of markers.children) {
        if (!m.visible) continue;
        const bone = bones[m.userData.index].bone;
        bone.getWorldPosition(m.position);
        m.scale.setScalar(camera.position.distanceTo(m.position) * 0.006);
        if (showLines && bone.parent?.isBone) n = addSegment(lines, n, bone.parent.getWorldPosition(pa), m.position);
      }
      flush(lines, n);

      let h = 0;
      const e = sel();

      // the bone being turned goes back where the limits hold it (see overflow)
      const turned = adjust.bone; // (the selected bone, or the one the gizmo turns for it)
      if (turned && !turned.shape && key) {
        if (performance.now() > adjust.until) adjust.bone = null;
        else {
          const ex = overflow(turned);
          if (ex.some((x) => Math.abs(x) >= 0.5)) {
            const now = tweaks.get(tweaks.keyOf(turned.name, key), turned.name);
            const rot = now.rot.map((r, i) => (Math.abs(ex[i]) >= 0.5 ? Math.round((r - ex[i]) * 10) / 10 : r));
            writeBone(turned, { rot, pos: now.pos }, e ? editId(e) : `bone:${turned.name}:${key}`);
            refreshBone();
          }
        }
      }
      // the gizmo follows the bone (it only goes its own way while it is held)
      if (e?.bone && !gizmo.dragging) {
        e.bone.getWorldPosition(proxy.position);
        e.bone.getWorldQuaternion(proxy.quaternion);
      }
      if (showLines && e?.bone) {
        e.bone.getWorldPosition(pb);
        if (e.bone.parent?.isBone) h = addSegment(hot, h, e.bone.parent.getWorldPosition(pa), pb);
        for (const child of e.bone.children) if (child.isBone) h = addSegment(hot, h, pb, child.getWorldPosition(pa));
      }
      flush(hot, h);

      // the selected bone's angle from its rest pose, red where the limit is holding it
      if (e && !e.shape) {
        const show = (rows, angle, excess) => {
          for (const row of rows) {
            const text = `${Math.round(angle[row.i])}°`;
            if (row.now.textContent !== text) row.now.textContent = text;
            const held = Math.abs(excess[row.i]) > 0.05;
            row.now.classList.toggle('fd__atlimit', held);
            row.now.title = held ? `Piiratud: ilma piirita oleks ${Math.round(angle[row.i] + excess[row.i])}°` : '';
          }
        };
        show(limitRows, boneLimits.current(e.name), boneLimits.excess(e.name));
        if (!fingerBox.hidden) show(fingerRows, fingerLimits.current(e.name), fingerLimits.excess(e.name));
      }
    },
  };
}
