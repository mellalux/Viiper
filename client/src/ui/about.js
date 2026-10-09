import { h, modal } from './account.js';
import { ICONS, iconButton, topbar } from './topbar.js';

// The "info" button (first in the top row) and its dialog: what the app is, how to use it, who made it.
const AUTHOR = 'Meelis Luks';

function showAbout() {
  return modal(
    'Viiper',
    (close) =>
      h(
        'div',
        { class: 'acc-about' },
        h('p', {}, 'Viiper on 3D-tegelane, kes näitab eesti viipekeele sõrmendeid (tähti) ja viipeid (sõnu ja fraase) koos vastava suuvormiga.'),
        h(
          'ul',
          {},
          h('li', {}, 'Hoia tähe klahvi all (või vajuta tähenuppu) – tegelane näitab selle sõrmendit ja suuvormi. ', h('kbd', {}, 'Esc'), ' viib käed puhkeasendisse.'),
          h('li', {}, 'Kirjuta sõna või fraas tekstikasti – viip näidatakse tervikuna. „Viiped“ nupust leiab kõik viiped nimekirjast.'),
          h('li', {}, 'Lohista pilti, et tegelast pöörata, ja keri, et suumida. Paneele saab lohistada, ahendada ja sulgeda.'),
        ),
        h('p', { class: 'acc-about__note' }, 'Viiped põhinevad EKI viipekeele sõnaraamatu videotel. Viipeid saavad muuta sisselogitud toimetajad.'),
        h('dl', {}, h('dt', {}, 'Autor'), h('dd', {}, AUTHOR), h('dt', {}, 'Tehnika'), h('dd', {}, 'three.js, Vite')),
        h('div', { class: 'acc-dialog__buttons' }, h('button', { type: 'button', 'data-role': 'ok', onclick: () => close(null) }, 'Sulge')),
      ),
    { wide: true },
  );
}

export function createAboutButton() {
  const btn = iconButton(ICONS.info, 'Rakenduse info');
  btn.classList.add('about-open');
  btn.addEventListener('click', showAbout);
  topbar().appendChild(btn);
}
