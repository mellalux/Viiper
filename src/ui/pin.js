// The save PIN dialog shared by the editors (bone editor, sign editor): a small modal with a masked input.
const css = `
.pin-dialog {
  position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; background: rgba(0, 0, 0, 0.55);
  font: 13px system-ui, sans-serif; color: #e8e8ec;
}
.pin-dialog__box {
  width: 260px; padding: 16px; display: grid; gap: 10px; border-radius: 12px;
  background: rgba(24, 24, 28, 0.97); border: 1px solid rgba(255, 255, 255, 0.14); box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
}
.pin-dialog__title { font-weight: 600; }
.pin-dialog input {
  padding: 8px 10px; border-radius: 8px; font: inherit; font-size: 18px; letter-spacing: 0.3em; text-align: center;
  color: inherit; background: #2c2c33; border: 1px solid rgba(255, 255, 255, 0.14);
}
.pin-dialog__buttons { display: flex; gap: 8px; }
.pin-dialog button {
  flex: 1; padding: 7px 4px; border-radius: 8px; cursor: pointer; font: inherit;
  color: #e8e8ec; background: #2c2c33; border: 1px solid rgba(255, 255, 255, 0.1);
}
.pin-dialog button:hover { background: #38383f; }
.pin-dialog button[data-role="ok"] { background: #2f9e6e; border-color: #5fd0a0; }
`;

/** Ask for the save PIN. `what` says which file(s) get written. Resolves to the typed PIN, or null when cancelled. */
export function askPin(what = 'fingerspelling.json-i ja words.json-i') {
  if (!document.getElementById('pin-dialog-style')) {
    const style = document.createElement('style');
    style.id = 'pin-dialog-style';
    style.textContent = css;
    document.head.appendChild(style);
  }
  if (document.querySelector('.pin-dialog')) return Promise.resolve(null); // already asking
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'pin-dialog';
    overlay.innerHTML = `
      <form class="pin-dialog__box">
        <div class="pin-dialog__title">Salvesta faili</div>
        <div>Sisesta PIN, et muudatused ${what} kirjutada.</div>
        <input type="password" inputmode="numeric" autocomplete="off" aria-label="PIN" />
        <div class="pin-dialog__buttons">
          <button type="button" data-role="cancel">Tühista</button>
          <button type="submit" data-role="ok">Salvesta</button>
        </div>
      </form>`;
    const input = overlay.querySelector('input');
    const finish = (value) => {
      overlay.remove();
      resolve(value);
    };
    overlay.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      finish(input.value);
    });
    overlay.querySelector('[data-role="cancel"]').addEventListener('click', () => finish(null));
    overlay.addEventListener('pointerdown', (e) => e.target === overlay && finish(null));
    // keys typed here must not reach the letter shortcuts (a PIN may contain letters) nor close anything else
    overlay.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') finish(null);
    });
    overlay.addEventListener('keyup', (e) => e.stopPropagation());
    document.body.appendChild(overlay);
    input.focus();
  });
}
