import { makeDraggable } from './draggable.js';
import { ICONS } from './topbar.js';
import { fold } from '../util.js';

// Floating, draggable box with a text field. Every letter typed becomes a chip in the list below (the signs still to be
// shown), except a whole word (or phrase, such as "head aega") that has a word sign of its own, which becomes one chip; the arrow button signs them one
// after another. Typing the start of a word or phrase that has a sign opens a suggestion list (arrow keys + Enter / Tab, or a click,
// complete it; accents don't matter: "aitah" finds AITÄH). Drag it by the title bar; the position is remembered.
const STORAGE_KEY = 'viiper.textPanel';
const HOLD_MS = 450; // how long each letter is held
const GAP_MS = 150; // pause between letters (the mouth returns to rest)
const END_HOLD_MS = 1500; // how long the hand keeps the last sign before onFinish sends it to standby
const REPEAT_GAP_MS = 350; // pause between two equal letters: the hand bumps forward and back (onRepeat) in it

export function createTextPanel(letters, { words = {}, holdMs = () => HOLD_MS, onPress, onRelease, onRepeat, onFinish }) {
  const panel = document.createElement('div');
  panel.className = 'panel text-panel';
  panel.innerHTML = `
    <div class="panel__bar">
      <span class="panel__title">Tekst</span>
      <span class="panel__grip">⋮⋮</span>
    </div>
    <form class="text-panel__form">
      <input class="text-panel__input" type="text" placeholder="Kirjuta tekst…" autocomplete="off" spellcheck="false">
      <button class="text-panel__send" type="submit" title="Näita viipeid">➤</button>
      <ul class="text-panel__menu" role="listbox" hidden></ul>
    </form>
    <div class="text-panel__list"></div>`;
  const form = panel.querySelector('.text-panel__form');
  const input = panel.querySelector('.text-panel__input');
  const send = panel.querySelector('.text-panel__send');
  const list = panel.querySelector('.text-panel__list');
  const menu = panel.querySelector('.text-panel__menu');
  const known = new Set(letters);
  // words: typed form (upper case, may hold spaces) -> the sign it shows; longest forms are tried first
  const forms = Object.keys(words).sort((a, b) => b.length - a.length);

  // typing here must not trigger the letter shortcuts on window
  panel.addEventListener('keydown', (e) => e.stopPropagation());
  panel.addEventListener('keyup', (e) => e.stopPropagation());

  let items = []; // the typed characters that have a sign (or a space), in order
  let chips = [];
  let timer = null; // set while playing
  let playing = false;

  function render() {
    list.replaceChildren();
    chips = items.map((ch) => {
      const chip = document.createElement('span');
      chip.className = 'text-panel__chip' + (ch === ' ' ? ' text-panel__chip--space' : '');
      chip.textContent = ch === ' ' ? '·' : ch;
      list.appendChild(chip);
      return chip;
    });
    if (!items.length) {
      const empty = document.createElement('span');
      empty.className = 'text-panel__empty';
      empty.textContent = 'Siia ilmuvad tulevased viiped';
      list.appendChild(empty);
    }
    send.disabled = !items.some((ch) => ch !== ' ');
  }

  function update() {
    // a word (or phrase) that has its own sign is one item, anything else is signed letter by letter
    const text = input.value.toUpperCase();
    items = [];
    for (let i = 0; i < text.length; ) {
      const form = forms.find((f) => (i === 0 || text[i - 1] === ' ') && text.startsWith(f, i) && (i + f.length === text.length || text[i + f.length] === ' '));
      if (form) {
        items.push(form);
        i += form.length;
      } else {
        if (text[i] === ' ' || known.has(text[i])) items.push(text[i]);
        i++;
      }
    }
    render();
    refreshMenu();
  }
  input.addEventListener('input', update);

  // --- suggestions: the typed text's last word (or phrase start) against the words that have a sign ---
  const folded = new Map(Object.keys(words).sort().map((f) => [f, fold(f)]));
  let options = []; // [{ form, label }] currently listed
  let matchStart = 0; // where in the input the text that a pick replaces begins
  let active = -1; // highlighted option, -1 = none

  function refreshMenu() {
    options = [];
    active = -1;
    if (!playing && document.activeElement === input) {
      const typed = fold(input.value);
      // the longest tail that starts a word and is the beginning of a longer word / phrase
      for (let i = 0; i < typed.length && !options.length; i++) {
        if (i > 0 && input.value[i - 1] !== ' ') continue;
        const tail = typed.slice(i);
        if (!tail.trim()) break;
        options = [...folded].filter(([, f]) => f.startsWith(tail) && f !== tail).slice(0, 6).map(([form]) => ({ form, label: words[form] }));
        matchStart = i;
      }
    }
    menu.replaceChildren(
      ...options.map((o, i) => {
        const li = document.createElement('li');
        li.className = 'text-panel__option';
        li.setAttribute('role', 'option');
        li.append(o.form);
        if (o.label !== o.form) {
          const alias = document.createElement('span');
          alias.className = 'text-panel__alias';
          alias.textContent = '→ ' + o.label;
          li.append(alias);
        }
        // mousedown, not click, and no default: the input must keep focus
        li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          pick(i);
        });
        return li;
      }),
    );
    menu.hidden = !options.length;
  }

  function highlight(i) {
    active = i;
    [...menu.children].forEach((li, n) => li.classList.toggle('text-panel__option--active', n === i));
  }

  function pick(i) {
    if (!options[i]) return;
    input.value = input.value.slice(0, matchStart) + options[i].form + ' ';
    input.focus();
    update();
  }

  input.addEventListener('keydown', (e) => {
    if (menu.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      highlight(e.key === 'ArrowDown' ? (active + 1) % options.length : active < 0 ? options.length - 1 : (active - 1 + options.length) % options.length);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault(); // takes the suggestion instead of showing the signs
      pick(active);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      pick(Math.max(active, 0));
    } else if (e.key === 'Escape') {
      options = [];
      menu.hidden = true;
    }
  });
  input.addEventListener('focus', refreshMenu);
  input.addEventListener('blur', () => {
    options = [];
    menu.hidden = true;
  });

  function setPlaying(on) {
    playing = on;
    input.readOnly = on; // not disabled: a disabled field would lose the focus
    if (on) refreshMenu();
    send.classList.toggle('text-panel__send--stop', on);
    send.textContent = on ? '■' : '➤';
    send.title = on ? 'Peata' : 'Näita viipeid';
    send.disabled = !on && !items.some((ch) => ch !== ' ');
  }

  function stop() {
    clearTimeout(timer);
    timer = null;
    setPlaying(false);
    chips.forEach((c) => c.classList.remove('text-panel__chip--current'));
    onFinish?.();
  }

  function play() {
    chips.forEach((c) => c.classList.remove('text-panel__chip--done', 'text-panel__chip--current'));
    setPlaying(true);
    let i = 0;
    const step = () => {
      chips[i - 1]?.classList.replace('text-panel__chip--current', 'text-panel__chip--done');
      if (i >= items.length) {
        timer = setTimeout(stop, END_HOLD_MS);
        return;
      }
      const ch = items[i];
      const chip = chips[i++];
      if (ch === ' ') {
        chip.classList.add('text-panel__chip--done');
        timer = setTimeout(step, HOLD_MS);
        return;
      }
      chip.classList.add('text-panel__chip--current');
      chip.scrollIntoView({ block: 'nearest' });
      const sign = words[ch] ?? ch;
      onPress(sign, ch); // ch is what was typed: for an alias ("PALJU ÕNNE") the mouth says that, not the sign's own word
      const repeated = items.slice(i).find((c) => c !== ' ') === ch; // the next sign is the same letter
      timer = setTimeout(() => {
        onRelease(sign);
        if (repeated) onRepeat?.(sign);
        timer = setTimeout(step, repeated ? REPEAT_GAP_MS : GAP_MS);
      }, holdMs(sign));
    };
    step();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (playing) stop();
    else if (items.some((ch) => ch !== ' ')) play();
    input.focus(); // also when the arrow button was clicked
  });

  render();
  document.body.appendChild(panel);

  makeDraggable(panel, panel.querySelector('.panel__bar'), STORAGE_KEY, () => [
    16,
    (window.innerHeight - panel.offsetHeight) / 2,
  ], { svg: ICONS.text, label: 'Tekst' });
}
