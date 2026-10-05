import { makeDraggable } from './draggable.js';

// Sign viewer: a button at the top opens a floating, draggable window (no backdrop, so the character stays visible) with a
// search field, a "repeat" checkbox, the word signs in alphabetical order on the left and a clickable A-Z strip on the right.
// Clicking a sign shows it; with the checkbox on, the selected sign is shown again and again until another one is picked,
// the box is unticked or the window is closed. Drag it by the title bar; the position is remembered.
const STORAGE_KEY = 'viiper.signBrowser';
const REPEAT_PAUSE_MS = 1200; // pause between two repeats (the hands are in standby, the mouth at rest)
const END_HOLD_MS = 1500; // how long a single sign is held before the hands go back to standby

const css = `
.sign-open {
  position: fixed; z-index: 10; top: 16px; left: 50%; transform: translateX(-50%); padding: 7px 14px; border-radius: 10px; cursor: pointer;
  font: 600 13px system-ui, sans-serif; color: #e8e8ec; background: rgba(24, 24, 28, 0.88); border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5); backdrop-filter: blur(8px);
}
.sign-open:hover { background: rgba(44, 44, 51, 0.92); }
.sign-box {
  position: fixed; z-index: 11; width: 340px; height: min(560px, calc(100vh - 100px)); display: flex; flex-direction: column;
  border-radius: 12px; user-select: none; touch-action: none; font: 13px system-ui, sans-serif; color: #e8e8ec;
  background: rgba(24, 24, 28, 0.92); border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5); backdrop-filter: blur(8px);
}
.sign-box[hidden] { display: none; }
.sign-box__bar {
  flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 8px 12px; cursor: grab; border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.sign-box.is-dragging .sign-box__bar { cursor: grabbing; }
.sign-box__title { font-weight: 600; letter-spacing: 0.02em; }
.sign-box__grip { color: #888; letter-spacing: 2px; }
.sign-box button.sign-box__close {
  flex: none; width: 22px; height: 22px; padding: 0; border-radius: 6px; cursor: pointer; font: inherit; font-size: 12px; line-height: 1;
  color: #aaa; background: none; border: 1px solid transparent;
}
.sign-box button.sign-box__close:hover { color: #e8e8ec; background: rgba(255, 255, 255, 0.08); }
.sign-box__top { flex: none; display: grid; gap: 8px; padding: 10px 12px 8px; }
.sign-box__search {
  height: 36px; box-sizing: border-box; padding: 0 10px; border-radius: 8px; user-select: text;
  font: inherit; font-size: 14px; color: #e8e8ec; background: #1b1b20; border: 1px solid rgba(255, 255, 255, 0.14);
}
.sign-box__search:focus { outline: none; border-color: #5fd0a0; }
.sign-box__repeat { display: flex; align-items: center; gap: 8px; cursor: pointer; color: #c8c8d0; }
.sign-box__repeat input { margin: 0; width: 16px; height: 16px; accent-color: #2f9e6e; cursor: pointer; }
.sign-box__main { flex: 1; min-height: 0; display: flex; gap: 6px; padding: 0 8px 8px 12px; }
.sign-box__footer { flex: none; padding: 0 12px 10px; color: #7a7a85; font-size: 12px; }
.sign-box__list { flex: 1; min-width: 0; overflow-y: auto; border-radius: 8px; background: rgba(0, 0, 0, 0.25); }
.sign-box__letter {
  position: sticky; top: 0; z-index: 1; padding: 4px 10px; font-size: 12px; font-weight: 700; color: #5fd0a0; background: #1b1b20;
}
.sign-box__item {
  display: flex; justify-content: space-between; gap: 8px; width: 100%; box-sizing: border-box; padding: 6px 10px; text-align: left;
  font: inherit; font-size: 14px; color: #e8e8ec; background: none; border: 0; cursor: pointer;
}
.sign-box__item:hover { background: #2c2c33; }
.sign-box__item.sign-box__item--active, .sign-box__item.sign-box__item--active:hover { background: #2f9e6e; color: #fff; }
.sign-box__alias { color: #8a8a95; font-size: 12px; align-self: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sign-box__item--active .sign-box__alias { color: #d8f5e8; }
.sign-box__empty { padding: 12px 10px; color: #7a7a85; font-size: 12px; }
.sign-box__abc { flex: none; width: 24px; display: flex; flex-direction: column; justify-content: space-between; }
.sign-box__abc button {
  flex: 1; min-height: 0; padding: 0; border-radius: 4px; cursor: pointer; font: inherit; font-size: 11px; font-weight: 600;
  color: #c8c8d0; background: none; border: 0;
}
.sign-box__abc button:hover:not(:disabled) { color: #fff; background: #2f9e6e; }
.sign-box__abc button:disabled { color: #4a4a54; cursor: default; }
`;

const cap = (t) => t.charAt(0) + t.slice(1).toLowerCase();

/**
 * @param signs   word signs (the keys of words.json `signs`), in any order
 * @param aliases other typed forms -> the sign they show (words.json `aliases`); the search finds a sign by them too
 * @param alphabet the letters for the strip (sorted here, the Estonian way)
 */
