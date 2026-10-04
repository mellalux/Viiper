import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { makeDraggable } from './draggable.js';
import { askPin } from './pin.js';
import { STANDBY } from '../signing/hands.js';
import { GROUPS, tweaksFromSigns } from '../signing/tweaks.js';

// Fine-tuning panel for every bone (arms and fingers, face and lips, body): tick "Muuda märki" to hold a sign,
// pick a group and a bone (from the list or by clicking its marker), then dial its rotation with the sliders. (A bone's position offset, "pos" in the data, is no longer edited here, but tweaks that
// have one keep it.)
// Edits apply per sign (face, signing arm), only to the standby pose (the other arm) or always (body) - see tweaks.js.
// src/data/fingerspelling.json holds the committed tweaks; edits live in localStorage as a working copy until "Salvesta faili"
// writes them back into that file (dev server only).
const STORAGE_KEY = 'viiper.tweaks';
const LEGACY_KEY = 'viiper.fingerTweaks'; // the first version's storage; no longer read, just removed
const STANDBY_KEY = 'viiper.standby';
const POS_KEY = 'viiper.boneEditor';
const SAVE_URL = '/__save-sign-tweaks';

const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

// slider range: rotation in degrees
const ROT_RANGE = 120;
const SLIDERS = [['Pööre X', '°'], ['Pööre Y', '°'], ['Pööre Z', '°']];

const css = `
.bone-editor {
  position: fixed; z-index: 10; width: 280px; max-height: calc(100vh - 32px); display: flex; flex-direction: column;
  border-radius: 12px; user-select: none; touch-action: none;
  font: 13px system-ui, sans-serif; color: #e8e8ec;
  background: rgba(24, 24, 28, 0.88); border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5); backdrop-filter: blur(8px);
}
.bone-editor__bar {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex: none;
  padding: 8px 12px; cursor: grab; border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.bone-editor.is-dragging .bone-editor__bar { cursor: grabbing; }
.bone-editor__title { font-weight: 600; letter-spacing: 0.02em; }
.bone-editor__grip { color: #888; letter-spacing: 2px; }
.bone-editor__body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; padding: 10px 12px 12px; overflow-y: auto; overflow-x: hidden; }
.bone-editor__row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.bone-editor select {
  min-width: 0; max-width: 170px; font: inherit; color: inherit; background: #2c2c33;
  border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; padding: 3px 6px;
}
.bone-editor__pick { flex: 1; min-width: 0; }
.bone-editor__pick select { flex: 1; max-width: none; }
.bone-editor__bone { color: #9a9aa5; font-size: 12px; min-height: 16px; }
.bone-editor__bone b { color: #ffb347; font-weight: 600; }
.bone-editor__sep { color: #9a9aa5; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 2px; }
.bone-editor__slider { display: grid; grid-template-columns: 76px 1fr 56px; align-items: center; gap: 6px; }
.bone-editor__slider input { width: 100%; margin: 0; }
.bone-editor__slider output { text-align: right; font-variant-numeric: tabular-nums; color: #9a9aa5; }
.bone-editor__buttons { display: flex; gap: 6px; }
.bone-editor button {
  flex: 1; padding: 6px 4px; border-radius: 8px; cursor: pointer; font: inherit; font-size: 12px;
  color: #e8e8ec; background: #2c2c33; border: 1px solid rgba(255, 255, 255, 0.1);
}
.bone-editor button:hover:not(:disabled) { background: #38383f; }
.bone-editor button:disabled, .bone-editor input:disabled, .bone-editor select:disabled { opacity: 0.4; cursor: default; }
`;

// short fingerprint of the file's tweaks, to tell which file state a working copy was made against
const fingerprint = (text) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};

