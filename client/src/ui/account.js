import { ApiError, api, currentUser, login, logout } from '../auth.js';
import { topbar } from './topbar.js';

// The account button (top right) and its dialogs: sign in, change the password and, for admins, manage the accounts.
// The page is public; an account only unlocks the sign editor. Accounts are made by an admin (no self-registration).

const css = `
.account { position: relative; order: 4; font: 13px system-ui, sans-serif; color: #e8e8ec; }
.account__btn, .acc button {
  padding: 7px 14px; border-radius: 10px; cursor: pointer; font: inherit; font-weight: 600; color: #e8e8ec;
  background: rgba(24, 24, 28, 0.88); border: 1px solid rgba(255, 255, 255, 0.14); backdrop-filter: blur(8px);
}
.account__btn { box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45); }
.account__btn--icon { padding: 7px 10px; }
.account__btn--user { display: flex; align-items: center; gap: 6px; }
.account__role { font-weight: 400; color: #9a9aa5; }
.account__btn:hover, .acc button:hover { background: #38383f; }
.account__menu {
  position: absolute; top: calc(100% + 6px); right: 0; min-width: 190px; display: grid; gap: 2px; padding: 6px; border-radius: 10px;
  background: rgba(24, 24, 28, 0.97); border: 1px solid rgba(255, 255, 255, 0.14); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}
.account__menu[hidden] { display: none; }
.account__menu button { text-align: left; font-weight: 400; background: none; border-color: transparent; }
.account__menu small { padding: 4px 14px 6px; color: #9a9aa5; }
.acc-dialog {
  position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; background: rgba(0, 0, 0, 0.55);
  font: 13px system-ui, sans-serif; color: #e8e8ec;
}
.acc-dialog__box {
  width: min(300px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; padding: 16px; display: grid; gap: 10px; border-radius: 12px;
  background: rgba(24, 24, 28, 0.97); border: 1px solid rgba(255, 255, 255, 0.14); box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
}
.acc-dialog__box--wide { width: min(640px, calc(100vw - 32px)); }
.acc-dialog__title { font-weight: 600; font-size: 15px; }
.acc-dialog label { display: grid; gap: 4px; color: #b8b8c2; }
.acc-dialog input, .acc-dialog select {
  padding: 8px 10px; border-radius: 8px; font: inherit; color: #e8e8ec; background: #2c2c33; border: 1px solid rgba(255, 255, 255, 0.14);
}
.acc-dialog__error { min-height: 1.2em; color: #ff8a8a; }
.acc-dialog__ok { color: #7be0a8; }
.acc-dialog__buttons { display: flex; gap: 8px; justify-content: flex-end; }
.acc-dialog button {
  padding: 7px 12px; border-radius: 8px; cursor: pointer; font: inherit; color: #e8e8ec; background: #2c2c33; border: 1px solid rgba(255, 255, 255, 0.1);
}
.acc-dialog button:hover { background: #38383f; }
.acc-dialog button[data-role="ok"] { background: #2f9e6e; border-color: #5fd0a0; }
.acc-dialog button:disabled { opacity: 0.5; cursor: default; }
.acc-about { display: grid; gap: 10px; line-height: 1.5; }
.acc-about p, .acc-about ul, .acc-about dl { margin: 0; }
.acc-about ul { padding-left: 18px; display: grid; gap: 4px; }
.acc-about__head { display: grid; justify-items: center; gap: 4px; font-size: 18px; }
.acc-about__head img { border-radius: 14px; margin-bottom: 4px; }
.acc-about__head .acc-about__note { font-size: 12px; }
.acc-about__note { color: #9a9aa5; }
.acc-about dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; }
.acc-about dt { color: #9a9aa5; }
.acc-about dd { margin: 0; }
.acc-about kbd { padding: 1px 6px; border-radius: 4px; font: inherit; font-size: 11px; background: #2c2c33; border: 1px solid rgba(255, 255, 255, 0.18); }
.acc-users { width: 100%; border-collapse: collapse; }
.acc-users th { text-align: left; color: #9a9aa5; font-weight: 400; padding: 2px 6px; }
.acc-users td { padding: 4px 6px; border-top: 1px solid rgba(255, 255, 255, 0.08); }
.acc-users tr.is-disabled td:first-child { text-decoration: line-through; color: #9a9aa5; }
.acc-users button { padding: 3px 8px; font-size: 12px; }
.acc-log td { vertical-align: top; white-space: nowrap; }
.acc-log td:nth-child(5) { white-space: normal; word-break: break-word; color: #9a9aa5; }
.acc-log .is-bad td:nth-child(3) { color: #ff8a8a; }
.acc-new { display: grid; grid-template-columns: 1fr 1fr auto auto; gap: 6px; align-items: end; }
@media (max-width: 560px) { .acc-new { grid-template-columns: 1fr; } .acc-users { font-size: 12px; } }
`;

