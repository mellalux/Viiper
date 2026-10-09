import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { makeDraggable } from './draggable.js';
import { SIGNS, STANDBY, ORIENT, HAND_CONFIG } from '../signing/hands.js';
import { orientLabel } from './labels.js';
import * as orients from '../signing/orients.js';

// The base-pose mode of the fine-tuning window (signed-in editors only): edits one named orient (shared.json, `orient`: where a hand is
// held and which way it points) for every sign that uses it, instead of one sign's own changes to it. The hand is shown in the orient
// with the fingers of the sign being edited, without that sign's own changes to the orient, without its bone tweaks (on that arm), and
// the collision guards are the window's to switch off (they would push the hand away from where the handles are).
// Three handles move the numbers of the orient in the scene: the wrist's place (`reach`: a point in the scene, from the shoulder, in
// arm lengths), the elbow (`pole`: which way it points) and the hand's turn (`finger` and `thumb`: the hand's own axes). The fields in the
// panel hold the same numbers. Changes are a working copy in this browser (signing/orients.js) until "Salvesta" saves the orients to the server, for everybody.
const css = `
/* a tall panel stays on the screen: the title bar stays, the body scrolls (the panel is dragged lower only as far as it fits) */
.fd-base { max-height: calc(100vh - 66px); display: flex; flex-direction: column; }
.fd-base > .fd-gizmo__body { min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.fd-base__chips { display: flex; flex-wrap: wrap; gap: 4px; }
.fd-base__chips button { padding: 2px 7px; min-width: 0; }
.fd-base .fd__sub { margin-top: 2px; }
.fd-base select { min-width: 0; font: inherit; color: inherit; background: #2c2c33; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; padding: 3px 6px; }
.fd-base input[type=text] { min-width: 0; width: 100%; box-sizing: border-box; font: inherit; color: inherit; background: #2c2c33; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; padding: 3px 6px; user-select: text; }
`;

const VECTORS = [
  ['reach', 'Randme asukoht', 0.01, 'Randme sihtpunkt õlast, käe pikkustes (x: vaataja paremale, y: üles, z: ette; parem käsi, vasak on peegelpilt)'],
  ['pole', 'Küünarnuki suund', 0.05, 'Mille poole küünarnukk osutab (suund, pikkus ei loe)'],
  ['finger', 'Sõrmede suund', 0.05, 'Mille poole sõrmed osutavad (suund, pikkus ei loe)'],
  ['thumb', 'Pöidla suund', 0.05, 'Mille poole pöial osutab (sõrmede suuna suhtes risti võetuna)'],
];
const TARGETS = [
  ['reach', 'Liiguta kätt', 'Nooled liigutavad randme sihtpunkti (käsi liigub ja keerab küünarnukiga kaasa)'],
  ['pole', 'Liiguta küünarnukki', 'Nooled liigutavad küünarnukki: küünarnuki suund on see, kuhu sa selle lohistad'],
  ['hand', 'Pööra kätt', 'Rõngad pööravad kätt randme ümber: sõrmede ja pöidla suund'],
];
const AXES = ['x', 'y', 'z'];
const el = (tag, className, text) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
};
const round3 = (v) => Math.round(v * 1000) / 1000;

/**
 * @param tweaks        the bone tweaks (the arm being shown is left out of them while the mode is open)
 * @param handOf        (side 'R' | 'L') => that hand (hands.js)
 * @param getKey        () => the sign being edited (its fingers are what the hand shows)
 * @param pickSign      (key) => edit that sign instead (the hand shows the orient with its fingers)
 * @param refreshHands  () => show the sign again, as it is now
 * @param onEdit        (id) => an orient changed (`id`: one undo step for a gesture)
 * @param onEnd         () => the gesture ended (the next edit is a new undo step)
 * @param onToggle      (open) => the mode was opened / closed
 * @param onBones       (on, orient, side) => the dock's bone tools edit (on) or stop editing the arm's bones for that base pose
 */