export function createSignBrowser(signs, { aliases = {}, alphabet, holdMs, onPress, onRelease, onFinish }) {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const openButton = document.createElement('button');
  openButton.className = 'sign-open';
  openButton.textContent = '🔍 Viiped';
  openButton.title = 'Otsi viipeid ja vaata neid';

  const box = document.createElement('div');
  box.className = 'sign-box';
  box.innerHTML = `
    <div class="sign-box__bar">
      <span class="sign-box__title">Viiped</span>
      <span class="sign-box__grip">⋮⋮</span>
      <button class="sign-box__close" title="Sulge">✕</button>
    </div>
    <div class="sign-box__top">
      <input class="sign-box__search" type="search" placeholder="Otsi viipeid…" autocomplete="off" spellcheck="false">
      <label class="sign-box__repeat"><input type="checkbox"> Korda viipet</label>
    </div>
    <div class="sign-box__main">
      <div class="sign-box__list"></div>
      <div class="sign-box__abc"></div>
    </div>
    <div class="sign-box__footer">Sõnaviipeid: ${signs.length}</div>`;
  const search = box.querySelector('.sign-box__search');
  const repeat = box.querySelector('.sign-box__repeat input');
  const list = box.querySelector('.sign-box__list');
  const abc = box.querySelector('.sign-box__abc');

  // typing here must not trigger the letter shortcuts on window
  box.addEventListener('keydown', (e) => e.stopPropagation());
  box.addEventListener('keyup', (e) => e.stopPropagation());

  const collator = new Intl.Collator('et');
  const sorted = [...signs].sort(collator.compare);
  alphabet = [...alphabet].sort(collator.compare);
  // compare without accents and case, so "aitah" finds AITÄH (Õ, Ä, Ö, Ü, Š and Ž count as their own letters only in the strip)
  const fold = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const aliasesOf = new Map(sorted.map((s) => [s, Object.keys(aliases).filter((a) => aliases[a] === s && a !== s)]));
  const haystack = new Map(sorted.map((s) => [s, fold([s, ...aliasesOf.get(s)].join('\n'))]));

  let selected = null;
  let shown = []; // the signs currently in the list, in order
  const items = new Map(); // sign -> its button
  const anchors = new Map(); // letter -> its section in the list
  const letterButtons = new Map();

  for (const letter of alphabet) {
    const b = document.createElement('button');
    b.textContent = letter;
    b.title = letter;
    // (not scrollIntoView: a sticky heading is already at the top, so for the first letters nothing would move)
    b.addEventListener('click', () => {
      const section = anchors.get(letter);
      if (section) list.scrollTop += section.getBoundingClientRect().top - list.getBoundingClientRect().top;
    });
    abc.appendChild(b);
    letterButtons.set(letter, b);
  }

  function render() {
    const q = fold(search.value.trim());
    shown = sorted.filter((s) => haystack.get(s).includes(q));
    list.replaceChildren();
    items.clear();
    anchors.clear();
    let group = null; // the letter's section: its heading sticks to the top of the list while the section scrolls by
    for (const sign of shown) {
      const first = sign[0];
      if (!group || first !== group.dataset.letter) {
        group = document.createElement('section');
        group.dataset.letter = first;
        const h = document.createElement('div');
        h.className = 'sign-box__letter';
        h.textContent = first;
        group.appendChild(h);
        list.appendChild(group);
        anchors.set(first, group);
      }
      const b = document.createElement('button');
      b.className = 'sign-box__item' + (sign === selected ? ' sign-box__item--active' : '');
      b.append(cap(sign));
      // a search that hit an alias shows which one, so the result isn't a mystery
      const hit = q && !fold(sign).includes(q) ? aliasesOf.get(sign).find((a) => fold(a).includes(q)) : null;
      if (hit) {
        const alias = document.createElement('span');
        alias.className = 'sign-box__alias';
        alias.textContent = cap(hit);
        b.append(alias);
      }
      b.addEventListener('click', () => choose(sign));
      group.appendChild(b);
      items.set(sign, b);
    }
    if (!shown.length) {
      const empty = document.createElement('div');
      empty.className = 'sign-box__empty';
      empty.textContent = 'Sellist viipet ei leitud';
      list.appendChild(empty);
    }
    for (const [letter, b] of letterButtons) b.disabled = !anchors.has(letter);
  }

  // --- showing the selected sign, once or over and over ---
  let timer = null;
  function clearTimer() {
    clearTimeout(timer);
    timer = null;
  }

  function play() {
    clearTimer();
    onPress(selected, cap(selected));
    timer = setTimeout(() => {
      onRelease(selected);
      if (repeat.checked) {
        onFinish?.(); // the hands rest in standby for the pause, so each repeat starts from the same place
        timer = setTimeout(() => (repeat.checked ? play() : (timer = null)), REPEAT_PAUSE_MS); // unticked meanwhile: stop in standby
      } else {
        timer = setTimeout(() => {
          timer = null;
          onFinish?.();
        }, END_HOLD_MS);
      }
    }, holdMs(selected));
  }

  function choose(sign) {
    items.get(selected)?.classList.remove('sign-box__item--active');
    selected = sign;
    items.get(sign)?.classList.add('sign-box__item--active');
    play();
  }

  // ticking the box starts repeating the selected sign; unticking ends the loop at its next step (the hand then stays in the sign)
  repeat.addEventListener('change', () => {
    if (repeat.checked && selected) play();
  });

  search.addEventListener('input', render);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && shown.length) choose(shown[0]); // the first hit
  });

  function setOpen(on) {
    box.hidden = !on;
    if (on) search.focus();
    else {
      const wasPlaying = timer !== null;
      clearTimer();
      if (wasPlaying) onFinish?.();
    }
  }
  openButton.addEventListener('click', () => setOpen(box.hidden));
  box.querySelector('.sign-box__close').addEventListener('click', () => setOpen(false));
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });

  render();
  document.body.append(openButton, box);
  // placed while visible (a hidden panel has no size to keep on screen), then hidden
  makeDraggable(box, box.querySelector('.sign-box__bar'), STORAGE_KEY, () => [window.innerWidth - box.offsetWidth - 16, 64]);
  box.hidden = true;
}
