# Viiper

A 3D signing avatar that shows the **Estonian finger-spelling alphabet** (*sõrmendid*) together with the matching **mouth shape** for each letter. Press a letter and the character's right hand forms the sign while its lips form the viseme; release it and the mouth relaxes while the hand holds the sign (Esc returns it to a standby pose).

Built with [three.js](https://threejs.org/) and [Vite](https://vite.dev/). It runs in the browser, with no backend.

## Getting started

Requires Node.js.

```bash
npm install
npm run dev       # start the dev server
npm run build     # production build into dist/
npm run preview   # serve the production build
```

Open the URL Vite prints (usually http://localhost:5173).

## Using it

- **Hold a letter key** (or press a button in the letter panel) to show that letter's hand sign and mouth shape. Release it and the mouth relaxes, while the hand stays in the sign until you press another letter or **Esc** (back to standby).
- Supported letters: `A–Z` as used in Estonian, including `Š Ž Õ Ä Ö Ü`. Some letters, such as `X` and `Q`, are two-handed.
- **Drag** to orbit, **scroll** to zoom. The *Vaade* panel has zoom buttons, camera presets (front, back, sides, top, three-quarter) and a *signer's view*, which looks at the signing hand from just in front of the eyes, like the finger-spelling chart.
- **Word signs** live in [src/data/words.json](src/data/words.json): *tere, head aega, aitäh, palun, vabandust, jah, ei, hea, hästi, õnnitlema* (also typed as *palju õnne*). Type the whole word or phrase into the text box and it is shown as one sign instead of letter by letter. While typing, a suggestion list of the known words appears (accents ignored; ↑/↓ and Enter or Tab, or a click, complete the word). They follow the EKI sign-language dictionary videos; the hand motions (waves, finger folding, palm turning, wrist nods) are `motion` paths, described in [src/signing/hands.js](src/signing/hands.js).
- The eyes follow the mouse cursor (and look at the camera when the cursor leaves the page).
- All panels are draggable by their title bar and remember where you left them.

### Models

The default model is `src/assets/models/Kati.glb`. Put more `.glb` files in that folder and load one with the `model` query parameter (the file name without `.glb`):

```
http://localhost:5173/?model=ViiperGirl
```

Two rig types are supported (see [src/character/rigs.js](src/character/rigs.js)): **Rigify** (bone-based face) and **Character Creator** (face made of shape keys). The rig is detected automatically from the bone names.
If the model fails to load, a placeholder cube is shown.

### Debug query parameters

| Parameter | Effect |
| --- | --- |
| `?sign=B` | Freeze the hand in that letter's (or word's) sign; `&at=0..1` also holds its motion at that fraction |
| `?viseme=O` | Freeze the mouth in that viseme |
| `?face=1` / `?face=mouth` | Frame the face / the mouth |
| `?guard=0` | Turn the body collision off (arms may go into the trunk again) |
| `?colliders=1` | Draw the body's collision shape |
| `?gaze=0` | Keep the eyes from following the mouse cursor |
| `?blink=0..1` | Freeze the eyelids at that closure |
| `?openAngle=`, `?closedAngle=`, `?scale=` | Override the eyelid dome (Rigify) |

`window.__app` exposes the scene, rig, hands, mouth and tweaks in the browser console for debugging.

## Fine-tuning signs (bone editor)

The *Peenhäälestus* panel lets you adjust the rotation of any bone (arms and fingers, face and lips, body) and the weight of any face shape key.

1. Tick **Muuda märki** to hold a sign, then pick a letter, a group and a bone (from the list, or by clicking its marker in the scene).
2. Adjust it with the sliders. Tweaks apply per letter for the face and the signing arm. They apply to the standby pose for the other arm, and always for the body.
3. Optionally mirror the edit to the opposite side, or copy the tweaks from another letter.

Edits are kept in `localStorage` as a working copy. To commit them, press **Salvesta faili (fingerspelling.json)**. This writes them into [src/data/fingerspelling.json](src/data/fingerspelling.json) (letters) or [src/data/words.json](src/data/words.json) (word signs), whichever file holds the sign, and works **only on the dev server**.

### Sign editor (*Viipe seaded…*)

The button at the top of the *Peenhäälestus* panel opens a window for what makes a sign, as opposed to single bones. Pick a sign (letters and words) and a hand (*Parem käsi* / *Vasak käsi*; the left hand can be added to or removed from a sign):

- **Käe asend:** the named orient (`dir`) plus this sign's own changes to it: wrist position (`reach`), elbow direction (`pole`), which way the fingers and thumb point, the wrist bend limit. Changes are kept in the sign as `orient` and never touch other signs that use the same named orient.
- **Sõrmed:** curl, spread and knuckle bend of each finger and the thumb pose. (The finger-spelling letters have no finger data, only bone tweaks: *Määra sõrmeandmed* adds it.)
- **Liikumine:** the motion path as a table of points (`x y z tilt flex roll curl`, see [src/signing/hands.js](src/signing/hands.js)) and its duration. The character holds the sign at the *Asend teel* slider while you edit; *▶ Mängi* plays it.

Every change shows at once and is kept in the browser until *Salvesta faili* writes the changed signs into [src/data/fingerspelling.json](src/data/fingerspelling.json) or [src/data/words.json](src/data/words.json) (same PIN as the bone editor; the signs' notes and bone tweaks are kept; the files are rewritten in the compact layout). *Lähtesta see märk* goes back to what the file holds. The window is on the dev server only.

### Fixing a sign that looks wrong

1. **Open it frozen:** `http://localhost:5173/?sign=HEA` (or another letter / word) holds the sign still; `&at=0.5` also holds its motion half way. `?colliders=1` draws the body shape the arms are kept out of.
2. **The sign itself** (where the hand is, the elbow, the fingers, the motion): *Viipe seaded…* above. **Small things** (a single finger, the thumb, the hand's angle): the *Peenhäälestus* panel. Tick *Muuda märki*, pick the sign and bone, adjust, save.
3. **The arm looks twisted:** the panel shows *Randme väänd* (the hand's twist against the forearm). Up to about ±100° is natural (palm to the body is about 0°, palm facing out about 90°); beyond that the forearm looks wrung. The cause is nearly always the elbow's position: change `pole` of the sign's orient in [src/data/shared.json](src/data/shared.json) (the direction the elbow points; `[-1, -0.6, 0.2]` = out and down) and watch the number. The same file holds `reach` (where the wrist is, in arm lengths from the shoulder) and `finger` / `thumb` (which way the hand points). Hand angles that fight the forearm direction also bend the wrist; keep `finger` roughly along the line from the elbow to the wrist.
4. **The hand or elbow is inside the body:** the body collision usually moves it, but a hand that has to be pushed a lot means `reach` is wrong (more `z` = further forward).
5. **Motion:** `motion.path` in the sign (words.json) – see the comment in [src/signing/hands.js](src/signing/hands.js) for the numbers.

### Save PIN

Writing is guarded by a PIN, which the dev server checks (see [vite.config.js](vite.config.js)).

- On first start the server creates `.save-pin` (git-ignored) with a random 4-digit PIN and prints it in the terminal. Edit the file to change the PIN. Changes take effect immediately.
- Five wrong PINs in a row lock saving for one minute.
- Saving rewrites `fingerspelling.json` in a diff-friendly layout and keeps the file's line endings.

## Project layout

```
index.html              entry page
vite.config.js          Vite config + dev-only "save sign tweaks" plugin
public/                 static files served as-is
src/
  main.js               scene, model loading, render loop, keyboard input
  assets/models/        .glb character models (bundled by Vite)
  data/
    shared.json         data shared by all kinds of signs: hand orientations,
                        thumb poses, visemes, letter → viseme table, per-rig data
    fingerspelling.json the letters (curls, directions, motion) and saved tweaks
    words.json          word signs, same format as the letters (key = upper-case word)
  character/            the model's face and eyes
    rigs.js             skeleton profiles (Rigify, Character Creator)
    morphs.js           shared shape-key layer (mouth, blink and tweaks add up)
    mouth.js            visemes
    blink.js            eyelid blinking
    gaze.js             eyes follow the mouse cursor
  signing/              finger-spelling
    hands.js            poses and arm IK
    tweaks.js           hand-tuned bone / shape offsets layered on top of poses
    limits.js           finger joint limits
    signDefs.js         sign definitions edited in the sign editor (baseline, working copy)
    twist.js            shares the wrist twist over the forearm (skin)
    body.js             trunk / head collision shape (keeps arms out of the body)
  ui/                   panels
    draggable.js        draggable, position-remembering panels
    letterPanel.js      letter buttons
    viewControls.js     camera panel
    boneEditor.js       fine-tuning panel
    signEditor.js       sign editor window (orient, fingers, motion)
    pin.js              the save PIN dialog
```

### How a sign is described

`src/data/shared.json` and `src/data/fingerspelling.json` are the source of truth and can be edited by hand.

In `shared.json`:

- `orient`: where the hand is held and which way it points (world directions and a wrist target relative to the shoulder).
- `thumbPoses`: thumb joint rotations.
- `visemes` and `letters`: mouth shapes and which letter uses which.
- `rigs`: per-rig overrides (thumb poses, visemes).

In `fingerspelling.json`:

- `signs`: per letter, finger `curl` (0 straight to 1 fully curled), optional `spread` and `knuckle`, an `orient` (`dir`), a thumb pose, and optional `tweaks` from the bone editor.
- `global`: tweaks that always apply (body).

Details are in the header comments of [src/signing/hands.js](src/signing/hands.js), [src/character/mouth.js](src/character/mouth.js) and [src/signing/tweaks.js](src/signing/tweaks.js).

## Limits and collision

Two safety nets run last every frame, on top of the signs and the hand-tuned offsets, so a new sign can't break the model:

- **Finger joint limits** ([src/signing/limits.js](src/signing/limits.js), ranges in `limits.finger` of shared.json): every finger joint is clamped in curl (no bending backwards), spread and twist. The ranges are wide enough that none of the existing letters changes; they only catch extreme values.
- **Body collision** ([src/signing/body.js](src/signing/body.js), shape in `rigs.<rig>.body` of shared.json): the trunk is a stack of ellipses and the head a sphere. If the wrist, palm or fingers are inside, the hand is moved out (keeping its orientation) and the elbow is turned about the shoulder-wrist line until the arm is clear. A rig without a `body` shape has no collision.

`?colliders=1` draws the shape, `?guard=0` turns the collision off. Not covered: hand against hand, the thumb's joint limits, wrist and elbow angle limits.

## Notes

- The Draco decoder used for compressed models is loaded from Google's CDN. To self-host it, copy `node_modules/three/examples/jsm/libs/draco/` to `public/draco/` and change the path in [src/main.js](src/main.js).
- The editor UI is in Estonian.
