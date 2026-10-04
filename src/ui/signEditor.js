import { makeDraggable } from './draggable.js';
import { askPin } from './pin.js';
import { ORIENT, THUMB_POSES, HAND_CONFIG, SIGNS, MOTION_LEAD } from '../signing/hands.js';
import * as defs from '../signing/signDefs.js';

// The sign editor (dev server only): a window for what makes a sign, as opposed to the bone editor's fine-tuning of single
// bones. Per sign and hand it edits where the hand is held (the named orient plus this sign's own changes: wrist position,
// elbow direction, which way the fingers and thumb point), the finger curls / spread / knuckles and thumb pose, and the
// motion path. Every change shows on the character at once (the motion is held at the "Asend teel" slider until "Mängi").
// Changed signs are kept as a working copy in localStorage until "Salvesta faili" writes them into the data files.
const POS_KEY = 'viiper.signEditor';
const SAVE_URL = '/__save-sign-defs';
const FINGERS = ['Nimetissõrm', 'Keskmine sõrm', 'Sõrmusesõrm', 'Väike sõrm'];
const AXES = ['x', 'y', 'z'];
const CHANNELS = ['x', 'y', 'z', 'tilt', 'flex', 'roll', 'curl'];
const CHANNEL_STEP = [0.01, 0.01, 0.01, 1, 1, 1, 0.01];

const css = `
.sign-editor {
  position: fixed; z-index: 11; width: 372px; max-height: calc(100vh - 32px); display: flex; flex-direction: column;
  border-radius: 12px; user-select: none; touch-action: none;
  font: 13px system-ui, sans-serif; color: #e8e8ec;
  background: rgba(24, 24, 28, 0.94); border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5); backdrop-filter: blur(8px);
}
.sign-editor[hidden] { display: none; }
.sign-editor__bar { display: flex; align-items: center; gap: 8px; flex: none; padding: 8px 12px; cursor: grab; border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
.sign-editor.is-dragging .sign-editor__bar { cursor: grabbing; }
.sign-editor__title { font-weight: 600; letter-spacing: 0.02em; }
.sign-editor__grip { color: #888; letter-spacing: 2px; }
.sign-editor__body { display: grid; gap: 8px; padding: 10px 12px 12px; overflow-y: auto; overflow-x: hidden; }
.sign-editor__row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sign-editor select, .sign-editor input[type=number] {
  min-width: 0; font: inherit; color: inherit; background: #2c2c33; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; padding: 3px 6px;
}
.sign-editor select { max-width: 200px; }
.sign-editor button {
  flex: 1; padding: 6px 8px; border-radius: 8px; cursor: pointer; font: inherit; font-size: 12px;
  color: #e8e8ec; background: #2c2c33; border: 1px solid rgba(255, 255, 255, 0.1);
}
.sign-editor button:hover:not(:disabled) { background: #38383f; }
.sign-editor button:disabled, .sign-editor input:disabled { opacity: 0.4; cursor: default; }
.sign-editor button.sign-editor__tab--on { background: #2f9e6e; border-color: #5fd0a0; color: #fff; }
.sign-editor button.sign-editor__x { flex: none; width: 24px; height: 24px; padding: 0; line-height: 1; }
.sign-editor__tabs, .sign-editor__buttons { display: flex; gap: 6px; }
.sign-editor__note { color: #9a9aa5; font-size: 12px; line-height: 1.4; }
.sign-editor__warn { color: #ffb347; }
.sign-editor details { border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 6px; }
.sign-editor summary { cursor: pointer; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #c8c8d0; padding: 2px 0 6px; }
.sign-editor__group { display: grid; gap: 4px; margin-bottom: 8px; }
.sign-editor__sub { color: #9a9aa5; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 4px; }
.sign-editor__slider { display: grid; grid-template-columns: 92px 1fr 48px; align-items: center; gap: 6px; }
.sign-editor__slider input { width: 100%; margin: 0; }
.sign-editor__slider output { text-align: right; font-variant-numeric: tabular-nums; color: #9a9aa5; }
.sign-editor__path { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)) 22px; gap: 3px; align-items: center; }
.sign-editor__path input { width: 100%; box-sizing: border-box; padding: 3px 4px; font-size: 11px; text-align: right; appearance: textfield; -moz-appearance: textfield; }
.sign-editor__path input::-webkit-inner-spin-button, .sign-editor__path input::-webkit-outer-spin-button { display: none; }
.sign-editor__path span { color: #9a9aa5; font-size: 11px; text-align: center; }
.sign-editor__path button { width: 22px; padding: 0; flex: none; }
.sign-editor__status { color: #9a9aa5; font-size: 12px; min-height: 16px; }
`;

