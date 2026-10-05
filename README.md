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
- **Word signs** (typed in the text box) get mouthing too: the mouth goes through the word's letter shapes while the hand signs it (for an alias such as "PALJU ÕNNE", the words as typed).
- Supported letters: `A–Z` as used in Estonian, including `Š Ž Õ Ä Ö Ü`. Some letters, such as `X` and `Q`, are two-handed.
- **Drag** to orbit, **scroll** to zoom. The *Vaade* panel has zoom buttons, camera presets (front, back, sides, top, three-quarter) and a *signer's view*, which looks at the signing hand from just in front of the eyes, like the finger-spelling chart.
- **Word signs** live in [src/data/words.json](src/data/words.json): *tere, head aega, aitäh, palun, vabandust, jah, ei, hea, hästi, õnnitlema* (also typed as *palju õnne*), and the topic *Inimesed ja asesõnad*: *mina, sina, tema, meie, teie, teie viisakusvorm, nemad* (also *nad*), *inimene, nimi, ise, kõik*, and the question words *kes, mis, milline, kus, kuhu, kust, millal, miks, kuidas, kui palju* (also *mitu*), and the family and close ones *ema, isa, laps, poeg, tütar, vend, õde, vanaema, vanaisa, sõber*, and communication and learning *viipekeel, viiplema, kurt, kuulja, aru saama, teadma, küsima, vastama, kordama, õppima*, wishes and needs *tahtma, vajama, saama* (also *suutma*), *oskama, aitama, ootama, meeldima, armastama, andma, võtma*, and everyday actions *sööma, jooma, magama, ärkama, minema, tulema, tegema, töötama, mängima, pesema*, and the words that build a sentence *olema* (also *on*), *pole* (also *ei ole*), *ja, või, aga, ka, veel, juba, ainult, mitte, sest, kui, siis*, and the topics time, calendar, places, food and drink, feeling and health, and qualities: *praegu, täna, homme, eile, hommik, päev, õhtu, öö, enne, pärast, esmaspäev, teisipäev, kolmapäev, neljapäev, reede, laupäev, pühapäev, nädal, kuu, aasta, kodu, kool, lasteaed, töökoht, pood, haigla, apteek, tualett, õu, linn, vesi, piim, kohv, tee, leib, puder, supp, liha, kala, õun, rõõmus, kurb, väsinud, haige, terve, valu, nälg, janu, arst, ravim, suur, väike, halb, uus, vana, soe, külm, kiire, aeglane, siin, seal, üleval, all, sees, väljas, vasakul, paremal, lähedal, kaugel, telefon, arvuti, internet, video, raamat, paber, pliiats, laud, tool, uks, raha, hind, ostma, maksma, kallis, odav, buss, auto, pilet, peatus* (see the `signs` keys in words.json). Type the whole word or phrase into the text box and it is shown as one sign instead of letter by letter. While typing, a suggestion list of the known words appears (accents ignored; ↑/↓ and Enter or Tab, or a click, complete the word). They follow the EKI sign-language dictionary videos; the hand motions (waves, finger folding, palm turning, wrist nods) are `motion` paths, described in [src/signing/hands.js](src/signing/hands.js).
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

## Fine-tuning signs (*Peenhäälestus*)

On the dev server the **Peenhäälestus** button (top right) opens one horizontal window along the bottom of the screen: blocks with the settings on top, the motion timeline below. The scene moves up to stay above it; drag the window's top edge to change its height. It remembers whether it was open.

**Blocks**

