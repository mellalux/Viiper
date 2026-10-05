import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { askPin } from './pin.js';
import { STANDBY, SIGNS, ORIENT, THUMB_POSES, HAND_CONFIG, MOTION_LEAD, pathTimes, tracePoint } from '../signing/hands.js';
import { GROUPS, tweaksFromSigns } from '../signing/tweaks.js';
import * as defs from '../signing/signDefs.js';

// The fine-tuning window (dev server only): one horizontal dock along the bottom of the screen.
//   top    blocks side by side: pick a sign (search), the hand's pose, the fingers, a single bone, copying between signs
//   bottom the timeline of the sign's motion: one track per channel, the playhead, the points of the path
// What makes a sign (where the hand is held, the finger curls, the motion path) is edited per sign and hand and saved in the
// sign's definition (signDefs.js); the rotation of single bones (arms and fingers, face and lips, body) and the weight of face
// shape keys are tweaks (tweaks.js). Edits apply per sign (face, signing arm), only to the standby pose (the other arm) or
// always (body). Both kinds are kept in localStorage as a working copy until "Salvesta faili" writes them into
// src/data/fingerspelling.json / words.json (dev server only, behind the save PIN).
const STORAGE_KEY = 'viiper.tweaks';
const LEGACY_KEYS = ['viiper.fingerTweaks', 'viiper.boneEditor', 'viiper.boneEditor.collapsed', 'viiper.signEditor', 'viiper.signEditor.collapsed']; // earlier versions' storage; no longer read, just removed
const STANDBY_KEY = 'viiper.standby';
const UI_KEY = 'viiper.fineTuner'; // { open, height }
const TWEAKS_URL = '/__save-sign-tweaks';
const DEFS_URL = '/__save-sign-defs';

const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

// slider range of a bone's rotation, in degrees
const ROT_RANGE = 120;
const SLIDERS = ['Pööre X', 'Pööre Y', 'Pööre Z'];
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
];
// timeline geometry (px)
const TL = { gutter: 84, right: 12, ruler: 20, row: 21 };

