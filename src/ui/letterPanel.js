import { makeDraggable } from './draggable.js';

// Floating, draggable box of letter buttons. Drag it by the title bar; the position is remembered.
const STORAGE_KEY = 'viiper.letterPanel';

const css = `
.letter-panel {
  position: fixed; z-index: 10; padding: 0 0 10px; border-radius: 12px; user-select: none; touch-action: none;
  font: 13px system-ui, sans-serif; color: #e8e8ec;
  background: rgba(24, 24, 28, 0.88); border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5); backdrop-filter: blur(8px);
}
.letter-panel__bar {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 8px 12px; cursor: grab; border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.letter-panel.is-dragging .letter-panel__bar { cursor: grabbing; }
.letter-panel__title { font-weight: 600; letter-spacing: 0.02em; }
.letter-panel__grip { color: #888; letter-spacing: 2px; }
.letter-panel__grid { display: grid; grid-template-columns: repeat(8, 38px); gap: 6px; padding: 10px 12px 0; }
.letter-panel__key {
  height: 38px; padding: 0; border-radius: 8px; cursor: pointer; font: inherit; font-size: 15px; font-weight: 600;
  color: #e8e8ec; background: #2c2c33; border: 1px solid rgba(255, 255, 255, 0.1);
}
.letter-panel__key:hover { background: #38383f; }
.letter-panel__key.letter-panel__key--active { background: #2f9e6e; border-color: #5fd0a0; color: #fff; }
.letter-panel__hint { padding: 8px 12px 0; color: #9a9aa5; font-size: 12px; line-height: 1.7; }
.letter-panel__hint kbd {
  padding: 1px 6px; border-radius: 4px; font: inherit; font-size: 11px; color: #e8e8ec;
  background: #2c2c33; border: 1px solid rgba(255, 255, 255, 0.18);
}
`;

export function createLetterPanel(letters, { onPress, onRelease }) {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.className = 'letter-panel';
  panel.innerHTML = `
    <div class="letter-panel__bar">
      <span class="letter-panel__title">Tähestik</span>
      <span class="letter-panel__grip">⋮⋮</span>
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

  makeDraggable(panel, panel.querySelector('.letter-panel__bar'), STORAGE_KEY, () => [
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
