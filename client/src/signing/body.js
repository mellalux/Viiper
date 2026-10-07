import * as THREE from 'three';
import { detectRig } from '../character/rigs.js';

// A rough collision shape of the character's trunk and head, so hands.js can keep the arms and hands out of the body.
// The shape comes from the rig profile (rigs.js `body`, data in shared.json rigs.<rig>.body), in the model's own space:
//   sections  [[y, halfWidth, zFront, zBack], ...] from the hips up to the neck: at each height the trunk is an ellipse
//             that wide (x) and spans zFront..zBack (+z = the character's front); in between the values are interpolated
//   head      { center: [x, y, z], radius } a sphere
// A limb part (a point with a radius: the elbow, the palm, a finger tip) that is inside is pushed out radially from the
// middle of the section. A rig without `body` has no collision (createBody returns null).
export function createBody(root) {
  const data = detectRig(root)?.body;
  if (!data?.sections?.length) return null;
  const sections = [...data.sections].sort((a, b) => a[0] - b[0]);
  const head = data.head && { center: new THREE.Vector3(...data.head.center), radius: data.head.radius };

  const local = new THREE.Vector3();
  const out = new THREE.Vector3();

  /**
   * Where a point (world space) with the given radius has to move to be outside the body, as a displacement vector in
   * world space, or null when it is already clear.
   */
  function push(point, radius) {
    root.updateWorldMatrix(true, false);
    local.copy(point);
    root.worldToLocal(local);
    out.set(0, 0, 0);
    let hit = false;

    const lo = sections[0];
    const hi = sections[sections.length - 1];
    if (local.y >= lo[0] && local.y <= hi[0]) {
      let i = 1;
      while (i < sections.length - 1 && sections[i][0] < local.y) i++;
      const [a, b] = [sections[i - 1], sections[i]];
      const t = b[0] === a[0] ? 0 : (local.y - a[0]) / (b[0] - a[0]);
      const lerp = (k) => a[k] + (b[k] - a[k]) * t;
      const halfW = lerp(1) + radius;
      const zc = (lerp(2) + lerp(3)) / 2;
      const halfD = (lerp(2) - lerp(3)) / 2 + radius;
      const dx = local.x;
      const dz = local.z - zc;
      const d = Math.hypot(dx / halfW, dz / halfD);
      if (d < 1) {
        hit = true;
        if (d < 1e-4) out.set(0, 0, halfD); // dead centre: out through the front
        else out.set(dx * (1 / d - 1), 0, dz * (1 / d - 1));
      }
    }
    if (head) {
      const rel = local.clone().sub(head.center);
      const dist = rel.length();
      const min = head.radius + radius;
      if (dist < min) {
        hit = true;
        const away = dist < 1e-5 ? new THREE.Vector3(0, 0, 1) : rel.multiplyScalar(1 / dist);
        const disp = away.multiplyScalar(min - dist);
        if (disp.lengthSq() > out.lengthSq()) out.copy(disp);
      }
    }
    return hit ? out.clone().transformDirection(root.matrixWorld).multiplyScalar(out.length()) : null;
  }

  /** Debug: wire outlines of the shape (add to the scene; ?colliders=1). */
  function outline() {
    const group = new THREE.Group();
    const mat = new THREE.LineBasicMaterial({ color: 0x00ffaa, depthTest: false, transparent: true, opacity: 0.6 });
    const ring = (cx, cy, cz, rx, rz) => {
      const pts = Array.from({ length: 33 }, (_, i) => new THREE.Vector3(cx + Math.cos((i / 32) * Math.PI * 2) * rx, cy, cz + Math.sin((i / 32) * Math.PI * 2) * rz));
      return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
    };
    for (const [y, w, zf, zb] of sections) group.add(ring(0, y, (zf + zb) / 2, w, (zf - zb) / 2));
    if (head) {
      const { center: c, radius: r } = head;
      group.add(ring(c.x, c.y, c.z, r, r));
      for (const dy of [-0.5, 0.5]) group.add(ring(c.x, c.y + dy * r, c.z, r * Math.sqrt(0.75), r * Math.sqrt(0.75)));
    }
    root.add(group);
    return group;
  }

  return { push, outline };
}