const css = `
.fd-launch {
  position: fixed; z-index: 10; top: 16px; right: 16px; padding: 7px 14px; border-radius: 10px; cursor: pointer;
  font: 600 13px system-ui, sans-serif; color: #e8e8ec; background: rgba(24, 24, 28, 0.88); border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45); backdrop-filter: blur(8px);
}
.fd-launch:hover { background: #38383f; }
.fd-launch[hidden] { display: none; }
body.fd-open .letter-panel { display: none; } /* the dock has its own sign list; the bottom of the screen is the dock's */

.fd {
  position: fixed; z-index: 12; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column; box-sizing: border-box;
  font: 13px system-ui, sans-serif; color: #e8e8ec; user-select: none;
  background: rgba(22, 22, 26, 0.96); border-top: 1px solid rgba(255, 255, 255, 0.16);
  box-shadow: 0 -10px 30px rgba(0, 0, 0, 0.5); backdrop-filter: blur(8px);
}
.fd[hidden] { display: none; }
.fd button, .fd select, .fd input[type=number], .fd input[type=search] {
  font: inherit; color: inherit; background: #2c2c33; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px;
}
.fd button { padding: 5px 10px; border-radius: 8px; cursor: pointer; font-size: 12px; }
.fd button:hover:not(:disabled) { background: #38383f; }
.fd button:disabled, .fd input:disabled, .fd select:disabled { opacity: 0.4; cursor: default; }
.fd select { min-width: 0; padding: 3px 6px; }
.fd input[type=number], .fd input[type=search] { min-width: 0; padding: 3px 6px; box-sizing: border-box; }
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
.fd__h { flex: none; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: #c8c8d0; }
.fd__sub { color: #9a9aa5; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 4px; }
.fd__note { color: #9a9aa5; font-size: 12px; line-height: 1.4; }
.fd__note b { color: #ffb347; font-weight: 600; }
.fd__warn { color: #ffb347; }
.fd__row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.fd__row > select { flex: 1; max-width: 190px; }
.fd__buttons { display: flex; gap: 6px; }
.fd__buttons > button { flex: 1; padding: 5px 4px; }
.fd__slider { display: grid; grid-template-columns: 62px 1fr 46px; align-items: center; gap: 6px; }
.fd__slider--axis { grid-template-columns: 14px 1fr 38px; }
.fd__slider input { width: 100%; margin: 0; }
.fd__slider output { text-align: right; font-variant-numeric: tabular-nums; color: #9a9aa5; font-size: 12px; }
.fd__cols { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px 18px; }
.fd__col { display: grid; gap: 3px; align-content: start; }
.fd__fingers { display: grid; grid-template-columns: 92px repeat(3, minmax(0, 1fr)); gap: 3px 10px; align-items: center; }
.fd__fingers > .fd__sub { margin: 0; }
.fd__cell { display: grid; grid-template-columns: 1fr 34px; align-items: center; gap: 4px; }
.fd__cell input { width: 100%; margin: 0; }
.fd__cell output { text-align: right; font-variant-numeric: tabular-nums; color: #9a9aa5; font-size: 11px; }
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
const input = (type, props = {}) => Object.assign(document.createElement('input'), { type }, props);
const round = (v, step) => (step >= 1 ? Math.round(v) : Math.round(v * 100) / 100);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
// compare without accents and case, one character for one: "aitah" finds AITÄH
const fold = (t) => [...t].map((c) => c.normalize('NFD')[0].toUpperCase()).join('');
// short fingerprint of the file's tweaks, to tell which file state a working copy was made against
const fingerprint = (text) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};
// a point's trailing zeros are left out of the file ([0, 0] stays the shortest)
const trim = (pt) => {
  while (pt.length > 2 && pt[pt.length - 1] === 0) pt.pop();
};

/**
 * @param tweaks       the bone / shape-key tweaks (tweaks.js)
 * @param letters      every sign key (letters, words, STANDBY), in the order they are listed
 * @param show         (key) => the character shows that sign right now (no smoothing, the motion held where it is)
 * @param play         (key) => start the sign over, motion playing
 * @param freeze       (fraction | null) => hold the motion at that fraction of its path, or let it play
 * @param select       (key) => show the sign everywhere (mouth, letter panel, text panel)
 * @param onStandby    (on) => whether the hands wait in the standby pose between signs
 * @param handOf       (side 'R' | 'L') => that hand (hands.js): its bones and the pose they are in
 * @param currentSign  () => the key the character is signing now, if any
 * @param info         () => text with the arms' current state (the wrist twist)
 * @param onLayout     (px) => height of the dock when open, 0 when closed: the scene moves up to stay above it
 */
export function createFineTuner({ scene, camera, controls, dom, tweaks, letters, show, play, freeze, select, onStandby, handOf, currentSign = () => null, info = () => '', onLayout = () => {} }) {
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
  let fileState = canon(tweaks.export()); // what the data files hold
  let fileData = JSON.parse(fileState);
  let base = fingerprint(fileState);
  // The working copy remembers which file state it was made against. When the files have changed since (a reset, a git pull,
  // a hand edit) it is stale and dropped, so old tweaks can't come back from the browser.
  const working = readLS(STORAGE_KEY);
  if (working) {
    if (working.base === base && working.data) tweaks.load(working.data);
    else console.info('Dropped a stale working copy of the tweaks (the sign files have changed since it was made).');
  }
  try {
    if (working?.base !== base) localStorage.removeItem(STORAGE_KEY);
    for (const k of LEGACY_KEYS) localStorage.removeItem(k);
  } catch {}

  // The working copy only lives in localStorage while it differs from the files.
  const saveTweaks = () => {
    try {
      if (canon(tweaks.export()) === fileState) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify({ base, data: tweaks.export() }));
    } catch {}
  };
  /** Signs (and '*' for the body) whose bone tweaks differ from the files. */
  const changedTweakKeys = () => {
    const now = tweaks.export();
    const same = (a, b) => canon(a ?? null) === canon(b ?? null);
    const out = [];
    if (!same(now.global, fileData.global)) out.push('keha');
    for (const k of new Set([...Object.keys(now.keys), ...Object.keys(fileData.keys ?? {})])) if (!same(now.keys[k], fileData.keys?.[k])) out.push(k);
    return out;
  };

  let standbyOn = localStorage.getItem(STANDBY_KEY) !== '0';

  // ---------------------------------------------------------------- DOM
  const style = el('style');
  style.textContent = css;
  document.head.appendChild(style);

  const launch = el('button', 'fd-launch', 'Peenhäälestus');
  const dock = el('div', 'fd');
  dock.hidden = true;
  dock.innerHTML = `
    <div class="fd__resize" title="Muuda akna kõrgust"></div>
    <div class="fd__bar">
      <span class="fd__title">Peenhäälestus</span>
      <span class="fd__current" data-role="current"></span>
      <span class="fd__status" data-role="status"></span>
      <button data-role="reset-sign" title="Märgi viipe seaded (käe asend, sõrmed, liikumine) tagasi sellele, mis failis on">Lähtesta märk</button>
      <button data-role="load-file" title="Kustutab brauseri töökoopia ja laeb seaded failidest">Lae failist</button>
      <button data-role="save-file" class="fd__primary" title="Kirjutab muudatused faili fingerspelling.json / words.json (ainult dev-serveris)">Salvesta faili</button>
      <button data-role="close" title="Sulge">✕</button>
    </div>
    <div class="fd__blocks">
      <section class="fd__block" data-role="b-sign" style="width: 260px"></section>
      <section class="fd__block" data-role="b-orient" style="width: 600px"></section>
      <section class="fd__block" data-role="b-fingers" style="width: 460px"></section>
      <section class="fd__block" data-role="b-bone" style="width: 300px"></section>
      <section class="fd__block" data-role="b-copy" style="width: 220px"></section>
    </div>
    <div class="fd__tl">
      <div class="fd__tlhead" data-role="tl-head"></div>
      <div data-role="tl-body"></div>
    </div>`;
  document.body.append(launch, dock);
  const $ = (role) => dock.querySelector(`[data-role="${role}"]`);
  // typing in the fields must not reach the letter shortcuts
  dock.addEventListener('keydown', (e) => e.stopPropagation());
  dock.addEventListener('keyup', (e) => e.stopPropagation());

  const statusEl = $('status');
  const currentEl = $('current');
  const saveBtn = $('save-file');
  const resetSignBtn = $('reset-sign');
  const blockSign = $('b-sign');
  const blockOrient = $('b-orient');
  const blockFingers = $('b-fingers');
  const blockBone = $('b-bone');
  const blockCopy = $('b-copy');
  const tlHead = $('tl-head');
  const tlBody = $('tl-body');
  tlBody.style.minHeight = `${TL.ruler + TL.row * CHANNELS.length + 4}px`; // the same height with or without a motion, so the blocks above don't jump

  // ---------------------------------------------------------------- state
  let isOpen = false;
  let key = null; // the sign being edited
  let hand = 'R'; // which hand's definition the middle blocks and the timeline edit
  let scrub = 0; // where on its path the motion is held while editing (0..1)
  let selPoint = 0; // the selected point of the motion path
  let playing = null; // { t0, timer } while the motion plays
  let playR = 0; // the playhead while playing

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
    statusEl.textContent = parts.length ? `Salvestamata – ${parts.join(' · ')}` : 'Salvestamata muudatusi pole.';
    statusEl.classList.toggle('fd__status--dirty', parts.length > 0);
    statusEl.title = statusEl.textContent;
    saveBtn.disabled = !parts.length;
    resetSignBtn.disabled = !key || !dirtySigns.has(key);
    refreshChips(new Set([...signs, ...bones]));
  }
  /** A sign's definition changed (or its motion): store it, show it, update the marks. */
  function changed() {
    stopPlay(false);
    recheck(key);
    defs.persist();
    show(key);
    freeze(scrub);
    updateStatus();
  }
  function bonesChanged() {
    saveTweaks();
    updateStatus();
  }

  // ---------------------------------------------------------------- block: sign
  const search = input('search', { placeholder: 'Otsi sõrmendit või viipet…', className: 'fd__search', autocomplete: 'off', spellcheck: false });
  const chipBox = el('div', 'fd__chips');
  const chips = new Map(); // key -> button
  const folded = letters.map((l) => [l, fold(letterLabel(l))]);
  for (const l of letters) {
    const b = el('button', `fd__chip${l.length > 1 && l !== STANDBY ? ' fd__chip--word' : ''}`, letterLabel(l));
    b.addEventListener('click', () => pick(l));
    chips.set(l, b);
    chipBox.appendChild(b);
  }
  const noMatch = el('div', 'fd__empty', 'Midagi ei leitud');
  noMatch.hidden = true;
  chipBox.appendChild(noMatch);
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

  const handTabs = el('div', 'fd__buttons');
  const tabR = el('button', '', 'Parem käsi');
  const tabL = el('button', '', 'Vasak käsi');
  handTabs.append(tabR, tabL);
  tabR.addEventListener('click', () => setHand('R'));
  tabL.addEventListener('click', () => setHand('L'));
  const standbyBox = input('checkbox', { checked: standbyOn });
  const standbyRow = el('label', 'fd__row');
  standbyRow.append(el('span', '', 'Ooteasend tähtede vahel'), standbyBox);
  standbyBox.addEventListener('change', () => {
    writeLS(STANDBY_KEY, standbyBox.checked ? '1' : '0');
    onStandby(standbyBox.checked);
  });
  blockSign.append(el('div', 'fd__h', 'Märk'), search, chipBox, handTabs, standbyRow);

  function setHand(next) {
    hand = next;
    renderHand();
  }

  // ---------------------------------------------------------------- building blocks for the sliders
  function slider(parent, label, min, max, step, get, set, unit = '', axis = false) {
    const row = el('label', `fd__slider${axis ? ' fd__slider--axis' : ''}`);
    const range = input('range', { min, max, step });
    const out = el('output');
    const fmt = (v) => `${round(+v, step)}${unit}`;
    range.value = get();
    out.textContent = fmt(range.value);
    range.addEventListener('input', () => {
      set(+range.value);
      out.textContent = fmt(range.value);
      changed();
    });
    row.append(el('span', '', label), range, out);
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
      slider(parent, axis.toUpperCase(), min, max, step, () => effective(field)[i], (v) => {
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
    for (const name of Object.keys(ORIENT)) dirSel.add(new Option(name, name));
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
    slider(colPose, 'Randme painutus', 20, 120, 1, () => p.orient?.maxBend ?? ORIENT[p.dir ?? defaultDir()]?.maxBend ?? HAND_CONFIG.maxWristBend, (v) => setOrient('maxBend', v), '°');
    const own = el('div', 'fd__note', p.orient ? 'Selle viipe oma muudatused põhiasendis: ' + Object.keys(p.orient).join(', ') : 'Põhiasendit pole selle viipe jaoks muudetud.');
    const undo = el('button', '', 'Lähtesta põhiasendile');
    undo.disabled = !p.orient;
    undo.addEventListener('click', () => {
      delete p.orient;
      renderHand();
      changed();
    });
    colPose.append(own, undo);
    vector(colArm, 'Randme asukoht (õlast, käe pikkustes)', 'reach', -1, 1, 0.01);
    vector(colArm, 'Küünarnuki suund', 'pole', -1, 1, 0.05);
    vector(colHand, 'Sõrmede suund', 'finger', -1, 1, 0.05);
    vector(colHand, 'Pöidla suund', 'thumb', -1, 1, 0.05);
    cols.append(colPose, colArm, colHand);
    blockOrient.append(cols, twistEl);
  }

  // what the hand blocks say when there is nothing to edit: standby, no sign, or the left hand not taking part
  function noPartNote(withAction) {
    if (!key) return [el('div', 'fd__note', 'Vali märk.')];
    if (hand === 'L' && !sign().left) {
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
        renderHand();
        changed();
      });
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
      const target = new Map(h.boneList.map((b) => [b, b.quaternion.clone()]));
      const read = h.readPose();
      undoSnapshot = tweaks.export();
      p.thumb ??= 'rest';
      p.dir ??= defaultDir();
      p.curl = read.curl;
      if (read.spread.some((v) => v)) p.spread = read.spread;
      if (read.knuckle.some((v) => v)) p.knuckle = read.knuckle;
      p.orient = { ...read.orient };
      const named = ORIENT[p.dir]?.maxBend ?? HAND_CONFIG.maxWristBend;
      if (read.bend > named) p.orient.maxBend = Math.min(Math.ceil(read.bend) + 1, 120);
      changed(); // shows the sign: the bones are now in its own pose, without tweaks
      let moved = 0;
      for (const e of tweaks.bones) {
        const was = target.get(e.bone);
        if (!was || e.group !== (hand === 'R' ? 'right' : 'left')) continue;
        const d = e.bone.quaternion.clone().invert().multiply(was);
        const eul = new THREE.Euler().setFromQuaternion(d, 'XYZ');
        const rot = [eul.x, eul.y, eul.z].map((r) => Math.round(THREE.MathUtils.radToDeg(r) * 10) / 10);
        const k = tweaks.keyOf(e.name, key);
        tweaks.set(k, e.name, { rot, pos: tweaks.get(k, e.name).pos });
        if (rot.some((r) => r !== 0)) moved++;
      }
      copyUndo.disabled = false;
      copyNote.textContent = `Käe asend ja sõrmed võeti praegusest poosist${moved ? `; ${moved} luu erinevus jäi luude seadetesse` : ''}.`;
      bonesChanged();
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
    for (const name of Object.keys(THUMB_POSES)) thumbSel.add(new Option(name, name));
    thumbSel.value = p.thumb ?? 'rest';
    thumbSel.addEventListener('change', () => {
      thumbSel.blur();
      p.thumb = thumbSel.value;
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
        const range = input('range', { min, max, step, value: p[field]?.[i] ?? 0 });
        const out = el('output', '', String(round(+range.value, step)));
        range.addEventListener('input', () => {
          p[field] ??= [0, 0, 0, 0];
          p[field][i] = +range.value;
          out.textContent = String(round(+range.value, step));
          changed();
        });
        cell.append(range, out);
        grid.appendChild(cell);
      }
    });
    blockFingers.append(thumbRow, grid);
  }

  // ---------------------------------------------------------------- the hand blocks and the timeline together
  function renderHand() {
    tabR.classList.toggle('fd__on', hand === 'R');
    tabL.classList.toggle('fd__on', hand === 'L');
    tabL.disabled = !sign();
    tabR.disabled = !sign();
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
  const boneTitle = el('span', '', 'Luu');
  const boneSliders = SLIDERS.map((label, i) => {
    const row = el('label', 'fd__slider');
    const text = el('span', '', label);
    const range = input('range', { value: 0 });
    const out = el('output', '', '0');
    row.append(text, range, out);
    return { row, text, range, out, i };
  });
  const resetBoneBtn = el('button', '', 'Luu nulli');
  const resetGroupBtn = el('button', '', 'Rühma nulli');
  const copyJsonBtn = el('button', '', 'Kopeeri JSON');
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
    blockBone.append(
      el('div', 'fd__h', 'Luu peenhäälestus'),
      row(el('span', '', 'Rühm'), groupSel),
      pickRow,
      row(el('span', '', 'Peegelda vastasküljele'), mirrorBox),
      row(el('span', '', 'Näita luujooni'), linesBox),
      boneLabel,
      ...boneSliders.map((s) => s.row),
      buttons,
    );
  }
  for (const g of GROUPS) if (g.id !== 'shapes' || tweaks.shapes.length) groupSel.add(new Option(g.label, g.id));
  groupSel.value = tweaks.shapes.length ? 'shapes' : 'face'; // shape keys are how a shape-key face (Character Creator) is tuned

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

  let selected = -1;
  const sel = () => (selected >= 0 ? items[selected] : null);
  const editKey = () => tweaks.keyOf(sel().name, key);

  const fillBones = () => {
    boneSel.replaceChildren(new Option('–', ''));
    items.forEach((e, i) => e.group === groupSel.value && boneSel.add(new Option(e.name, String(i))));
  };

  const refreshBone = () => {
    const e = sel();
    const shapes = groupSel.value === 'shapes';
    const val = e && key ? tweaks.get(editKey(), e.name) : { rot: [0, 0, 0], pos: [0, 0, 0], w: 0 };
    boneTitle.textContent = shapes ? 'Vorm' : 'Luu';
    boneSliders.forEach(({ row, text, range, out, i }) => {
      // a shape key has a single number, its weight: only the first slider is used, relabelled
      row.style.display = shapes && i > 0 ? 'none' : '';
      text.textContent = shapes && i === 0 ? 'Kaal' : SLIDERS[i];
      range.disabled = !e || !key;
      if (shapes) {
        Object.assign(range, { min: -1, max: 1, step: 0.01, value: val.w });
        out.textContent = i === 0 ? val.w.toFixed(2) : '';
        return;
      }
      Object.assign(range, { min: -ROT_RANGE, max: ROT_RANGE, step: 1, value: val.rot[i] });
      out.textContent = `${val.rot[i]}°`;
    });
    resetBoneBtn.disabled = !e || !key;
    mirrorBox.disabled = !e?.mirrorName;
    boneSel.value = e ? String(selected) : '';
    let note = '';
    if (e && key) {
      const k = editKey();
      note = k === key ? '' : e.group === 'body' ? ' (kehtib alati)' : ' (ooteasend)';
    }
    boneLabel.innerHTML = e ? `Valitud: <b>${e.name}</b>${note}` : shapes ? 'Vali vorm nimekirjast' : 'Vali luu nimekirjast või klõpsa markeril';
    markers.children.forEach((m, i) => {
      m.material = i === selected ? pickedMat : idleMat;
      m.visible = bones[i].group === groupSel.value;
    });
  };
  const selectBone = (i) => {
    selected = i;
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
    const target = sel()?.bone ?? bones.find((b) => b.group === (shapes ? 'face' : groupSel.value))?.bone;
    if (!target) return;
    const dist = groupSel.value === 'face' || shapes ? 0.3 : groupSel.value === 'body' ? camera.position.distanceTo(controls.target) : 0.6;
    const dir = camera.position.clone().sub(controls.target).normalize();
    const p = target.getWorldPosition(new THREE.Vector3());
    controls.target.copy(p);
    camera.position.copy(p).addScaledVector(dir, dist);
    controls.update();
  });

  // mirrored bones: rotation about local X keeps its sign, Y and Z flip (Rigify mirrors with local X negated); X position flips
  // (a shape key's weight is the same on both sides)
  const mirrored = (v) => v && ('w' in v ? { w: v.w } : { rot: [v.rot[0], -v.rot[1], -v.rot[2]], pos: [-v.pos[0], v.pos[1], v.pos[2]] });
  const writeBone = (e, value) => {
    tweaks.set(editKey(), e.name, value);
    if (mirrorBox.checked && e.mirrorName) tweaks.set(tweaks.keyOf(e.mirrorName, key), e.mirrorName, mirrored(value));
    bonesChanged();
  };
  boneSliders.forEach(({ range }) =>
    range.addEventListener('input', () => {
      const e = sel();
      if (!e || !key) return;
      const x = boneSliders.map((s) => +s.range.value);
      writeBone(e, e.shape ? { w: x[0] } : { rot: x, pos: tweaks.get(editKey(), e.name).pos }); // the position offset stays as it is
      refreshBone();
    }),
  );
  resetBoneBtn.addEventListener('click', () => {
    const e = sel();
    if (!e || !key) return;
    writeBone(e, null);
    refreshBone();
  });
  resetGroupBtn.addEventListener('click', () => {
    if (!key) return;
    for (const e of items) if (e.group === groupSel.value) tweaks.set(tweaks.keyOf(e.name, key), e.name, null);
    bonesChanged();
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
  dom.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
  dom.addEventListener('pointerup', (e) => {
    if (!isOpen || !down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 4) return;
    const r = dom.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(markers.children.filter((m) => m.visible), false)[0];
    if (hit) selectBone(hit.object.userData.index);
  });

  // ---------------------------------------------------------------- block: copy another sign's bone tweaks onto this one
  const copyFrom = document.createElement('select');
  for (const l of letters) copyFrom.add(new Option(letterLabel(l), l));
  const copyScope = document.createElement('select');
  copyScope.add(new Option('Kogu märk', 'all'));
  copyScope.add(new Option('Valitud rühm', 'group'));
  copyScope.add(new Option('Valitud luu / vorm', 'bone'));
  const copyApply = el('button', '', 'Kopeeri siia');
  const copyUndo = el('button', '', 'Võta tagasi');
  copyUndo.disabled = true;
  const copyNote = el('div', 'fd__note');
  {
    const r1 = el('label', 'fd__row');
    r1.append(el('span', '', 'Märgilt'), copyFrom);
    const r2 = el('label', 'fd__row');
    r2.append(el('span', '', 'Mida'), copyScope);
    const buttons = el('div', 'fd__buttons');
    buttons.append(copyApply, copyUndo);
    blockCopy.append(el('div', 'fd__h', 'Kopeeri teisest märgist'), r1, r2, buttons, copyNote);
  }
  // one step of undo, for copying and for loading from the files
  let undoSnapshot = null;
  copyApply.addEventListener('click', () => {
    const from = copyFrom.value;
    const to = key;
    if (!to) return void (copyNote.textContent = 'Vali kõigepealt märk.');
    if (from === to) return void (copyNote.textContent = 'Vali lähtemärk, mis erineb praegusest.');
    const scope = copyScope.value;
    const e = sel();
    if (scope === 'bone' && !e) return void (copyNote.textContent = 'Vali kõigepealt luu või vorm.');
    // (the mirror twin follows when the mirror box is ticked, as it does for the sliders)
    const names =
      scope === 'bone' ? [e.name, ...(mirrorBox.checked && e.mirrorName ? [e.mirrorName] : [])]
      : items.filter((x) => scope === 'all' || x.group === groupSel.value).map((x) => x.name);
    undoSnapshot = tweaks.export();
    const { copied, cleared } = tweaks.copy(from, to, names);
    bonesChanged();
    refreshBone();
    copyUndo.disabled = false;
    copyNote.textContent = copied || cleared ? `Kopeeritud ${letterLabel(from)} → ${letterLabel(to)}: ${copied} kirjet${cleared ? `, ${cleared} eemaldatud` : ''}.` : `${letterLabel(from)} ja ${letterLabel(to)} ei erine selles ulatuses (või pole siin märgipõhiseid kirjeid).`;
  });
  copyUndo.addEventListener('click', () => {
    if (!undoSnapshot) return;
    tweaks.load(undoSnapshot);
    undoSnapshot = null;
    copyUndo.disabled = true;
    bonesChanged();
    refreshBone();
    copyNote.textContent = 'Tagasi võetud.';
  });

  // ---------------------------------------------------------------- the bar: reset, load, save
  resetSignBtn.addEventListener('click', () => {
    if (!key) return;
    defs.resetSign(key);
    renderHand();
    changed();
  });
  $('load-file').addEventListener('click', () => {
    const dirty = dirtySigns.size || canon(tweaks.export()) !== fileState;
    if (dirty && !confirm('Kustutan brauseri töökoopia ja laen seaded failidest? Salvestamata muudatused lähevad kaduma.')) return;
    undoSnapshot = tweaks.export();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    tweaks.load(tweaksFromSigns());
    for (const k of [...dirtySigns]) defs.resetSign(k);
    recheckAll();
    defs.persist();
    copyUndo.disabled = false;
    copyNote.textContent = 'Laetud failidest, töökoopia kustutatud (tweaks saab tagasi võtta).';
    renderHand();
    refreshBone();
    show(key);
    freeze(scrub);
    updateStatus();
  });
  saveBtn.addEventListener('click', async () => {
    const label = saveBtn.textContent;
    const signKeys = [...dirtySigns];
    const state = tweaks.export();
    const tweaksDirty = canon(state) !== fileState;
    try {
      // is there a save endpoint at all? (only the dev server has one) - checked first so the PIN isn't asked in vain
      const probe = await fetch(TWEAKS_URL).catch(() => null);
      if (!probe?.ok) throw new Error('ainult dev-serveris (npm run dev)');
      const pin = await askPin('fingerspelling.json-i / words.json-i');
      if (pin === null) return;
      const post = async (url, body) => {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Save-Pin': pin }, body: JSON.stringify(body) });
        if (!res.ok) throw new Error(res.status === 404 ? 'ainult dev-serveris (npm run dev)' : await res.text());
      };
      // (the sign definitions go first: each request keeps what the other one writes - tweaks and definitions are separate fields)
      if (signKeys.length) {
        await post(DEFS_URL, { signs: Object.fromEntries(signKeys.map((k) => [k, defs.currentDef(k)])) });
        defs.markSaved(signKeys);
        recheckAll();
      }
      if (tweaksDirty) {
        await post(TWEAKS_URL, state);
        fileState = canon(state);
        fileData = JSON.parse(fileState);
        base = fingerprint(fileState);
        saveTweaks(); // now equal to the files, so the working copy is dropped
      }
      saveBtn.textContent = 'Salvestatud ✓';
    } catch (err) {
      console.warn('Could not save', err);
      saveBtn.textContent = `Ei õnnestunud: ${err.message}`;
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
  let ranges = CHANNELS.map((c) => c.min); // half-range of each track; held still while a dot is dragged
  let drag = null;
  let lastDown = null; // the last press on the tracks' background, for the double click
  let plotW = 600;

  const motion = () => part()?.motion ?? null;
  const shownR = () => (playing ? playR : scrub);
  const xOf = (r) => TL.gutter + r * plotW;
  const yMid = (c) => TL.ruler + c * TL.row + TL.row / 2;
  const half = TL.row / 2 - 3;
  const fit = () => {
    const m = motion();
    if (!m) return;
    ranges = CHANNELS.map((c, i) => Math.max(c.min, 1.15 * Math.max(...m.path.map((pt) => Math.abs(pt[i] ?? 0)))));
  };

  function buildTimeline() {
    stopPlay(false);
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
      else delete p.motion;
      selPoint = 0;
      buildTimeline();
      changed();
    });
    const onRow = el('label');
    onRow.append(on, el('span', '', `Käsi liigub (${hand === 'R' ? 'parem' : 'vasak'})`));
    tlHead.appendChild(onRow);
    if (!m) {
      tlBody.replaceChildren(el('div', 'fd__none', 'Selle viipe käsi ei liigu. Märgi „Käsi liigub“, et lisada liikumise ajajoon.'));
      return;
    }
    const playBtn = el('button', '', '▶ Mängi');
    playBtn.dataset.role = 'play';
    playBtn.addEventListener('click', () => (playing ? stopPlay(true) : startPlay()));
    const dur = input('number', { min: 0.2, max: 10, step: 0.1, value: m.duration });
    dur.addEventListener('input', () => {
      m.duration = Math.max(0.2, +dur.value || 1);
      changed();
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
      changed();
    });
    const staggerLabel = el('label');
    staggerLabel.append(el('span', '', 'Hajutus'), stagger);
    const addBtn = el('button', '', '+ Punkt');
    addBtn.title = 'Lisa punkt mänguoleku kohale (topeltklõps rajal teeb sama)';
    addBtn.addEventListener('click', () => addPointAt(scrub));
    const delBtn = el('button', '', '− Punkt');
    delBtn.title = 'Eemalda valitud punkt';
    delBtn.disabled = m.path.length <= 2;
    delBtn.addEventListener('click', () => {
      m.path.splice(selPoint, 1);
      selPoint = clamp(selPoint, 0, m.path.length - 1);
      buildTimeline();
      changed();
    });
    const pt = el('div', 'fd__pt');
    ptInputs = CHANNELS.map((c, i) => {
      const field = input('number', { step: c.step });
      field.title = c.title;
      field.addEventListener('input', () => {
        const point = m.path[selPoint];
        while (point.length <= i) point.push(0);
        point[i] = Number.isFinite(+field.value) ? +field.value : 0;
        trim(point);
        changed();
        fit();
        drawTimeline();
      });
      const label = el('label');
      label.append(el('span', '', c.id), field);
      pt.appendChild(label);
      return field;
    });
    pt.prepend(el('span', 'fd__note', `Punkt ${selPoint + 1}/${m.path.length}:`));
    pt.title = 'Esimene punkt on viipe enda asend, kui see on [0, 0]';
    tlHead.append(playBtn, timeLabel, durLabel, staggerLabel, addBtn, delBtn, pt);
    tlBody.replaceChildren(svg);
    fit();
    fillPointInputs();
    drawTimeline();
  }

  function fillPointInputs() {
    const point = motion()?.path[selPoint];
    ptInputs.forEach((field, i) => {
      if (document.activeElement !== field) field.value = point?.[i] ?? 0;
    });
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
    const times = pathTimes(m.path);
    const r = shownR();
    const tmp = new Array(CHANNELS.length).fill(0);
    let s = '';
    // tracks: background, zero line, label with the value under the playhead
    const here = tracePoint(m.path, r, [...tmp]);
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
    const samples = Array.from({ length: n + 1 }, (_, k) => tracePoint(m.path, k / n, [...tmp]));
    CHANNELS.forEach((c, i) => {
      const pts = samples.map((v, k) => `${xOf(k / n).toFixed(1)},${(yMid(i) - (v[i] / ranges[i]) * half).toFixed(1)}`).join(' ');
      s += `<polyline points="${pts}" fill="none" stroke="${c.color}" stroke-width="1.5" opacity="0.9" pointer-events="none"/>`;
    });
    // the points: a guide through every track, a dot per channel
    m.path.forEach((pt, p) => {
      const x = xOf(times[p]);
      const on = p === selPoint;
      s += `<line x1="${x}" x2="${x}" y1="${TL.ruler}" y2="${TL.ruler + TL.row * CHANNELS.length}" stroke="${on ? '#ffb347' : 'rgba(255,255,255,0.14)'}" pointer-events="none"/>`;
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
  const setScrub = (r) => {
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
    const step = CHANNELS[drag.c].step;
    const v = drag.v0 - ((e.clientY - drag.y0) / half) * drag.range;
    const point = m.path[drag.p];
    while (point.length <= drag.c) point.push(0);
    point[drag.c] = Math.round(clamp(v, -drag.range * 1.5, drag.range * 1.5) / step) * step;
    point[drag.c] = Math.round(point[drag.c] * 1000) / 1000;
    trim(point);
    ranges[drag.c] = drag.range; // the track keeps its scale until the dot is let go
    changed();
    fillPointInputs();
    drawTimeline();
  });
  const endDrag = () => {
    if (!drag) return;
    const wasDot = drag.type === 'dot';
    drag = null;
    if (wasDot) {
      fit(); // now the track may rescale
      drawTimeline();
    }
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  /** Insert a point on the path at fraction r, with the values the path has there. */
  function addPointAt(r) {
    const m = motion();
    if (!m) return;
    const times = pathTimes(m.path);
    const at = tracePoint(m.path, r, new Array(CHANNELS.length).fill(0)).map((v) => Math.round(v * 1000) / 1000);
    const next = times.findIndex((t) => t > r);
    const insertAt = next < 0 ? m.path.length : Math.max(1, next);
    const point = [...at];
    trim(point);
    m.path.splice(insertAt, 0, point);
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
  let height = clamp(readLS(UI_KEY)?.height ?? Math.min(500, Math.round(window.innerHeight * 0.58)), MIN_H, Math.max(MIN_H, window.innerHeight * 0.85));
  const applyHeight = () => {
    height = clamp(height, MIN_H, Math.max(MIN_H, window.innerHeight * 0.85));
    dock.style.height = `${height}px`;
    if (isOpen) onLayout(height);
  };
  window.addEventListener('resize', applyHeight);
  let resizing = null;
  const grip = dock.querySelector('.fd__resize');
  grip.addEventListener('pointerdown', (e) => {
    grip.setPointerCapture(e.pointerId);
    resizing = { y: e.clientY, h: height };
  });
  grip.addEventListener('pointermove', (e) => {
    if (!resizing) return;
    height = resizing.h - (e.clientY - resizing.y);
    applyHeight();
  });
  const endResize = () => {
    if (!resizing) return;
    resizing = null;
    writeLS(UI_KEY, { open: isOpen, height });
  };
  grip.addEventListener('pointerup', endResize);
  grip.addEventListener('pointercancel', endResize);

  function open(next) {
    isOpen = true;
    dock.hidden = false;
    launch.hidden = true;
    document.body.classList.add('fd-open');
    markers.visible = true;
    writeLS(UI_KEY, { open: true, height });
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
    stopPlay(false);
    isOpen = false;
    dock.hidden = true;
    launch.hidden = false;
    document.body.classList.remove('fd-open');
    markers.visible = false;
    lines.visible = hot.visible = false;
    writeLS(UI_KEY, { open: false, height });
    freeze(null);
    onLayout(0);
  }
  launch.addEventListener('click', () => open());
  $('close').addEventListener('click', close);

  // ---------------------------------------------------------------- start
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
    open,
    close,
    get isOpen() {
      return isOpen;
    },
    setSign,
    /** Keep markers and lines on their bones (markers at a constant on-screen size); call once per frame after everything is posed. */
    update() {
      if (!isOpen) return;
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
      if (showLines && e?.bone) {
        e.bone.getWorldPosition(pb);
        if (e.bone.parent?.isBone) h = addSegment(hot, h, e.bone.parent.getWorldPosition(pa), pb);
        for (const child of e.bone.children) if (child.isBone) h = addSegment(hot, h, pb, child.getWorldPosition(pa));
      }
      flush(hot, h);
    },
  };
}
