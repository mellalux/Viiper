import { h, modal } from './account.js';
import { ICONS, iconButton, topbar } from './topbar.js';

// The "info" button (first in the top row) and its dialog: what the app is, how to use it, who made it.
const AUTHOR = 'OÜ Mella';
// __APP_VERSION__ (client/package.json) and __BUILD_YEAR__ are filled in by vite.config.js
const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';
const YEAR = typeof __BUILD_YEAR__ === 'number' ? __BUILD_YEAR__ : new Date().getFullYear();

function showAbout() {
  return modal(
    'Rakenduse info',
    (close) =>
      h(
        'div',
        { class: 'acc-about' },
        h('div', { class: 'acc-about__head' }, h('img', { src: '/favicon.svg', alt: '', width: 64, height: 64 }), h('b', {}, 'Viiper'), VERSION ? h('div', { class: 'acc-about__note' }, `Versioon ${VERSION}`) : null),
        h('p', {}, 'Viiper on 3D-tegelane, kes näitab eesti viipekeele sõrmendeid (tähti) ja viipeid (sõnu ja fraase) koos vastava suuvormiga.'),
        h('p', {}, 'Meie missioon on eesti viipekeele populariseerimine: teha viipekeel kõigile nähtavaks ja lihtsasti õpitavaks, et rohkem inimesi leiaks tee kurtide ja kuulmispuudega inimestega suhtlemiseni.'),
        h('p', { class: 'acc-about__note' }, 'Seni on Viiper valminud autori vabatahtliku tööna.'),
        h(
          'ul',
          {},
          h('li', {}, 'Hoia tähe klahvi all (või vajuta tähenuppu) – tegelane näitab selle sõrmendit ja suuvormi. ', h('kbd', {}, 'Esc'), ' viib käed puhkeasendisse.'),
          h('li', {}, 'Kirjuta sõna või fraas tekstikasti – viip näidatakse tervikuna. „Viiped“ nupust leiab kõik viiped nimekirjast.'),
          h('li', {}, 'Lohista pilti, et tegelast pöörata, ja keri, et suumida. Paneele saab lohistada, ahendada ja sulgeda.'),
        ),
        h('p', { class: 'acc-about__note' }, 'Viiped põhinevad EKI viipekeele sõnaraamatu videotel. Viipeid saavad muuta sisselogitud toimetajad.'),
        h('dl', {}, h('dt', {}, 'Autor'), h('dd', {}, `© ${YEAR} ${AUTHOR}`), h('dt', {}, 'Tehnika'), h('dd', {}, 'three.js, Vite')),
        h('div', { class: 'acc-dialog__buttons' }, h('button', { type: 'button', 'data-role': 'ok', onclick: () => close(null) }, 'Sulge')),
      ),
    { wide: true },
  );
}

// shown once on a first visit; where localStorage is unavailable it comes up on every load rather than never
const SEEN_KEY = 'viiper.aboutSeen';
function firstVisit() {
  try {
    if (localStorage.getItem(SEEN_KEY)) return false;
    localStorage.setItem(SEEN_KEY, '1');
  } catch {}
  return true;
}

export function createAboutButton() {
  const btn = iconButton(ICONS.info, 'Rakenduse info');
  btn.classList.add('about-open');
  btn.addEventListener('click', showAbout);
  topbar().appendChild(btn);
  if (firstVisit()) showAbout();
}
