// What a sign's definition may hold and what a new sign may be called. Read by signDefs.js (the editor) and by vite.config.js,
// whose save endpoint checks the same rules again before it writes a file.

/** The fields of a sign's definition, in the order they are written (`note` and `tweaks` are not part of it). */
export const SIGN_FIELDS = ['curl', 'thumb', 'spread', 'knuckle', 'dir', 'orient', 'motion', 'left'];

/** A new sign's name: what is typed to get it; 2-40 letters, digits, spaces or hyphens (it is also upper-cased, see signDefs.js). */
export const SIGN_NAME = /^[\p{L}\p{N}][\p{L}\p{N} -]{1,39}$/u;
