// Estonian display names of the named base poses (shared.json `orient`) and thumb poses (`thumbPoses`). The keys stay as they are (the
// signs and the server's documents refer to them); only the dropdowns show these. A name without an entry here (a pose someone added)
// is shown as it is.
const ORIENT_LABELS = {
  up: 'Püsti',
  ready: 'Ootel',
  relaxed: 'Lõdvalt',
  tere: 'Tere',
  faceSide: 'Näo kõrval',
  pray: 'Palve',
  flat: 'Lame',
  flatLow: 'Lame, madalamal',
  fist: 'Rusikas',
  thumbsUp: 'Pöial püsti',
  no: 'Ei',
  pointSelf: 'Näitab iseendale',
  pointFwd: 'Näitab ette',
  cup: 'Kauss',
  gather: 'Kogumine',
  offer: 'Pakkumine',
  sweep: 'Pühkimine',
  fistFlat: 'Rusikas, peopesa all',
  palmSelf: 'Peopesa enda poole',
  temple: 'Oimukoht',
  mouth: 'Suu ees',
  across: 'Risti rinna ees',
  stack: 'Üksteise peal',
  flatFwd: 'Lame ettepoole',
  pointDown: 'Näitab alla',
  saama: 'Saama',
};

const THUMB_LABELS = {
  rest: 'Puhkeasend',
  across: 'Üle peopesa',
  out: 'Väljas (L-kuju)',
  side: 'Rusika kõrval',
  up: 'Püsti',
  ring: 'Rõngas',
  opposed: 'Vastakuti (C)',
};

export const orientLabel = (name) => ORIENT_LABELS[name] ?? name;
export const thumbLabel = (name) => THUMB_LABELS[name] ?? name;
