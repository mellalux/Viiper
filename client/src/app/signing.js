import { LETTERS } from '../character/mouth.js';
import { SIGNS, WORD_FORMS, MOTION_LEAD } from '../signing/hands.js';
import { app } from './session.js';

/** How long a sign is held when it is played in a row: a word sign that moves until its motion has played. */
export const holdMs = (sign) => (SIGNS[sign]?.motion ? (MOTION_LEAD + SIGNS[sign].motion.duration) * 1000 + 250 : 450);

// The sign a typed form shows: a word sign is itself, an alias its sign ("0" -> NULL), a letter itself.
export const signOf = (typed) => WORD_FORMS[typed] ?? typed;

// text: what was typed for a word sign (an alias such as "PALJU ÕNNE"), which the mouth then says; defaults to the sign's own word.
// A typed form with no mouth shape of its own (a digit: "0") has the sign's own word said instead ("null").
export function say(typed, text = typed) {
  const { mouth, hands, handsL } = app.character ?? {};
  const letter = signOf(typed);
  if (WORD_FORMS[letter] === letter) { // a word sign (also one just added in the editor)
    const spoken = [...text.toUpperCase()].some((ch) => LETTERS[ch]) ? text : letter;
    // the mouth follows the hand: it starts when the sign's motion does and spreads the word over it
    mouth?.speak(spoken, { duration: SIGNS[letter].motion?.duration, delay: SIGNS[letter].motion ? MOTION_LEAD : 0 });
  } else mouth?.setViseme(LETTERS[letter] ?? 'rest');
  hands?.setSign(letter);
  handsL?.setSign(letter); // joins in two-handed letters, otherwise stays in standby
  app.panel?.setActive(typeof text === 'string' && [...text].length === 1 ? text : letter); // (an alias that is a button of the panel lights its own button)
}

export function press(letter, text) {
  say(letter, text);
  app.dock?.setSign(signOf(letter));
}

// After release the hands stay in the last sign (the panel keeps it highlighted); only the mouth returns to rest.
// Escape sends the hands back to standby.
export function release() {
  app.character?.mouth?.setViseme('rest');
}
