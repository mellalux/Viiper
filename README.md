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
| `?sign=B` | Freeze the hand in that letter's sign |
| `?viseme=O` | Freeze the mouth in that viseme |
| `?face=1` / `?face=mouth` | Frame the face / the mouth |
| `?gaze=0` | Keep the eyes from following the mouse cursor |
| `?blink=0..1` | Freeze the eyelids at that closure |
| `?openAngle=`, `?closedAngle=`, `?scale=` | Override the eyelid dome (Rigify) |

`window.__app` exposes the scene, rig, hands, mouth and tweaks in the browser console for debugging.

## Fine-tuning signs (bone editor)

The *Peenhäälestus* panel lets you adjust the rotation and position of any bone (arms and fingers, face and lips, body) and the weight of any face shape key.

1. Tick **Muuda märki** to hold a sign, then pick a letter, a group and a bone (from the list, or by clicking its marker in the scene).
2. Adjust it with the sliders. Tweaks apply per letter for the face and the signing arm. They apply to the standby pose for the other arm, and always for the body.
3. Optionally mirror the edit to the opposite side, or copy the tweaks from another letter.

Edits are kept in `localStorage` as a working copy. To commit them, press **Salvesta faili (signs.json)**. This writes them into [src/data/signs.json](src/data/signs.json) and works **only on the dev server**.

### Save PIN

Writing is guarded by a PIN, which the dev server checks (see [vite.config.js](vite.config.js)).

- On first start the server creates `.save-pin` (git-ignored) with a random 4-digit PIN and prints it in the terminal. Edit the file to change the PIN. Changes take effect immediately.
- Five wrong PINs in a row lock saving for one minute.
- Saving rewrites `signs.json` in a diff-friendly layout and keeps the file's line endings.

## Project layout

```
index.html              entry page
vite.config.js          Vite config + dev-only "save sign tweaks" plugin
public/                 static files served as-is
src/
  main.js               scene, model loading, render loop, keyboard input
  assets/models/        .glb character models (bundled by Vite)
  data/
    signs.json          all sign data: hand orientations, thumb poses, signs,
                        visemes, letter → viseme table, per-rig data, saved tweaks
  character/            the model's face and eyes
    rigs.js             skeleton profiles (Rigify, Character Creator)
    morphs.js           shared shape-key layer (mouth, blink and tweaks add up)
    mouth.js            visemes
    blink.js            eyelid blinking
    gaze.js             eyes follow the mouse cursor
  signing/              finger-spelling
    hands.js            poses and arm IK
    tweaks.js           hand-tuned bone / shape offsets layered on top of poses
  ui/                   panels
    draggable.js        draggable, position-remembering panels
    letterPanel.js      letter buttons
    viewControls.js     camera panel
    boneEditor.js       fine-tuning panel
```

### How a sign is described

`src/data/signs.json` is the source of truth and can be edited by hand.

- `orient`: where the hand is held and which way it points (world directions and a wrist target relative to the shoulder).
- `thumbPoses`: thumb joint rotations.
- `signs`: per letter, finger `curl` (0 straight to 1 fully curled), optional `spread` and `knuckle`, an `orient` (`dir`), a thumb pose, and optional `tweaks` from the bone editor.
- `visemes` and `letters`: mouth shapes and which letter uses which.
- `global`: tweaks that always apply (body).

Details are in the header comments of [src/signing/hands.js](src/signing/hands.js), [src/character/mouth.js](src/character/mouth.js) and [src/signing/tweaks.js](src/signing/tweaks.js).

## Notes

- The Draco decoder used for compressed models is loaded from Google's CDN. To self-host it, copy `node_modules/three/examples/jsm/libs/draco/` to `public/draco/` and change the path in [src/main.js](src/main.js).
- The editor UI is in Estonian.