export function createBasePose({ scene, camera, controls, dom, tweaks, handOf, getKey, pickSign, refreshHands, onEdit, onEnd, onToggle, onBones }) {
  const style = el('style');
  style.textContent = css;
  document.head.appendChild(style);

  let active = false;
  let name = null; // the orient being edited
  let side = 'R'; // the hand that shows it
  let target = 'reach';
  let space = 'local';
  let boneEdit = false; // the dock's bone tools edit the arm's bones for this base pose (see setBoneEdit)

  // ---------------------------------------------------------------- the scene: the gizmo on a proxy, two dots and the arm's line
  const proxy = new THREE.Object3D();
  scene.add(proxy);
  const gizmo = new TransformControls(camera, dom);
  gizmo.setSize(0.9);
  gizmo.detach();
  scene.add(gizmo.getHelper());
  gizmo.addEventListener('dragging-changed', (ev) => {
    controls.enabled = !ev.value; // the orbit must not turn the view with it
    if (!ev.value) onEnd();
  });
  const marks = new THREE.Group();
  marks.visible = false;
  scene.add(marks);
  const dotGeo = new THREE.SphereGeometry(1, 12, 8);
  const dot = (color) => {
    const m = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 }));
    m.renderOrder = 999;
    marks.add(m);
    return m;
  };
  const reachDot = dot(0xffb347); // where the wrist is aimed
  const elbowDot = dot(0x5fd0a0); // where the elbow is
  const armGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
  const armLine = new THREE.Line(armGeo, new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.55 }));
  armLine.renderOrder = 998;
  armLine.frustumCulled = false;
  marks.add(armLine);

  // ---------------------------------------------------------------- the panel
  const panel = el('div', 'panel fd-gizmo fd-base');
  panel.hidden = true;
  panel.innerHTML = '<div class="panel__bar"><span class="panel__title">Põhiasend</span><span class="panel__grip">⋮⋮</span></div>';
  const body = el('div', 'fd-gizmo__body');
  panel.appendChild(body);
  document.body.appendChild(panel);
  makeDraggable(panel, panel.querySelector('.panel__bar'), 'viiper.basePosePanel', () => [Math.max(0, window.innerWidth - 346), 58]);
  // (as in the dock: typing in the fields must not reach the letter shortcuts, and a field being let go ends the undo gesture)
  panel.addEventListener('keydown', (e) => e.stopPropagation());
  panel.addEventListener('keyup', (e) => e.stopPropagation());
  panel.addEventListener('change', () => onEnd());
  panel.addEventListener('focusout', () => onEnd());

  const nameSel = document.createElement('select');
  for (const n of orients.names()) nameSel.add(new Option(orientLabel(n), n));
  const nameRow = el('label', 'fd__row');
  nameRow.append(el('span', '', 'Põhiasend'), nameSel);
  nameSel.addEventListener('change', () => {
    nameSel.blur();
    onEnd();
    name = nameSel.value;
    applyPreview();
    syncBones();
    refresh();
  });
  const noteField = Object.assign(document.createElement('input'), { type: 'text', maxLength: 240, placeholder: 'Märkus (kirjeldus)' });
  noteField.addEventListener('input', () => {
    const next = orients.get(name);
    if (noteField.value) next.note = noteField.value;
    else delete next.note;
    orients.set(name, next);
    onEdit(`orient:${name}:note`);
    refresh(true);
  });
  // which hand shows the orient (the left one mirrored): chosen here, whatever hand the dock's tabs are on
  const sideBtns = [['R', 'Parem käsi'], ['L', 'Vasak käsi']].map(([s, label]) => {
    const b = el('button', '', label);
    b.addEventListener('click', () => chooseSide(s));
    return b;
  });
  const sideRow = el('div', 'fd__buttons');
  sideRow.append(...sideBtns);
  const handLine = el('div', 'fd__note');
  const targetBtns = TARGETS.map(([id, label, title]) => {
    const b = el('button', '', label);
    b.title = title;
    b.addEventListener('click', () => setTarget(id));
    return b;
  });
  const targetRow = el('div', 'fd__buttons');
  targetRow.append(...targetBtns);
  const targetHint = el('div', 'fd__note');
  const elbowLine = el('div', 'fd__note');
  const boneBtn = el('button', '', 'Muuda keha ja luid (küünarnukk jne)…');
  boneBtn.title = 'Kogu keha, luustik ja nägu tavaliste luuvahenditega (gizmo, liugurid, Keha / Nägu): kehtib kõigile märkidele, mis seda põhiasendit kasutavad, ja liitub märgi enda luuseadetega. Aitab nt deformeerunud küünarnuki vastu. Teise käe luud jäävad märgi enda seadeks.';
  boneBtn.addEventListener('click', () => setBoneEdit(!boneEdit));
  // each limb back to its pose in the model's file (the GLB: the bones' rest pose, shape keys 0), whatever the hand's IK or the signs'
  // own tweaks do with it; the base pose keeps the difference. (Single bones and groups go back with the dock's "Luu nulli" / "Rühma nulli".)
  const LIMBS = [
    ['arm', 'Käsi', 'Selle käe luud (õlg, küünarnukk, randme, sõrmed) GLB-faili algasendisse', (e) => e.armSide === side],
    ['body', 'Keha', 'Keha luud (selg, kael, pea) GLB-faili algasendisse', (e) => !e.armSide && e.group === 'body'],
    ['face', 'Nägu', 'Näo luud ja näo vormid GLB-faili algasendisse (vormid 0)', (e) => e.group === 'face' || e.group === 'shapes'],
    ['all', 'Kõik', 'Selle käe, keha ja näo kõik luud ja vormid GLB-faili algasendisse', (e) => e.armSide === side || !e.armSide],
  ];
  const limbRow = el('div', 'fd__buttons');
  limbRow.hidden = true;
  for (const [id, label, title, pick] of LIMBS) {
    const b = el('button', '', `${label} algasendisse`);
    b.title = title;
    b.addEventListener('click', () => {
      onEnd();
      tweaks.restPose(name, pick);
      onEdit(`orient:${name}:limb-${id}`);
      onEnd();
      refresh();
    });
    limbRow.appendChild(b);
  }
  const limbHead = el('div', 'fd__sub', 'Liikme algasend (mudeli GLB-faili asend)');
  limbHead.hidden = true;
  const spaceBtn = el('button', '');
  spaceBtn.title = 'Käe pööramise gizmo teljed: käe enda telgedes või maailma telgedes (vahetamiseks klõpsa)';
  spaceBtn.addEventListener('click', () => {
    space = space === 'local' ? 'world' : 'local';
    setTarget(target);
  });

  // the numbers: three fields per vector
  const fields = {}; // name -> [x, y, z] inputs
  const vectorRows = VECTORS.map(([field, label, step, title]) => {
    const row = el('label', 'fd__xyz');
    row.title = title;
    const inputs = AXES.map((axis, i) => {
      const f = Object.assign(document.createElement('input'), { type: 'number', min: -1, max: 1, step });
      f.title = `${label} ${axis.toUpperCase()}`;
      f.addEventListener('input', () => {
        if (f.value === '' || !Number.isFinite(+f.value)) return;
        const next = orients.get(name);
        const v = [...(next[field] ?? (field === 'pole' ? HAND_CONFIG.pole : [0, 0, 0]))];
        v[i] = Math.min(Math.max(round3(+f.value), -1), 1);
        next[field] = v;
        orients.set(name, next);
        onEdit(`orient:${name}:${field}${i}`);
        refresh(true);
      });
      return f;
    });
    fields[field] = inputs;
    row.append(el('span', '', label), ...inputs);
    // a slider under each number: dragging types the value into the field (its own listener does the rest), typing moves the slider
    const sliders = el('div', 'fd__xyz fd__sliders');
    sliders.append(
      el('span'),
      ...inputs.map((f) => {
        const s = Object.assign(document.createElement('input'), { type: 'range', min: -1, max: 1, step: 0.01, value: 0 });
        s.title = f.title;
        s.addEventListener('input', () => {
          f.value = round3(+s.value);
          f.dispatchEvent(new Event('input', { bubbles: true }));
        });
        f.addEventListener('input', () => {
          if (f.value !== '' && Number.isFinite(+f.value) && document.activeElement !== s) s.value = f.value;
        });
        f.sliderEl = s;
        return s;
      }),
    );
    const group = el('div');
    group.style.display = 'grid';
    group.append(row, sliders);
    return group;
  });
  const bendField = Object.assign(document.createElement('input'), { type: 'number', min: 20, max: 120, step: 1 });
  bendField.title = 'Kui kaugele sõrmed võivad küünarvarre suunast randmest kõrvale painduda (°)';
  bendField.addEventListener('input', () => {
    if (bendField.value === '' || !Number.isFinite(+bendField.value)) return;
    const next = orients.get(name);
    next.maxBend = Math.min(Math.max(Math.round(+bendField.value), 20), 120);
    orients.set(name, next);
    onEdit(`orient:${name}:maxBend`);
    refresh(true);
  });
  const bendRow = el('label', 'fd__row');
  bendRow.append(el('span', '', 'Randme painutus °'), bendField);

  const usedHead = el('div', 'fd__sub');
  const chipBox = el('div', 'fd-base__chips');
  const overrideNote = el('div', 'fd__note');
  const resetBtn = el('button', '', 'Lähtesta algandmetele');
  resetBtn.title = 'Selle põhiasendi numbrid tagasi sellele, mis shared.json-is on';
  resetBtn.addEventListener('click', () => {
    onEnd();
    orients.reset(name);
    tweaks.clearPose(name); // (and the bone tweaks of the base pose)
    onEdit(`orient:${name}:reset`);
    onEnd();
    refresh();
  });
  const copyBtn = el('button', '', 'Kopeeri JSON');
  copyBtn.addEventListener('click', async () => {
    const text = JSON.stringify({ [name]: orients.get(name) });
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = 'Kopeeritud ✓';
    } catch {
      console.log(text);
      copyBtn.textContent = 'Vaata konsooli';
    }
    setTimeout(() => (copyBtn.textContent = 'Kopeeri JSON'), 1500);
  });
  const doneBtn = el('button', 'fd__on', 'Valmis');
  doneBtn.addEventListener('click', () => close());
  const buttons = el('div', 'fd__buttons');
  buttons.append(resetBtn, copyBtn, doneBtn);
  const info = el('div', 'fd__note', 'Muudatus kehtib kõigile märkidele, mis seda põhiasendit kasutavad. „Salvesta“ viib põhiasendi serverisse, siis näevad seda kõik; enne seda on see ainult sinu brauseris. Muudatused, mis põhiasend teeb keha ja luudega („Muuda keha ja luid“), jäävad ainult sinu brauserisse.');
  body.append(nameRow, noteField, sideRow, handLine, targetRow, targetHint, spaceBtn, ...vectorRows, bendRow, elbowLine, boneBtn, limbHead, limbRow, usedHead, chipBox, overrideNote, buttons, info);

  // ---------------------------------------------------------------- what the panel shows
  /** The signs that hold their hand in this orient, and those of them that change it for themselves. */
  function usage(n) {
    const using = [];
    const overriding = [];
    for (const [k, s] of Object.entries(SIGNS)) {
      const parts = [['', s, k === STANDBY ? 'ready' : 'up']];
      parts.push(s.left ? ['L', s.left, 'up'] : k === STANDBY ? ['L', { dir: 'relaxed' }, 'relaxed'] : null);
      for (const part of parts) {
        if (!part || (part[1].dir ?? part[2]) !== n) continue;
        const label = part[0] ? `${k} (vasak)` : k;
        using.push({ key: k, label });
        if (part[1].orient && Object.keys(part[1].orient).length) overriding.push(`${label}: ${Object.keys(part[1].orient).join(', ')}`);
      }
    }
    return { using, overriding };
  }

  /** Fill the fields from the orient (`soft`: not the one being typed in; the chips and the like stay as they are). */
  function refresh(soft = false) {
    if (!active) return;
    const o = ORIENT[name] ?? {};
    nameSel.value = name;
    if (document.activeElement !== noteField) noteField.value = o.note ?? '';
    for (const [field] of VECTORS) {
      const v = o[field] ?? (field === 'pole' ? HAND_CONFIG.pole : [0, 0, 0]);
      fields[field].forEach((f, i) => {
        if (document.activeElement !== f) f.value = round3(v[i]);
        if (document.activeElement !== f.sliderEl) f.sliderEl.value = f.value; // (the gizmo moves the numbers too)
      });
    }
    if (document.activeElement !== bendField) bendField.value = o.maxBend ?? HAND_CONFIG.maxWristBend;
    resetBtn.disabled = !orients.isChanged(name) && !tweaks.poseNames().includes(name);
    if (soft) return;
    sideBtns.forEach((b, i) => b.classList.toggle('fd__on', ['R', 'L'][i] === side));
    const fingers = side === 'L' && !SIGNS[getKey()]?.left ? 'ooteasendi' : `märgi ${getKey() ?? '–'}`;
    handLine.textContent = `${side === 'R' ? 'Parem' : 'Vasak'} käsi, sõrmed: ${fingers}. Märgi enda muudatused sellest asendist ja selle käe luude seaded on siin kõrvale jäetud.`;
    targetBtns.forEach((b, i) => b.classList.toggle('fd__on', TARGETS[i][0] === target));
    targetHint.textContent = `Praegu: ${TARGETS.find(([id]) => id === target)[2]}.`;
    spaceBtn.hidden = target !== 'hand';
    spaceBtn.textContent = space === 'local' ? 'Käe telgedes' : 'Maailma telgedes';
    const { using, overriding } = usage(name);
    usedHead.textContent = `Märgid, mis seda asendit kasutavad (${using.length}) – klõpsa, et nende sõrmedega näha`;
    chipBox.replaceChildren(
      ...using.slice(0, 40).map(({ key: k, label }) => {
        const b = el('button', k === getKey() ? 'fd__on' : '', label);
        b.addEventListener('click', () => pickSign(k));
        return b;
      }),
    );
    if (using.length > 40) chipBox.append(el('span', 'fd__note', `… ja ${using.length - 40} veel`));
    overrideNote.textContent = overriding.length ? `Need märgid muudavad seda asendit enda jaoks (nende muudatused jäävad peale, siin neid ei näe): ${overriding.join('; ')}` : '';
  }

  function setTarget(next) {
    target = next;
    gizmo.setMode(target === 'hand' ? 'rotate' : 'translate');
    gizmo.setSpace(target === 'hand' ? space : 'world');
    if (active) gizmo.attach(proxy);
    refresh();
  }

  // ---------------------------------------------------------------- showing the orient on the hand
  function applyPreview() {
    for (const s of ['R', 'L']) {
      const h = handOf(s);
      if (h) h.preview = active && s === side ? name : null;
    }
    tweaks.suspendArm(active ? side : null, name);
    refreshHands();
  }

  function chooseSide(next) {
    if (!active || next === side) return;
    onEnd();
    side = next;
    applyPreview();
    syncBones();
    refresh();
  }

  // ---------------------------------------------------------------- the whole body (the elbow's rotation and so on), for this base pose
  // The usual bone gizmo and fields of the dock (fineTuner.js) edit any bone and shape; what is changed goes to the base pose (tweaks.js,
  // `poses`) and is added to the own tweaks of every sign that holds the hand in it (the arm being shown, body, face and shapes).
  function setBoneEdit(on) {
    boneEdit = on;
    boneBtn.classList.toggle('fd__on', on);
    boneBtn.textContent = on ? 'Keha ja luude muutmine: valmis (tagasi käepidemete juurde)' : 'Muuda keha ja luid (küünarnukk jne)…';
    marks.visible = active && !on;
    limbHead.hidden = limbRow.hidden = !on;
    if (on) gizmo.detach();
    else if (active) gizmo.attach(proxy);
    syncBones();
    refresh();
  }
  /** (Re)aim the dock's bone tools at the bones of this base pose and arm. */
  function syncBones() {
    if (active) onBones(boneEdit, name, side);
  }

  const mx = (a, sgn) => [a[0] * sgn, a[1], a[2]];
  const p = new THREE.Vector3();
  const qq = new THREE.Quaternion();
  const reachPoint = (f, o, out) => out.set(...mx(o.reach ?? [0, 0, 0], f.sgn)).multiplyScalar(f.length).add(f.shoulder);

  // what the gizmo was dragged to, turned back into the orient's numbers
  gizmo.addEventListener('objectChange', () => {
    if (!active) return;
    const h = handOf(side);
    if (!h) return;
    const f = h.frame;
    const next = orients.get(name);
    proxy.getWorldPosition(p);
    proxy.getWorldQuaternion(qq);
    if (target === 'reach') {
      next.reach = mx(p.clone().sub(f.shoulder).divideScalar(f.length).toArray(), f.sgn).map(round3);
    } else if (target === 'pole') {
      const u = reachPoint(f, next, new THREE.Vector3()).sub(f.shoulder).normalize();
      const d = p.clone().sub(f.shoulder);
      d.addScaledVector(u, -d.dot(u));
      if (d.lengthSq() < 1e-8) return;
      next.pole = mx(d.normalize().toArray(), f.sgn).map(round3);
    } else {
      const r = f.fromQuat(qq);
      next.finger = r.finger.map(round3);
      next.thumb = r.thumb.map(round3);
    }
    orients.set(name, next);
    onEdit(`orient:${name}:${target}`);
    refresh(true);
  });

  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  // ---------------------------------------------------------------- opening, closing
  function open(nextName, nextSide) {
    if (!orients.names().includes(nextName)) return;
    name = nextName;
    side = nextSide;
    if (!active) {
      active = true;
      panel.hidden = false;
      marks.visible = true;
      onToggle(true);
      gizmo.setMode(target === 'hand' ? 'rotate' : 'translate');
      gizmo.setSpace(target === 'hand' ? space : 'world');
      gizmo.attach(proxy);
    }
    applyPreview();
    refresh();
  }
  function close() {
    if (!active) return;
    onEnd();
    if (boneEdit) {
      boneEdit = false;
      boneBtn.classList.remove('fd__on');
      boneBtn.textContent = 'Muuda keha ja luid (küünarnukk jne)…';
      limbHead.hidden = limbRow.hidden = true;
      onBones(false, name, side);
    }
    active = false;
    panel.hidden = true;
    marks.visible = false;
    gizmo.detach();
    controls.enabled = true;
    applyPreview();
    onToggle(false);
  }

  return {
    get active() {
      return active;
    },
    /** The panel's element (the dock puts its own gizmo panel beside it while the bone tools are up, not under it). */
    get panelEl() {
      return panel;
    },
    /** The mode is open and the handles (not the bone tools) are what is edited: the dock puts its own bone gizmo and markers away. */
    get handles() {
      return active && !boneEdit;
    },
    get boneEdit() {
      return active && boneEdit;
    },
    get name() {
      return name;
    },
    open,
    close,
    /** The hand being edited changed (the other tab, or a sign without a left hand): show the orient on that one. */
    setSide(next) {
      if (!active || next === side) return;
      side = next;
      applyPreview();
      syncBones();
      refresh();
    },
    /** The sign, the signs' definitions or the orients changed from outside (a different sign, undo): redraw the panel. */
    refresh: () => refresh(),
    /** Keep the handles on the hand; call once per frame after everything is posed. */
    update() {
      if (!active) return;
      const h = handOf(side);
      if (!h) return;
      const f = h.frame;
      const o = ORIENT[name];
      if (!o) return;
      // how sharply the elbow is bent (the angle between the upper arm and the forearm): a very sharp bend crumples the skin there
      const angle = Math.round(THREE.MathUtils.radToDeg(tmp.copy(f.shoulder).sub(f.elbow).angleTo(tmp2.copy(f.wrist).sub(f.elbow))));
      const sharp = angle < 50;
      const text = `Küünarnuki nurk: ${angle}°${sharp ? ' – terav, nahk võib kortsuda: liiguta kätt õlast kaugemale või pööra küünarnukki' : ''}`;
      if (elbowLine.textContent !== text) {
        elbowLine.textContent = text;
        elbowLine.classList.toggle('fd__warn', sharp);
      }
      if (boneEdit) return;
      const wrist = reachPoint(f, o, tmp);
      if (!gizmo.dragging) {
        if (target === 'pole') proxy.position.copy(f.elbow);
        else proxy.position.copy(wrist);
        if (target === 'hand') proxy.quaternion.copy(f.quat({ finger: o.finger, thumb: o.thumb }));
        else proxy.quaternion.identity();
      }
      reachDot.position.copy(wrist);
      elbowDot.position.copy(f.elbow);
      for (const d of [reachDot, elbowDot]) d.scale.setScalar(camera.position.distanceTo(d.position) * 0.006);
      armGeo.attributes.position.setXYZ(0, f.shoulder.x, f.shoulder.y, f.shoulder.z);
      armGeo.attributes.position.setXYZ(1, f.elbow.x, f.elbow.y, f.elbow.z);
      armGeo.attributes.position.setXYZ(2, wrist.x, wrist.y, wrist.z);
      armGeo.attributes.position.needsUpdate = true;
    },
  };
}