- **Märk:** search for a letter or a word (accents don't matter, Enter picks the first hit) or click one in the list; a dot marks signs with unsaved changes. *Parem käsi* / *Vasak käsi* choose which hand the blocks and the timeline edit (the left hand can be added to or removed from a sign). *Ooteasend tähtede vahel* keeps the hands in the standby pose between signs.
- **Käe asend:** the named orient (`dir`) plus this sign's own changes to it: wrist position (`reach`), elbow direction (`pole`), which way the fingers and thumb point, the wrist bend limit. Changes are kept in the sign as `orient` and never touch other signs that use the same named orient. It also shows *Randme väänd*, the twist of the hands against the forearms.
- **Sõrmed:** curl, spread and knuckle bend of each finger and the thumb pose. (The finger-spelling letters have no finger data, only bone tweaks: *Määra sõrmeandmed* adds it.)
- **Luu peenhäälestus:** the rotation of any bone (arms and fingers, face and lips, body) and the weight of any face shape key. Pick a group and a bone (from the list, or by clicking its marker in the scene) and use the sliders. Tweaks apply per sign for the face and the signing arm, to the standby pose for the other arm, and always for the body. Optionally mirror the edit to the opposite side.
- **Kopeeri teisest märgist:** copy bone tweaks from another sign (whole sign, the chosen group or the chosen bone), with one step of undo.

**Timeline (*Liikumine*)** shows the sign's motion path, one track per channel (`x y z tilt flex roll curl`, see [src/signing/hands.js](src/signing/hands.js)). The character holds the sign at the playhead while you edit; *▶ Mängi* plays it. The points of the path are the dots:

- drag a dot up or down to change that channel of the point; the number fields next to *Punkt n/m* set it exactly;
- click or drag in the ruler or between the tracks to move the playhead; double-click a track (or *+ Punkt*) to add a point there; *− Punkt* removes the selected one;
- the points sit where the character reaches them: each segment gets a share of the *Kestus* in proportion to its length, so changing a point also moves the ones after it. *Hajutus* (`stagger`) lets the fingers take the curl channel one after the other.

Edits are kept in `localStorage` as a working copy. To commit them, press **Salvesta faili**. It asks for the PIN and writes the changed sign definitions and bone tweaks into [src/data/fingerspelling.json](src/data/fingerspelling.json) (letters) or [src/data/words.json](src/data/words.json) (word signs), whichever file holds the sign (the signs' notes are kept; the files are rewritten in the compact layout). It works **only on the dev server**. *Lähtesta märk* sends the sign's definition back to what the file holds; *Lae failist* drops the whole working copy.

### Fixing a sign that looks wrong

1. **Open it frozen:** `http://localhost:5173/?sign=HEA` (or another letter / word) holds the sign still; `&at=0.5` also holds its motion half way. `?colliders=1` draws the body shape the arms are kept out of.
2. **The sign itself** (where the hand is, the elbow, the fingers, the motion): the *Käe asend*, *Sõrmed* blocks and the timeline of *Peenhäälestus*. **Small things** (a single finger, the thumb, the hand's angle): its *Luu peenhäälestus* block. Pick the sign and bone, adjust, save.
3. **The arm looks twisted:** *Käe asend* shows *Randme väänd* (the hand's twist against the forearm). Up to about ±100° is natural (palm to the body is about 0°, palm facing out about 90°); beyond that the forearm looks wrung. The cause is nearly always the elbow's position: change `pole` of the sign's orient in [src/data/shared.json](src/data/shared.json) (the direction the elbow points; `[-1, -0.6, 0.2]` = out and down) and watch the number. The same file holds `reach` (where the wrist is, in arm lengths from the shoulder) and `finger` / `thumb` (which way the hand points). Hand angles that fight the forearm direction also bend the wrist; keep `finger` roughly along the line from the elbow to the wrist.
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
    signDefs.js         sign definitions edited in the fine-tuning window (baseline, working copy)
    twist.js            shares the wrist twist over the forearm (skin)
    body.js             trunk / head collision shape (keeps arms out of the body)
  ui/                   panels
    draggable.js        draggable, position-remembering panels
    letterPanel.js      letter buttons
    viewControls.js     camera panel
    signBrowser.js      sign viewer: search, alphabetical list, A-Z strip, repeat checkbox
    fineTuner.js        fine-tuning window: sign search, hand pose, fingers, bones, motion timeline
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

- `signs`: per letter, finger `curl` (0 straight to 1 fully curled), optional `spread` and `knuckle`, an `orient` (`dir`), a thumb pose, and optional `tweaks` from the fine-tuning window.
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
