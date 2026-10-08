// What a sign's definition may hold and what a new sign may be called. Read by signDefs.js (the editor); the server has the same rules in server/src/signs/validate.ts,
// which checks them again before it saves.

/** The fields of a sign's definition, in the order they are written (`note` and `tweaks` are not part of it). */
export const SIGN_FIELDS = ['curl', 'thumb', 'spread', 'knuckle', 'dir', 'orient', 'motion', 'left'];

/** A new word sign's (viip) name: what is typed to get it; 2-40 letters, digits, spaces or hyphens (it is also upper-cased, see signDefs.js). */
export const SIGN_NAME = /^[\p{L}\p{N}][\p{L}\p{N} -]{1,39}$/u;
/** A new letter's (sõrmend) name: one letter (upper case) or digit. A letter goes into the fingerspelling, a word into the word signs. */
export const LETTER_NAME = /^[\p{L}\p{N}]$/u;
/** Whether a sign is a letter (sõrmend: one character) or a word (viip). */
export const isLetterName = (name) => LETTER_NAME.test(name);
