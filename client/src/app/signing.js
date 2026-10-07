import { LETTERS } from '../character/mouth.js';
import { SIGNS, WORD_FORMS, MOTION_LEAD } from '../signing/hands.js';
import { app } from './session.js';

/** How long a sign is held when it is played in a row: a word sign that moves until its motion has played. */
export const holdMs = (sign) => (SIGNS[sign]?.motion ? (MOTION_LEAD + SIGNS[sign].motion.duration) * 1000 + 250 : 450);

// text: what was typed for a word sign (an alias such as "PALJU ÕNNE"), which the mouth then says; defaults to the sign's own word
export function say(letter, text = letter) {
  const { mouth, hands, handsL } = app.character ?? {};
  if (WORD_FORMS[letter] === letter) { // a word sign (also one just added in the editor)
    // the mouth follows the hand: it starts when the sign's motion does and spreads the word over it
    mouth?.speak(text, { duration: SIGNS[letter].motion?.duration, delay: SIGNS[letter].motion ? MOTION_LEAD : 0 });
  } else mouth?.setViseme(LETTERS[letter] ?? 'rest');
  hands?.setSign(letter);
  handsL?.setSign(letter); // joins in two-handed letters, otherwise stays in standby
  app.panel?.setActive(letter);
}

export function press(letter, text) {
  say(letter, text);
  app.dock?.setSign(letter);
}

// After release the hands stay in the last sign (the panel keeps it highlighted); only the mouth returns to rest.
// Escape sends the hands back to standby.
export function release() {
  app.character?.mouth?.setViseme('rest');
}
