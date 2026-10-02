// Makes a fixed-position panel draggable by its title bar and remembers where it was left.
// `defaultPosition` is called once (after the panel is in the DOM) when nothing is saved yet.
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
  window.addEventListener('resize', () => place(panel.offsetLeft, panel.offsetTop));
}