const el = (tag, className, text) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
};
const round = (v, step) => (step >= 1 ? Math.round(v) : Math.round(v * 100) / 100);

/**
 * @param show        (key) => the character shows that sign right now (no smoothing, the motion held where it is)
 * @param play        (key) => start the sign over, motion playing
 * @param freeze      (fraction | null) => hold the motion at that fraction of its path, or let it play
 * @param select      (key) => show the sign everywhere (mouth, letter panel, bone editor)
 * @param info        () => text with the arm's current state (the wrist twist)
 */
export function createSignEditor({ show, play, freeze, select, info = () => '' }) {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const panel = el('div', 'sign-editor');
  panel.hidden = true;
  const bar = el('div', 'sign-editor__bar');
  const title = el('span', 'sign-editor__title', 'Viipe seaded');
  const closeBtn = el('button', 'sign-editor__x', '✕');
  closeBtn.title = 'Sulge';
  bar.append(title, el('span', 'sign-editor__grip', '⋮⋮'), closeBtn);
  const body = el('div', 'sign-editor__body');
  panel.append(bar, body);
  document.body.appendChild(panel);
  // typing in the number fields must not reach the letter shortcuts
  panel.addEventListener('keydown', (e) => e.stopPropagation());
  panel.addEventListener('keyup', (e) => e.stopPropagation());
  makeDraggable(panel, bar, POS_KEY, () => [Math.max(16, window.innerWidth - 280 - 32 - 372), 16]);

  // --- header: sign, hand, state ---
  const signSel = document.createElement('select');
  const tabs = el('div', 'sign-editor__tabs');
  const tabR = el('button', '', 'Parem käsi');
  const tabL = el('button', '', 'Vasak käsi');
  tabs.append(tabR, tabL);
  const infoEl = el('div', 'sign-editor__note');
  const handBody = el('div');
  const statusEl = el('div', 'sign-editor__status');
  const saveBtn = el('button', '', 'Salvesta faili');
  const resetBtn = el('button', '', 'Lähtesta see märk');
  const buttons = el('div', 'sign-editor__buttons');
  buttons.append(saveBtn, resetBtn);
  const signRow = el('label', 'sign-editor__row');
  signRow.append(el('span', '', 'Märk'), signSel);
  body.append(signRow, tabs, infoEl, handBody, statusEl, buttons);

  let key = null;
  let hand = 'R';
  let scrub = 0; // where on its path the motion is held while editing
  let replay = null; // timer that holds the motion again after "Mängi"
  let timer = null; // polls the arm info while open

  const part = () => (hand === 'R' ? SIGNS[key] : SIGNS[key]?.left) ?? null;

  function fillSigns() {
    const keep = signSel.value;
    signSel.replaceChildren(...defs.signKeys().map((k) => new Option(k + (defs.isChanged(k) ? ' •' : ''), k)));
    signSel.value = key ?? keep;
  }
  function updateStatus() {
    const changed = defs.changedKeys();
    statusEl.textContent = changed.length ? `Salvestamata muudatused: ${changed.join(', ')}` : 'Salvestamata muudatusi pole.';
    saveBtn.disabled = !changed.length;
    resetBtn.disabled = !key || !defs.isChanged(key);
    fillSigns();
  }
  function changed() {
    defs.persist();
    show(key);
    freeze(scrub);
    updateStatus();
  }

  // --- building blocks ---
  function slider(parent, label, min, max, step, get, set, unit = '') {
    const row = el('label', 'sign-editor__slider');
    const input = document.createElement('input');
    input.type = 'range';
    Object.assign(input, { min, max, step });
    const out = document.createElement('output');
    const fmt = (v) => `${round(+v, step)}${unit}`;
    input.value = get();
    out.textContent = fmt(input.value);
    input.addEventListener('input', () => {
      set(+input.value);
      out.textContent = fmt(input.value);
      changed();
    });
    row.append(el('span', '', label), input, out);
    parent.appendChild(row);
  }

  const effective = (field) => {
    const p = part();
    return p.orient?.[field] ?? ORIENT[p.dir ?? 'up']?.[field] ?? (field === 'pole' ? HAND_CONFIG.pole : [0, 0, 0]);
  };
  const setOrient = (field, value) => {
    const p = part();
    p.orient = { ...p.orient, [field]: value };
  };

  function vector(parent, label, field, min, max, step) {
    parent.appendChild(el('div', 'sign-editor__sub', label));
    AXES.forEach((axis, i) =>
      slider(parent, axis.toUpperCase(), min, max, step, () => effective(field)[i], (v) => {
        const next = [...effective(field)];
        next[i] = v;
        setOrient(field, next);
      }),
    );
  }

  function orientSection() {
    const p = part();
    const d = el('details');
    d.open = true;
    d.appendChild(el('summary', '', 'Käe asend'));
    const group = el('div', 'sign-editor__group');
    const dirSel = document.createElement('select');
    for (const name of Object.keys(ORIENT)) dirSel.add(new Option(name, name));
    dirSel.value = p.dir ?? 'up';
    dirSel.addEventListener('change', () => {
      p.dir = dirSel.value;
      delete p.orient; // the sign's own changes belonged to the old orient
      renderHand();
      changed();
    });
    const dirRow = el('label', 'sign-editor__row');
    dirRow.append(el('span', '', 'Põhiasend'), dirSel);
    const note = el('div', 'sign-editor__note', ORIENT[p.dir ?? 'up']?.note ?? '');
    group.append(dirRow, note);
    vector(group, 'Randme asukoht (õlast, käe pikkustes)', 'reach', -1, 1, 0.01);
    vector(group, 'Küünarnuki suund', 'pole', -1, 1, 0.05);
    vector(group, 'Sõrmede suund', 'finger', -1, 1, 0.05);
    vector(group, 'Pöidla suund', 'thumb', -1, 1, 0.05);
    slider(group, 'Randme painutus', 20, 120, 1, () => p.orient?.maxBend ?? ORIENT[p.dir ?? 'up']?.maxBend ?? HAND_CONFIG.maxWristBend, (v) => setOrient('maxBend', v), '°');
    const own = el('div', 'sign-editor__note', p.orient ? 'Selle viipe oma muudatused põhiasendis: ' + Object.keys(p.orient).join(', ') : 'Põhiasendit pole selle viipe jaoks muudetud.');
    const undo = el('button', '', 'Lähtesta põhiasendile');
    undo.disabled = !p.orient;
    undo.addEventListener('click', () => {
      delete p.orient;
      renderHand();
      changed();
    });
    group.append(own, undo);
    d.appendChild(group);
    return d;
  }

  function fingerSection() {
    const p = part();
    const d = el('details');
    d.open = true;
    d.appendChild(el('summary', '', 'Sõrmed'));
    const group = el('div', 'sign-editor__group');
    if (!Array.isArray(p.curl)) {
      group.appendChild(el('div', 'sign-editor__note', 'Selle käe sõrmi ei määra andmed: need on ainult peenhäälestuse (luude) järgi. Määra sõrmeandmed, kui tahad neid siin muuta.'));
      const add = el('button', '', 'Määra sõrmeandmed');
      add.addEventListener('click', () => {
        p.curl = [0, 0, 0, 0];
        p.thumb ??= 'rest';
        p.dir ??= 'up';
        renderHand();
        changed();
      });
      group.appendChild(add);
      d.appendChild(group);
      return d;
    }
    const thumbSel = document.createElement('select');
    for (const name of Object.keys(THUMB_POSES)) thumbSel.add(new Option(name, name));
    thumbSel.value = p.thumb ?? 'rest';
    thumbSel.addEventListener('change', () => {
      p.thumb = thumbSel.value;
      changed();
    });
    const thumbRow = el('label', 'sign-editor__row');
    thumbRow.append(el('span', '', 'Pöidla asend'), thumbSel);
    group.appendChild(thumbRow);
    const arrays = [['curl', 'Painutus (0 sirge … 1 rusikas)', 0, 1, 0.01], ['spread', 'Laialiminek (rad)', -0.5, 0.5, 0.01], ['knuckle', 'Sõrmealus (rad)', -0.3, 1.5, 0.01]];
    for (const [field, label, min, max, step] of arrays) {
      group.appendChild(el('div', 'sign-editor__sub', label));
      FINGERS.forEach((name, i) =>
        slider(group, name, min, max, step, () => p[field]?.[i] ?? 0, (v) => {
          p[field] ??= [0, 0, 0, 0];
          p[field][i] = v;
        }),
      );
    }
    d.appendChild(group);
    return d;
  }

  // a point's trailing zeros are left out of the file ([0, 0] stays the shortest)
  const trim = (pt) => {
    while (pt.length > 2 && pt[pt.length - 1] === 0) pt.pop();
  };

  function motionSection() {
    const p = part();
    const d = el('details');
    d.open = true;
    d.appendChild(el('summary', '', 'Liikumine'));
    const group = el('div', 'sign-editor__group');
    const on = document.createElement('input');
    on.type = 'checkbox';
    on.checked = !!p.motion;
    on.addEventListener('change', () => {
      if (on.checked) p.motion = { path: [[0, 0], [0, 0]], duration: 1 };
      else delete p.motion;
      renderHand();
      changed();
    });
    const onRow = el('label', 'sign-editor__row');
    onRow.append(el('span', '', 'Käsi liigub'), on);
    group.appendChild(onRow);
    if (p.motion) {
      const m = p.motion;
      const dur = document.createElement('input');
      dur.type = 'number';
      Object.assign(dur, { min: 0.2, max: 10, step: 0.1, value: m.duration });
      dur.addEventListener('input', () => {
        m.duration = Math.max(0.2, +dur.value || 1);
        changed();
      });
      const durRow = el('label', 'sign-editor__row');
      durRow.append(el('span', '', 'Kestus (s)'), dur);
      group.appendChild(durRow);
      group.appendChild(el('div', 'sign-editor__note', 'Punkt: x, y, z = randme nihe (käe pikkustes; z ette), tilt / flex / roll = käelaba pöörded (°), curl = sõrmede lisapainutus. Esimene punkt on viipe enda asend.'));

      const path = el('div', 'sign-editor__path');
      for (const c of CHANNELS) path.appendChild(el('span', '', c));
      path.appendChild(el('span', ''));
      m.path.forEach((pt, r) => {
        CHANNELS.forEach((c, i) => {
          const input = document.createElement('input');
          input.type = 'number';
          input.step = CHANNEL_STEP[i];
          input.value = pt[i] ?? 0;
          input.disabled = r === 0; // the first point is the pose itself
          input.addEventListener('input', () => {
            while (pt.length <= i) pt.push(0);
            pt[i] = Number.isFinite(+input.value) ? +input.value : 0;
            trim(pt);
            changed();
          });
          path.appendChild(input);
        });
        const del = el('button', '', '−');
        del.title = 'Eemalda punkt';
        del.disabled = r === 0 || m.path.length <= 2;
        del.addEventListener('click', () => {
          m.path.splice(r, 1);
          renderHand();
          changed();
        });
        path.appendChild(del);
      });
      group.appendChild(path);

      const add = el('button', '', '+ Punkt');
      add.addEventListener('click', () => {
        m.path.push([...m.path[m.path.length - 1]]);
        renderHand();
        changed();
      });
      group.appendChild(add);

      const scrubRow = el('label', 'sign-editor__slider');
      const scrubIn = document.createElement('input');
      scrubIn.type = 'range';
      Object.assign(scrubIn, { min: 0, max: 1, step: 0.01, value: scrub });
      const scrubOut = document.createElement('output');
      scrubOut.textContent = scrub.toFixed(2);
      scrubIn.addEventListener('input', () => {
        scrub = +scrubIn.value;
        scrubOut.textContent = scrub.toFixed(2);
        clearTimeout(replay);
        freeze(scrub);
      });
      scrubRow.append(el('span', '', 'Asend teel'), scrubIn, scrubOut);
      group.appendChild(scrubRow);
      const playBtn = el('button', '', '▶ Mängi');
      playBtn.addEventListener('click', () => {
        clearTimeout(replay);
        freeze(null);
        play(key);
        replay = setTimeout(() => {
          show(key);
          freeze(scrub);
        }, (MOTION_LEAD + m.duration) * 1000 + 600);
      });
      group.appendChild(playBtn);
    }
    d.appendChild(group);
    return d;
  }

  function renderHand() {
    handBody.replaceChildren();
    tabR.classList.toggle('sign-editor__tab--on', hand === 'R');
    tabL.classList.toggle('sign-editor__tab--on', hand === 'L');
    if (!key) return;
    const sign = SIGNS[key];
    if (hand === 'L' && !sign.left) {
      handBody.appendChild(el('div', 'sign-editor__note', 'Vasak käsi ei osale selles viipes: ta jääb ooteasendisse.'));
      const add = el('button', '', 'Lisa vasak käsi (parema peegelpilt)');
      add.addEventListener('click', () => {
        const { curl, thumb, dir, orient, spread, knuckle } = sign;
        const zero = (a) => Array.isArray(a) && a.every((x) => x === 0);
        sign.left = structuredClone(Object.fromEntries(Object.entries({ curl, thumb, dir, orient, spread, knuckle }).filter(([f, v]) => v !== undefined && !(zero(v) && (f === 'spread' || f === 'knuckle')))));
        renderHand();
        changed();
      });
      handBody.appendChild(add);
      return;
    }
    handBody.append(orientSection(), fingerSection(), motionSection());
    if (hand === 'L') {
      const remove = el('button', '', 'Eemalda vasak käsi (jääb ooteasendisse)');
      remove.addEventListener('click', () => {
        delete sign.left;
        hand = 'R';
        renderHand();
        changed();
      });
      handBody.appendChild(remove);
    }
  }

  function setSign(next) {
    if (!SIGNS[next] || next === key) return;
    key = next;
    if (hand === 'L' && !SIGNS[key].left) hand = 'R';
    signSel.value = key;
    renderHand();
    updateStatus();
    if (!panel.hidden) {
      show(key);
      freeze(scrub);
    }
  }

  signSel.addEventListener('change', () => select(signSel.value));
  tabR.addEventListener('click', () => {
    hand = 'R';
    renderHand();
  });
  tabL.addEventListener('click', () => {
    hand = 'L';
    renderHand();
  });
  resetBtn.addEventListener('click', () => {
    defs.resetSign(key);
    defs.persist();
    renderHand();
    changed();
  });
  saveBtn.addEventListener('click', async () => {
    const text = saveBtn.textContent;
    const keys = defs.changedKeys();
    try {
      // is there a save endpoint at all? (only the dev server has one) - checked first so the PIN isn't asked in vain
      const probe = await fetch(SAVE_URL).catch(() => null);
      if (!probe?.ok) throw new Error('ainult dev-serveris (npm run dev)');
      const pin = await askPin('fingerspelling.json-i / words.json-i');
      if (pin === null) return;
      const signs = Object.fromEntries(keys.map((k) => [k, defs.currentDef(k)]));
      const res = await fetch(SAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Save-Pin': pin }, body: JSON.stringify({ signs }) });
      if (!res.ok) throw new Error(res.status === 404 ? 'ainult dev-serveris (npm run dev)' : await res.text());
      defs.markSaved(keys);
      updateStatus();
      saveBtn.textContent = 'Salvestatud ✓';
    } catch (err) {
      console.warn('Could not save sign definitions', err);
      saveBtn.textContent = `Ei õnnestunud: ${err.message}`;
    }
    setTimeout(() => {
      saveBtn.textContent = text;
      updateStatus();
    }, 2500);
  });

  function open(next) {
    panel.hidden = false;
    window.dispatchEvent(new Event('resize')); // the panel has its real size now: keep it on the screen
    if (next) setSign(next);
    else if (!key) setSign(defs.signKeys()[0]);
    renderHand();
    updateStatus();
    show(key);
    freeze(scrub);
    clearInterval(timer);
    timer = setInterval(() => {
      const text = info();
      if (infoEl.textContent !== text) infoEl.textContent = text;
    }, 250);
  }
  function close() {
    panel.hidden = true;
    clearTimeout(replay);
    clearInterval(timer);
    freeze(null);
  }
  closeBtn.addEventListener('click', close);

  fillSigns();
  updateStatus();

  return {
    open,
    close,
    get isOpen() {
      return !panel.hidden;
    },
    /** Follow the sign that was picked elsewhere (does not call `select`). */
    setSign,
  };
}