export function createBoneEditor({ scene, camera, controls, dom, tweaks, letters, onLetter, onStandby, onOpenSignEditor = null, twistAngles = null }) {
  let fileState = canon(tweaks.export()); // what src/data/fingerspelling.json holds
  const readLS = (k) => {
    try {
      return JSON.parse(localStorage.getItem(k));
    } catch {
      return null;
    }
  };
  let base = fingerprint(fileState);
  // The working copy remembers which file state it was made against. When fingerspelling.json has changed since (a reset, a
  // git pull, a hand edit) it is stale and dropped, so old tweaks can't come back from the browser.
  const working = readLS(STORAGE_KEY);
  if (working) {
    if (working.base === base && working.data) tweaks.load(working.data);
    else console.info('Dropped a stale working copy of the tweaks (fingerspelling.json has changed since it was made).');
  }
  try {
    if (working?.base !== base) localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch {}

  // The working copy only lives in localStorage while it differs from the file.
  const save = () => {
    try {
      if (canon(tweaks.export()) === fileState) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify({ base, data: tweaks.export() }));
    } catch {}
  };
  let standbyOn = true;
  try {
    standbyOn = localStorage.getItem(STANDBY_KEY) !== '0';
  } catch {}

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.className = 'bone-editor';
  panel.innerHTML = `
    <div class="bone-editor__bar">
      <span class="bone-editor__title">Peenhäälestus</span>
      <span class="bone-editor__grip">⋮⋮</span>
    </div>
    <div class="bone-editor__body">
      <div class="bone-editor__buttons"><button data-role="open-signs" title="Käe asend, sõrmed ja liikumine (viipe enda andmed)">Viipe seaded…</button></div>
      <label class="bone-editor__row"><span>Muuda märki</span><input type="checkbox" data-role="active" /></label>
      <label class="bone-editor__row"><span>Ooteasend tähtede vahel</span><input type="checkbox" data-role="standby" /></label>
      <label class="bone-editor__row"><span>Täht</span><select data-role="letter"></select></label>
      <div class="bone-editor__bone" data-role="twist" title="Kui palju käelaba on eelkäsivarre suhtes keerdus (0° = lõtv käsi, ±90° = peopesa pööratud, üle ±100° näeb käsivars keerdus välja). Parandus: muuda küünarnuki suunda (pole) või käe asendit, vt README."></div>
      <label class="bone-editor__row"><span>Rühm</span><select data-role="group"></select></label>
      <div class="bone-editor__row">
        <label class="bone-editor__row bone-editor__pick"><span data-role="bone-title">Luu</span><select data-role="bone"></select></label>
        <button data-role="focus" style="flex:none;padding:4px 8px" title="Too kaamera valitud luu juurde">Fookus</button>
      </div>
      <label class="bone-editor__row"><span>Peegelda vastasküljele</span><input type="checkbox" data-role="mirror" checked /></label>
      <label class="bone-editor__row"><span>Näita luujooni</span><input type="checkbox" data-role="lines" checked /></label>
      <div class="bone-editor__bone" data-role="label"></div>
      ${SLIDERS.map(
        ([label], i) => `
        <label class="bone-editor__slider">
          <span data-role="slider-label">${label}</span>
          <input type="range" value="0" data-i="${i}" />
          <output>0</output>
        </label>`,
      ).join('')}
      <div class="bone-editor__sep">Kopeeri teisest tähest siia</div>
      <label class="bone-editor__row"><span>Tähelt</span><select data-role="copy-from"></select></label>
      <label class="bone-editor__row"><span>Mida</span>
        <select data-role="copy-scope">
          <option value="all">Kogu täht</option>
          <option value="group">Valitud rühm</option>
          <option value="bone">Valitud luu / vorm</option>
        </select>
      </label>
      <div class="bone-editor__buttons">
        <button data-role="copy-apply">Kopeeri siia</button>
        <button data-role="copy-undo" disabled>Võta tagasi</button>
      </div>
      <div class="bone-editor__bone" data-role="copy-note"></div>
      <div class="bone-editor__buttons">
        <button data-role="reset-bone">Luu nulli</button>
        <button data-role="reset-group">Rühma nulli</button>
        <button data-role="copy">Kopeeri</button>
      </div>
      <div class="bone-editor__buttons">
        <button data-role="save-file">Salvesta faili (fingerspelling.json / words.json)</button>
        <button data-role="load-file" title="Kustutab brauseri töökoopia ja laeb fingerspelling.json-i seaded">Lae failist</button>
      </div>
    </div>`;
  document.body.appendChild(panel);
  const $ = (role) => panel.querySelector(`[data-role="${role}"]`);
  const activeBox = $('active');
  const standbyBox = $('standby');
  const letterSel = $('letter');
  const groupSel = $('group');
  const boneSel = $('bone');
  const mirrorBox = $('mirror');
  const linesBox = $('lines');
  const label = $('label');
  $('open-signs').addEventListener('click', () => onOpenSignEditor?.());
  const twistInfo = $('twist');
  let twistText = '';
  const sliders = [...panel.querySelectorAll('input[type=range]')];
  const outputs = sliders.map((s) => s.nextElementSibling);
  const copyFrom = $('copy-from');
  for (const l of letters) {
    const text = l === STANDBY ? 'Ooteasend' : l;
    letterSel.add(new Option(text, l));
    copyFrom.add(new Option(text, l));
  }
  for (const g of GROUPS) if (g.id !== 'shapes' || tweaks.shapes.length) groupSel.add(new Option(g.label, g.id));
  groupSel.value = tweaks.shapes.length ? 'shapes' : 'face'; // shape keys are how a shape-key face (Character Creator) is tuned

  makeDraggable(panel, panel.querySelector('.bone-editor__bar'), POS_KEY, () => [window.innerWidth - panel.offsetWidth - 16, 16]);

  // --- markers on the bones of the chosen group ---
  const bones = tweaks.bones;
  const items = [...tweaks.bones, ...tweaks.shapes]; // bones first, so a bone's index is the same in both
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

  // --- skeleton lines: every bone of the group joined to its parent; the selected bone's links glow orange ---
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

  let active = false;
  let selected = -1;
  const sel = () => (selected >= 0 ? items[selected] : null);
  const editKey = () => tweaks.keyOf(sel().name, letterSel.value);

  const fillBones = () => {
    boneSel.replaceChildren(new Option('–', ''));
    items.forEach((e, i) => e.group === groupSel.value && boneSel.add(new Option(e.name, String(i))));
  };

  const refresh = () => {
    const e = sel();
    const shapes = groupSel.value === 'shapes';
    const val = e ? tweaks.get(editKey(), e.name) : { rot: [0, 0, 0], pos: [0, 0, 0], w: 0 };
    $('bone-title').textContent = shapes ? 'Vorm' : 'Luu';
    sliders.forEach((s, i) => {
      // a shape key has a single number, its weight: only the first slider is used, relabelled
      s.closest('.bone-editor__slider').style.display = shapes && i > 0 ? 'none' : '';
      panel.querySelectorAll('[data-role=slider-label]')[i].textContent = shapes && i === 0 ? 'Kaal' : SLIDERS[i][0];
      s.disabled = !e;
      if (shapes) {
        s.min = -1;
        s.max = 1;
        s.step = 0.01;
        s.value = val.w;
        outputs[i].textContent = i === 0 ? val.w.toFixed(2) : '';
        return;
      }
      s.min = -ROT_RANGE;
      s.max = ROT_RANGE;
      s.step = 1;
      s.value = val.rot[i];
      outputs[i].textContent = `${val.rot[i]}${SLIDERS[i][1]}`;
    });
    $('reset-bone').disabled = !e;
    mirrorBox.disabled = !e?.mirrorName;
    boneSel.value = e ? String(selected) : '';
    let note = '';
    if (e) {
      const key = editKey();
      note = key === letterSel.value ? '' : e.group === 'body' ? ' (kehtib alati)' : ' (ooteasend)';
    }
    label.innerHTML = e ? `Valitud: <b>${e.name}</b>${note}` : shapes ? 'Vali vorm nimekirjast' : 'Vali luu nimekirjast või klõpsa markeril';
    markers.children.forEach((m, i) => {
      m.material = i === selected ? pickedMat : idleMat;
      m.visible = bones[i].group === groupSel.value;
    });
  };

  const select = (i) => {
    selected = i;
    refresh();
  };

  const setActive = (on) => {
    active = on;
    activeBox.checked = on;
    markers.visible = on;
    if (!on) lines.visible = hot.visible = false;
    onLetter(on ? letterSel.value : null);
  };

  activeBox.addEventListener('change', () => setActive(activeBox.checked));
  standbyBox.checked = standbyOn;
  standbyBox.addEventListener('change', () => {
    try {
      localStorage.setItem(STANDBY_KEY, standbyBox.checked ? '1' : '0');
    } catch {}
    onStandby(standbyBox.checked);
  });
  letterSel.addEventListener('change', () => {
    letterSel.blur(); // so letter keys keep driving the hand instead of the dropdown
    refresh();
    if (active) onLetter(letterSel.value);
  });
  groupSel.addEventListener('change', () => {
    groupSel.blur();
    selected = -1;
    fillBones();
    refresh();
  });
  boneSel.addEventListener('change', () => {
    boneSel.blur();
    select(boneSel.value === '' ? -1 : +boneSel.value);
  });
  $('focus').addEventListener('click', () => {
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
  const write = (e, value) => {
    tweaks.set(editKey(), e.name, value);
    if (mirrorBox.checked && e.mirrorName) tweaks.set(tweaks.keyOf(e.mirrorName, letterSel.value), e.mirrorName, mirrored(value));
    save();
  };

  sliders.forEach((s) =>
    s.addEventListener('input', () => {
      const e = sel();
      if (!e) return;
      const x = sliders.map((el) => +el.value);
      write(e, e.shape ? { w: x[0] } : { rot: x, pos: tweaks.get(editKey(), e.name).pos }); // the position offset stays as it is
      refresh();
    }),
  );
  $('reset-bone').addEventListener('click', () => {
    const e = sel();
    if (!e) return;
    write(e, null);
    refresh();
  });
  $('reset-group').addEventListener('click', () => {
    for (const e of items) if (e.group === groupSel.value) tweaks.set(tweaks.keyOf(e.name, letterSel.value), e.name, null);
    save();
    refresh();
  });
  // --- copy another sign's tweaks onto the sign being edited; one step of undo ---
  let undoSnapshot = null;
  const copyNote = $('copy-note');
  const undoBtn = $('copy-undo');
  $('copy-apply').addEventListener('click', () => {
    const from = copyFrom.value;
    const to = letterSel.value;
    const label = (l) => (l === STANDBY ? 'ooteasend' : l);
    if (from === to) {
      copyNote.textContent = 'Vali lähtetäht, mis erineb praegusest.';
      return;
    }
    const scope = $('copy-scope').value;
    const e = sel();
    if (scope === 'bone' && !e) {
      copyNote.textContent = 'Vali kõigepealt luu või vorm.';
      return;
    }
    // (the mirror twin follows when the mirror box is ticked, as it does for the sliders)
    const names =
      scope === 'bone' ? [e.name, ...(mirrorBox.checked && e.mirrorName ? [e.mirrorName] : [])]
      : items.filter((x) => scope === 'all' || x.group === groupSel.value).map((x) => x.name);
    undoSnapshot = tweaks.export();
    const { copied, cleared } = tweaks.copy(from, to, names);
    save();
    refresh();
    undoBtn.disabled = false;
    copyNote.textContent = copied || cleared ? `Kopeeritud ${label(from)} → ${label(to)}: ${copied} kirjet${cleared ? `, ${cleared} eemaldatud` : ''}.` : `${label(from)} ja ${label(to)} ei erine selles ulatuses (või pole siin tähepõhiseid kirjeid).`;
  });
  undoBtn.addEventListener('click', () => {
    if (!undoSnapshot) return;
    tweaks.load(undoSnapshot);
    undoSnapshot = null;
    undoBtn.disabled = true;
    save();
    refresh();
    copyNote.textContent = 'Tagasi võetud.';
  });

  $('copy').addEventListener('click', async (e) => {
    const text = JSON.stringify(tweaks.export(), null, 2);
    const btn = e.currentTarget;
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Kopeeritud ✓';
    } catch {
      console.log(text);
      btn.textContent = 'Vaata konsooli';
    }
    setTimeout(() => (btn.textContent = 'Kopeeri'), 1500);
  });
  // drop the browser's working copy and show what fingerspelling.json holds (one step of undo, like a copy)
  $('load-file').addEventListener('click', () => {
    if (canon(tweaks.export()) !== fileState && !confirm('Kustutan brauseri töökoopia ja laen fingerspelling.json-i seaded? Salvestamata muudatused lähevad kaduma.')) return;
    undoSnapshot = tweaks.export();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    tweaks.load(tweaksFromSigns());
    undoBtn.disabled = false;
    refresh();
    copyNote.textContent = 'Laetud fingerspelling.json-ist, töökoopia kustutatud.';
  });
  $('save-file').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const text = btn.textContent;
    const state = tweaks.export();
    try {
      // is there a save endpoint at all? (only the dev server has one) - checked first so the PIN isn't asked in vain
      const probe = await fetch(SAVE_URL).catch(() => null);
      if (!probe?.ok) throw new Error('ainult dev-serveris (npm run dev)');
      const pin = await askPin();
      if (pin === null) return;
      const res = await fetch(SAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Save-Pin': pin }, body: JSON.stringify(state) });
      if (!res.ok) throw new Error(res.status === 404 ? 'ainult dev-serveris (npm run dev)' : await res.text());
      fileState = canon(state);
      base = fingerprint(fileState);
      save(); // now equal to the file, so the working copy is dropped
      btn.textContent = 'Salvestatud ✓';
    } catch (err) {
      console.warn('Could not save sign tweaks', err);
      btn.textContent = `Ei õnnestunud: ${err.message}`;
    }
    setTimeout(() => (btn.textContent = text), 2500);
  });

  // --- picking: a click (not an orbit drag) on a marker selects its bone ---
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down = null;
  dom.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
  dom.addEventListener('pointerup', (e) => {
    if (!active || !down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 4) return;
    const r = dom.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(markers.children.filter((m) => m.visible), false)[0];
    if (hit) select(hit.object.userData.index);
  });

  fillBones();
  refresh();
  onStandby(standbyOn);

  return {
    get active() {
      return active;
    },
    /** Follow the letter that was pressed elsewhere (does not trigger onLetter). */
    setLetter(letter) {
      if (!letter || letterSel.value === letter) return;
      letterSel.value = letter;
      refresh();
    },
    /** Keep markers and lines on their bones (markers at a constant on-screen size); call once per frame after everything is posed. */
    update() {
      if (twistAngles) {
        const [r, l] = twistAngles();
        const text = `Randme väänd: parem ${r}°, vasak ${l}°${Math.abs(r) > 100 || Math.abs(l) > 100 ? '  ⚠ käsivars võib näida keerdus' : ''}`;
        if (text !== twistText) {
          twistText = text;
          twistInfo.textContent = text;
          twistInfo.style.color = text.includes('⚠') ? '#ffb347' : '';
        }
      }
      if (!active) return;
      const show = linesBox.checked;
      lines.visible = hot.visible = show;
      let n = 0;
      for (const m of markers.children) {
        if (!m.visible) continue;
        const bone = bones[m.userData.index].bone;
        bone.getWorldPosition(m.position);
        m.scale.setScalar(camera.position.distanceTo(m.position) * 0.006);
        if (show && bone.parent?.isBone) n = addSegment(lines, n, bone.parent.getWorldPosition(pa), m.position);
      }
      flush(lines, n);

      let h = 0;
      const e = sel();
      if (show && e?.bone) {
        e.bone.getWorldPosition(pb);
        if (e.bone.parent?.isBone) h = addSegment(hot, h, e.bone.parent.getWorldPosition(pa), pb);
        for (const child of e.bone.children) if (child.isBone) h = addSegment(hot, h, pb, child.getWorldPosition(pa));
      }
      flush(hot, h);
    },
  };
}
