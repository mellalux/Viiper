import { LETTERS } from '../character/mouth.js';
import { WORD_FORMS } from '../signing/hands.js';
import { createLetterPanel } from '../ui/letterPanel.js';
import { createTextPanel } from '../ui/textPanel.js';
import { createSignBrowser } from '../ui/signBrowser.js';
import { app } from './session.js';
import { say, press, release, holdMs } from './signing.js';

/** The panels that play signs (letters, text box, sign browser) and the keyboard: hold a letter key to sign it. */
export function createPanels() {
  const alphabet = Object.keys(LETTERS);

  // Alphabet: hold a letter key (or press a panel button) to show that mouth shape; release for rest.
  app.panel = createLetterPanel(alphabet, { onPress: press, onRelease: release });

  // Text box: the typed letters are signed one after another.
  createTextPanel(alphabet, {
    words: WORD_FORMS,
    holdMs,
    onPress: press,
    onRelease: release,
    onFinish: () => say(null), // the word is done (or stopped): hands back to standby
    // equal letters in a row: the hand(s) that sign the letter make a small push forward and back
    onRepeat: (letter) => {
      const { hands, handsL, tweaks } = app.character ?? {};
      hands?.bump();
      if (tweaks?.usesLeftArm(letter)) handsL?.bump();
    },
  });

  // Sign viewer: search, alphabetical list and A-Z strip; a clicked sign is shown (and repeated, if ticked).
  createSignBrowser([...new Set(Object.values(WORD_FORMS))], {
    aliases: WORD_FORMS,
    alphabet,
    holdMs,
    onPress: press,
    onRelease: release,
    onFinish: () => say(null),
  });

  let heldKey = null;
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.target.tagName === 'SELECT') return;
    if (e.key === 'Escape') return say(null);
    const letter = e.key.toUpperCase();
    if (letter in LETTERS) {
      heldKey = letter;
      press(letter);
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key.toUpperCase() === heldKey) {
      heldKey = null;
      release();
    }
  });
}
