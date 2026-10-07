import * as THREE from 'three';
import { LETTERS } from './character/mouth.js';
import { SIGNS, ORIENT, THUMB_POSES, HAND_CONFIG } from './signing/hands.js';
import { detectRig } from './character/rigs.js';
import * as signDefs from './signing/signDefs.js';

// URL parameters: ?blink=0..1 freezes the lids at that closure, ?face=1 frames the face (?face=mouth the mouth),
// ?openAngle=, ?closedAngle=, ?scale= override the eyelid dome. ?viseme=O freezes the mouth in that shape,
// ?sign=B freezes the hand in that letter's finger-spelling sign (?at=0..1 also holds its motion at that fraction), ?gaze=0 keeps the eyes from following the cursor,
// ?guard=0 turns the body collision off, ?colliders=1 draws its shape and the hand capsules (red where they are inside each other),
// ?audit=1 shows every sign and writes the contacts between the hands' capsules into #audit-result (see signing/audit.js).

/** window.__app, the hook for debugging in the console (`app`: the parts of the loaded model), and the ?audit=1 result. */
export function installDebug(app, { params, pose }) {
  window.__app = {
    THREE, signDefs, LETTERS, SIGNS, ORIENT, THUMB_POSES, HAND_CONFIG,
    rig: detectRig(app.root),
    ...app,
    show: pose.show,
    audit: pose.audit,
    setGuards: (on) => (pose.guards = on),
  };
  window.__modelReady = true;
  if (params.has('audit') && app.handHits) {
    const result = pose.audit();
    window.__audit = result;
    const out = document.createElement('pre');
    out.id = 'audit-result';
    out.textContent = JSON.stringify(result);
    document.body.appendChild(out);
  }
}
