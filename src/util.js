// Small helpers shared by the editor (ui/fineTuner.js), the sign definitions (signing/signDefs.js) and the search boxes.

/** JSON text of a value with the object keys sorted, so equal data gives equal text. */
export const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

/** Short fingerprint of a text, to tell which file state a working copy was made against. */
export const fingerprint = (text) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};

/** Compare without accents and case, one character for one (positions in the text stay valid): "aitah" finds AITÄH. */
export const fold = (t) => [...t].map((c) => c.normalize('NFD')[0].toUpperCase()).join('');