function addStyle() {
  if (document.getElementById('account-style')) return;
  const style = document.createElement('style');
  style.id = 'account-style';
  style.textContent = css;
  document.head.appendChild(style);
}

export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.flat().filter((c) => c != null));
  return node;
}

/** A modal dialog; resolves to whatever `close(value)` is given (null when dismissed). `build(close)` returns the dialog's content. */
export function modal(title, build, { wide = false } = {}) {
  addStyle();
  if (document.querySelector('.acc-dialog')) return Promise.resolve(null); // one at a time
  return new Promise((resolve) => {
    const overlay = h('div', { class: 'acc-dialog' });
    const close = (value = null) => {
      overlay.remove();
      resolve(value);
    };
    overlay.append(h('div', { class: `acc-dialog__box${wide ? ' acc-dialog__box--wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('div', { class: 'acc-dialog__title' }, title), build(close)));
    overlay.addEventListener('pointerdown', (e) => e.target === overlay && close(null));
    // keys typed here must not reach the letter shortcuts, nor close anything else
    overlay.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') close(null);
    });
    overlay.addEventListener('keyup', (e) => e.stopPropagation());
    document.body.appendChild(overlay);
    overlay.querySelector('input, button')?.focus();
  });
}

const field = (label, input) => h('label', {}, label, input);

/** Run an async action behind a form's submit: disables the buttons meanwhile and shows the error. */
const guarded = (form, errorEl, action) =>
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const buttons = [...form.querySelectorAll('button')];
    buttons.forEach((b) => (b.disabled = true));
    errorEl.textContent = '';
    try {
      await action();
    } catch (err) {
      errorEl.textContent = err instanceof ApiError || err instanceof Error ? err.message : 'Midagi läks valesti.';
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  });

/** The sign-in dialog. Resolves to the user, or null when it is dismissed. */
export function askLogin(message = 'Logi sisse, et viipeid muuta.') {
  return modal('Sisselogimine', (close) => {
    const name = h('input', { name: 'username', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true });
    const pw = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true });
    const error = h('div', { class: 'acc-dialog__error', role: 'alert' });
    const form = h(
      'form',
      { class: 'acc', style: 'display: grid; gap: 10px' },
      h('div', {}, message),
      field('Kasutajanimi', name),
      field('Parool', pw),
      error,
      h('div', { class: 'acc-dialog__buttons' }, h('button', { type: 'button', onclick: () => close(null) }, 'Tühista'), h('button', { type: 'submit', 'data-role': 'ok' }, 'Logi sisse')),
    );
    guarded(form, error, async () => close(await login(name.value.trim(), pw.value)));
    return form;
  });
}

function changePassword() {
  return modal('Muuda parooli', (close) => {
    const current = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    const next = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 10 });
    const again = h('input', { type: 'password', autocomplete: 'new-password', required: true });
    const error = h('div', { class: 'acc-dialog__error', role: 'alert' });
    const form = h(
      'form',
      { style: 'display: grid; gap: 10px' },
      field('Praegune parool', current),
      field('Uus parool (vähemalt 10 märki)', next),
      field('Uus parool uuesti', again),
      error,
      h('div', { class: 'acc-dialog__buttons' }, h('button', { type: 'button', onclick: () => close(null) }, 'Tühista'), h('button', { type: 'submit', 'data-role': 'ok' }, 'Muuda')),
    );
    guarded(form, error, async () => {
      if (next.value !== again.value) throw new Error('Uued paroolid ei ühti.');
      await api('POST', '/api/auth/password', { current: current.value, next: next.value });
      close(true);
    });
    return form;
  });
}

const ACTIONS = {
  login: 'sisselogimine', login_failed: 'vale parool', login_blocked: 'sisselogimine blokeeritud', logout: 'väljalogimine', password_change: 'parooli vahetus',
  user_create: 'konto lisatud', user_update: 'konto muudetud', user_delete: 'konto kustutatud', sign_save: 'viipeid salvestatud',
};
const BAD = new Set(['login_failed', 'login_blocked']);

/** The audit log: who signed in, changed accounts or saved signs, newest first. Admins only. */
function showLog() {
  return modal(
    'Tegevuslogi',
    (close) => {
      const body = h('tbody', {});
      const error = h('div', { class: 'acc-dialog__error', role: 'alert' });
      const more = h('button', { type: 'button', hidden: true }, 'Vanemad');
      let last = null;
      async function load() {
        try {
          const { entries } = await api('GET', `/api/audit?limit=100${last ? `&before=${last}` : ''}`);
          for (const e of entries) {
            body.append(
              h('tr', { class: BAD.has(e.action) ? 'is-bad' : '' },
                h('td', {}, new Date(e.at).toLocaleString('et')),
                h('td', {}, e.username ?? '–'),
                h('td', {}, ACTIONS[e.action] ?? e.action),
                h('td', {}, e.target ?? ''),
                h('td', {}, [e.detail, e.ip].filter(Boolean).join(' · ')),
              ),
            );
            last = e.id;
          }
          more.hidden = entries.length < 100;
          if (!last) body.append(h('tr', {}, h('td', { colspan: 5 }, 'Logi on tühi.')));
        } catch (err) {
          error.textContent = err.message;
        }
      }
      more.addEventListener('click', load);
      load();
      return h('div', { class: 'acc', style: 'display: grid; gap: 10px' },
        h('div', { style: 'max-height: 60vh; overflow: auto' },
          h('table', { class: 'acc-users acc-log' }, h('thead', {}, h('tr', {}, h('th', {}, 'Aeg'), h('th', {}, 'Kasutaja'), h('th', {}, 'Tegevus'), h('th', {}, 'Mille kohta'), h('th', {}, 'Lisa (IP)'))), body)),
        error,
        h('div', { class: 'acc-dialog__buttons' }, more, h('button', { type: 'button', onclick: () => close(null) }, 'Sulge')));
    },
    { wide: true },
  );
}

function manageUsers() {
  return modal(
    'Kasutajad',
    (close) => {
      const me = currentUser();
      const table = h('table', { class: 'acc-users acc' });
      const error = h('div', { class: 'acc-dialog__error', role: 'alert' });
      const run = async (action) => {
        error.textContent = '';
        try {
          await action();
        } catch (err) {
          error.textContent = err.message;
        }
        await render();
      };
      async function render() {
        const { users } = await api('GET', '/api/users').catch((err) => ((error.textContent = err.message), { users: [] }));
        table.replaceChildren(
          h('tr', {}, h('th', {}, 'Nimi'), h('th', {}, 'Roll'), h('th', {}, 'Viimati sees'), h('th', {})),
          ...users.map((u) => {
            const self = u.id === me.id;
            const role = h('select', { 'aria-label': `Roll: ${u.username}`, onchange: () => run(() => api('PATCH', `/api/users/${u.id}`, { role: role.value })) }, h('option', { value: 'editor' }, 'toimetaja'), h('option', { value: 'admin' }, 'admin'));
            role.value = u.role;
            return h(
              'tr',
              { class: u.disabled ? 'is-disabled' : '' },
              h('td', {}, u.username, self ? ' (sina)' : ''),
              h('td', {}, role),
              h('td', {}, u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('et') : '–'),
              h(
                'td',
                { style: 'white-space: nowrap; text-align: right' },
                h('button', { type: 'button', onclick: () => { const pw = prompt(`Uus parool kasutajale ${u.username} (vähemalt 10 märki):`); if (pw) run(() => api('PATCH', `/api/users/${u.id}`, { password: pw })); } }, 'Uus parool'),
                ' ',
                self ? null : h('button', { type: 'button', onclick: () => run(() => api('PATCH', `/api/users/${u.id}`, { disabled: !u.disabled })) }, u.disabled ? 'Luba' : 'Keela'),
                ' ',
                self ? null : h('button', { type: 'button', onclick: () => confirm(`Kustutan kasutaja ${u.username}?`) && run(() => api('DELETE', `/api/users/${u.id}`)) }, 'Kustuta'),
              ),
            );
          }),
        );
      }
      const name = h('input', { autocomplete: 'off', required: true, placeholder: 'kasutajanimi', 'aria-label': 'Uue kasutaja nimi' });
      const pw = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 10, placeholder: 'parool (10+ märki)', 'aria-label': 'Uue kasutaja parool' });
      const role = h('select', { 'aria-label': 'Uue kasutaja roll' }, h('option', { value: 'editor' }, 'toimetaja'), h('option', { value: 'admin' }, 'admin'));
      const add = h('form', { class: 'acc-new acc' }, name, pw, role, h('button', { type: 'submit', 'data-role': 'ok' }, 'Lisa'));
      add.addEventListener('submit', (e) => {
        e.preventDefault();
        run(async () => {
          await api('POST', '/api/users', { username: name.value.trim(), password: pw.value, role: role.value });
          add.reset();
        });
      });
      render();
      return h('div', { class: 'acc', style: 'display: grid; gap: 10px' }, table, add, error, h('div', { class: 'acc-dialog__buttons' }, h('button', { type: 'button', onclick: () => close(null) }, 'Sulge')));
    },
    { wide: true },
  );
}

const USER_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>';

/** The button at the top right: a user icon ("Logi sisse") for a visitor, the user's menu for a signed-in one. A change of state reloads the page. */
export function createAccountMenu() {
  addStyle();
  const user = currentUser();
  const root = h('div', { class: 'account acc' });
  topbar().appendChild(root);
  if (!user) {
    const loginBtn = h('button', { class: 'account__btn account__btn--icon', type: 'button', title: 'Logi sisse', 'aria-label': 'Logi sisse', onclick: async () => (await askLogin()) && location.reload() });
    loginBtn.innerHTML = USER_ICON;
    root.append(loginBtn);
    return root;
  }
  const menu = h(
    'div',
    { class: 'account__menu', hidden: true },
    h('small', {}, user.role === 'admin' ? 'Administraator' : 'Toimetaja'),
    h('button', { type: 'button', onclick: () => ((menu.hidden = true), changePassword().then((ok) => ok && alert('Parool vahetatud.'))) }, 'Muuda parooli'),
    user.role === 'admin' ? h('button', { type: 'button', onclick: () => ((menu.hidden = true), manageUsers()) }, 'Kasutajad') : null,
    user.role === 'admin' ? h('button', { type: 'button', onclick: () => ((menu.hidden = true), showLog()) }, 'Tegevuslogi') : null,
    h('button', { type: 'button', onclick: async () => (await logout(), location.reload()) }, 'Logi välja'),
  );
  const btn = h('button', { class: 'account__btn account__btn--user', type: 'button', 'aria-haspopup': 'menu', onclick: () => (menu.hidden = !menu.hidden) });
  btn.innerHTML = USER_ICON;
  btn.append(h('span', {}, user.username.charAt(0).toUpperCase() + user.username.slice(1)), h('span', { class: 'account__role' }, `(${user.role === 'admin' ? 'Admin' : 'Toimetaja'})`), ' ▾');
  root.append(btn, menu);
  document.addEventListener('pointerdown', (e) => !root.contains(e.target) && (menu.hidden = true));
  return root;
}
