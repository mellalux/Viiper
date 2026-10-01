import * as THREE from 'three';

// The face mesh is a single low-poly skin with the eyelids baked in, so deforming it (lid bones,
// shape keys) tears the skin. Instead each eye gets a skin-coloured dome that pivots around the
// eyeball: open = dome tilted up/back (hidden inside the head), closed = dome swung down over the
// front of the eye, so the lid comes from above.
// (GLTFLoader strips dots from node names, so bones appear as eyeL, lidTL001, ...)
export const BLINK_CONFIG = {
  openAngle: -25, // degrees; dome rim sits this far above the eye's horizontal midline
  closedAngle: 75, // degrees; rim swings this far below it
  scale: 1.15, // dome radius relative to the eyeball
};

const EYE_BONE = /^eye([LR])$/;
const LID_UPPER_BONE = /^lidT/;

// Average skin colour around the lids, sampled from the base colour texture.
function sampleSkinColor(mesh, vertexIds) {
  const img = mesh.material.map?.image;
  const uv = mesh.geometry.attributes.uv;
  const fallback = new THREE.Color(0xe6b9a0);
  if (!img || !uv || !vertexIds.length) return fallback;
  const w = img.width;
  const h = img.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  let r = 0, g = 0, b = 0, count = 0;
  for (const i of vertexIds) {
    const x = Math.min(w - 1, Math.max(0, Math.floor(uv.getX(i) * w)));
    const y = Math.min(h - 1, Math.max(0, Math.floor(uv.getY(i) * h)));
    const [pr, pg, pb] = ctx.getImageData(x, y, 1, 1).data;
    if (pr + pg + pb < 330) continue; // skip dark pixels (lashes, shadow)
    r += pr; g += pg; b += pb; count++;
  }
  return count ? new THREE.Color(`rgb(${Math.round(r / count)},${Math.round(g / count)},${Math.round(b / count)})`) : fallback;
}

export function createBlinker(root, { interval = [2, 5], duration = 0.16 } = {}) {
  let mesh = null;
  root.traverse((o) => {
    if (o.isSkinnedMesh && !mesh && o.skeleton.bones.some((b) => EYE_BONE.test(b.name))) mesh = o;
  });
  const faceBone = root.getObjectByName('face');
  if (!mesh || !faceBone) return null;

  root.updateMatrixWorld(true);
  mesh.skeleton.update();
  const { position: pos, skinIndex, skinWeight } = mesh.geometry.attributes;
  const bones = mesh.skeleton.bones;

  // Vertices belonging to each eyeball (weighted to the eye bone) and to the upper lids.
  const eyeVerts = { L: [], R: [] };
  const lidVerts = [];
  for (let i = 0; i < pos.count; i++) {
    for (let k = 0; k < 4; k++) {
      if (skinWeight.getComponent(i, k) < 0.5) continue;
      const name = bones[skinIndex.getComponent(i, k)]?.name ?? '';
      const m = EYE_BONE.exec(name);
      if (m) eyeVerts[m[1]].push(i);
      else if (LID_UPPER_BONE.test(name)) lidVerts.push(i);
    }
  }

  const skin = new THREE.MeshStandardMaterial({
    color: sampleSkinColor(mesh, lidVerts),
    roughness: 0.75,
    metalness: 0,
  });

  // Pivots live under the face bone so the lids follow the head, but are oriented to the model's
  // world axes (+Y up, +Z forward) as in the bind pose.
  const faceQ = faceBone.getWorldQuaternion(new THREE.Quaternion());
  const domes = [];
  const v = new THREE.Vector3();
  for (const side of ['L', 'R']) {
    const ids = eyeVerts[side];
    if (!ids.length) continue;
    // current (skinned) world positions of the eyeball vertices
    const pts = ids.map((i) => mesh.localToWorld(mesh.applyBoneTransform(i, v.fromBufferAttribute(pos, i).clone())));
    const center = pts.reduce((c, p) => c.add(p), new THREE.Vector3()).divideScalar(pts.length);
    const radius = Math.max(...pts.map((p) => p.distanceTo(center)));

    const pivot = new THREE.Group();
    pivot.quaternion.copy(faceQ).invert();
    pivot.position.copy(faceBone.worldToLocal(center.clone()));
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(radius * BLINK_CONFIG.scale, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      skin,
    );
    pivot.add(dome);
    faceBone.add(pivot);
    domes.push(dome);
    console.info(`eye ${side}: ${ids.length} verts, radius ${radius.toFixed(4)}`);
  }
  if (!domes.length) return null;

  const rad = THREE.MathUtils.degToRad;
  const apply = (amount) => {
    const a = THREE.MathUtils.lerp(BLINK_CONFIG.openAngle, BLINK_CONFIG.closedAngle, amount);
    for (const dome of domes) dome.rotation.x = rad(a);
  };
  apply(0);

  let nextBlink = interval[0];
  let t = -1; // <0: idle, otherwise seconds into the current blink
  let elapsed = 0;

  return {
    apply,
    update(dt) {
      elapsed += dt;
      if (t < 0 && elapsed >= nextBlink) {
        t = 0;
        elapsed = 0;
      }
      if (t >= 0) {
        t += dt;
        const p = t / duration; // close in first half, open in second
        apply(Math.sin(Math.min(p, 1) * Math.PI));
        if (p >= 1) {
          t = -1;
          nextBlink = interval[0] + Math.random() * (interval[1] - interval[0]);
        }
      }
    },
  };
}
