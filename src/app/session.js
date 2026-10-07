/** What the parts of the app share: the URL parameters (the debug ones are listed in debug.js) and the pieces that exist once the model has loaded. */
export const params = new URLSearchParams(location.search);

export const app = {
  character: null, // the loaded model's rig, hands and poses (character.js)
  dock: null, // the fine-tuning dock: sign definitions, bones, motion timeline (dev server only)
  panel: null, // the letter panel
};
