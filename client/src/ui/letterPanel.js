import { makeDraggable } from './draggable.js';

// Floating, draggable box of letter buttons. Drag it by the title bar; the position is remembered.
const STORAGE_KEY = 'viiper.letterPanel';

export function createLetterPanel(letters, { onPress, onRelease }) {
  const panel = document.createElement('div');
  panel.className = 'panel letter-panel';
  panel.innerHTML = `
    <div class="panel__bar">
      <span class="panel__title">Sõrmendid</span>
      <span class="panel__grip">⋮⋮</span>
    </div>
    <div class="letter-panel__grid"></div>
    <div class="letter-panel__hint">Hoia nuppu või klahvi all<br><kbd>Esc</kbd> – käed puhkeasendisse</div>`;
  const grid = panel.querySelector('.letter-panel__grid');

  const keys = new Map();
  for (const letter of letters) {
    const b = document.createElement('button');
    b.className = 'letter-panel__key';
    b.textContent = letter;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId); // keep receiving pointerup if the pointer slides off
      onPress(letter);
    });
    b.addEventListener('pointerup', () => onRelease(letter));
    b.addEventListener('pointercancel', () => onRelease(letter));
    grid.appendChild(b);
    keys.set(letter, b);
  }
  document.body.appendChild(panel);

  makeDraggable(panel, panel.querySelector('.panel__bar'), STORAGE_KEY, () => [
    (window.innerWidth - panel.offsetWidth) / 2,
    window.innerHeight - panel.offsetHeight - 16,
  ]);

  return {
    /** Highlight one letter (or none). */
    setActive(letter) {
      for (const [l, b] of keys) b.classList.toggle('letter-panel__key--active', l === letter);
    },
  };
}
