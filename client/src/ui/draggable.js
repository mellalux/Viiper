// Makes a floating panel (class `panel`; its title bar is `panel__bar` with a `panel__title` and a `panel__grip`, the look is in panels.css)
// draggable by its title bar and remembers where it was left. The bar also gets a button that
// collapses the panel to just the bar (remembered too; a double click on the bar does the same); the bar must be the panel's first child.
// `defaultPosition` is called once (after the panel is in the DOM) when nothing is saved yet.
import './panels.css';

export function makeDraggable(panel, bar, storageKey, defaultPosition) {
  // the visual size, so a panel scaled with a CSS transform (origin top left) still stays on screen
  const clamp = (x, y) => {
    const { width, height } = panel.getBoundingClientRect();
    return {
      x: Math.min(Math.max(0, x), Math.max(0, window.innerWidth - width)),
      y: Math.min(Math.max(0, y), Math.max(0, window.innerHeight - height)),
    };
  };
  const place = (x, y) => {
    const p = clamp(x, y);
    panel.style.left = `${p.x}px`;
    panel.style.top = `${p.y}px`;
  };

  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(storageKey));
  } catch {}
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) place(saved.x, saved.y);
  else place(...defaultPosition());

  const collapseKey = `${storageKey}.collapsed`;
  const toggle = document.createElement('button');
  toggle.className = 'panel-collapse';
  bar.firstElementChild.style.flex = '1'; // the title takes the space, the grip and the button sit at the right edge
  bar.appendChild(toggle);
  const setCollapsed = (on) => {
    panel.classList.toggle('is-collapsed', on);
    toggle.title = on ? 'Ava' : 'Peida';
    if (panel.getClientRects().length) place(panel.offsetLeft, panel.offsetTop); // opening may push the panel past the screen edge (a hidden panel has no position to keep)
  };
  let collapsed = false;
  try {
    collapsed = localStorage.getItem(collapseKey) === '1';
  } catch {}
  setCollapsed(collapsed);
  const flip = () => {
    collapsed = !collapsed;
    setCollapsed(collapsed);
    try {
      localStorage.setItem(collapseKey, collapsed ? '1' : '0');
    } catch {}
  };
  toggle.addEventListener('click', flip);
  bar.addEventListener('dblclick', (e) => {
    if (e.target.closest('button')) return;
    getSelection()?.removeAllRanges(); // the double click selects the word under the cursor
    flip();
  });

  let drag = null;
  bar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return; // buttons in the title bar must keep their clicks
    bar.setPointerCapture(e.pointerId);
    drag = { dx: e.clientX - panel.offsetLeft, dy: e.clientY - panel.offsetTop };
    panel.classList.add('is-dragging');
  });
  bar.addEventListener('pointermove', (e) => {
    if (drag) place(e.clientX - drag.dx, e.clientY - drag.dy);
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    panel.classList.remove('is-dragging');
    try {
      localStorage.setItem(storageKey, JSON.stringify({ x: panel.offsetLeft, y: panel.offsetTop }));
    } catch {}
  };
  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', endDrag);
  // (a panel that is not shown has no position to keep: its offsets read 0)
  window.addEventListener('resize', () => panel.getClientRects().length && place(panel.offsetLeft, panel.offsetTop));
}
