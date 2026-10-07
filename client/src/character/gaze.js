import * as THREE from 'three';
import { detectRig } from './rigs.js';

// The eyes follow the mouse cursor. The cursor is turned into a point in space: the point on the camera ray through the
// cursor that lies as far from the camera as the eyes do. Each eye then turns to look at that point, within a limited
// cone (real eyes can't roll all the way round). With no cursor on the page the eyes look at the camera.
//
// The eye bones' own axes differ from rig to rig, so the turn is worked out in the bone's parent space as the rotation
// from the rest look direction (the model's +Z, "forward") to the direction of the target, then applied on top of the
// bone's rest rotation.
const GAZE_CONFIG = {
  maxAngle: 20, // degrees an eye can turn away from straight ahead
  smoothing: 14, // higher = snappier
};

export function createGaze(root, { camera }) {
  const rig = detectRig(root);
  if (!rig) return null;
  root.updateMatrixWorld(true);
  const eyes = rig.eyes
    .map((name) => root.getObjectByName(name))
    .filter(Boolean)
    .map((bone) => {
      // the rest look direction in the parent's space, and the rotation the eye has turned by so far
      const restForward = new THREE.Vector3(0, 0, 1).applyQuaternion(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
      return { bone, restQ: bone.quaternion.clone(), restForward, turn: new THREE.Quaternion() };
    });
  if (!eyes.length) return null;

  const pointer = new THREE.Vector2();
  let hasPointer = false;
  const onMove = (e) => {
    pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    hasPointer = true;
  };
  window.addEventListener('pointermove', onMove);
  document.documentElement.addEventListener('pointerleave', () => (hasPointer = false));

  const maxAngle = () => THREE.MathUtils.degToRad(GAZE_CONFIG.maxAngle);
  const raycaster = new THREE.Raycaster();
  const eyeWorld = new THREE.Vector3();
  const target = new THREE.Vector3();
  const local = new THREE.Vector3();
  const want = new THREE.Quaternion();
  const full = new THREE.Quaternion();
  const identity = new THREE.Quaternion();

  return {
    /** Turn the eyes towards the cursor; call each frame after the rest of the face has been posed. */
    update(dt) {
      const mid = new THREE.Vector3();
      for (const { bone } of eyes) mid.add(bone.getWorldPosition(eyeWorld));
      mid.divideScalar(eyes.length);

      if (hasPointer) {
        raycaster.setFromCamera(pointer, camera);
        target.copy(raycaster.ray.direction).multiplyScalar(camera.position.distanceTo(mid)).add(raycaster.ray.origin);
      } else {
        target.copy(camera.position);
      }

      const k = 1 - Math.exp(-GAZE_CONFIG.smoothing * dt);
      for (const eye of eyes) {
        const { bone, restQ, restForward, turn } = eye;
        bone.parent.updateWorldMatrix(true, false);
        local.copy(target);
        bone.parent.worldToLocal(local).sub(bone.position).normalize();
        full.setFromUnitVectors(restForward, local);
        want.copy(full);
        const angle = 2 * Math.acos(Math.min(1, Math.abs(full.w)));
        if (angle > maxAngle()) want.copy(full).slerpQuaternions(identity, full, maxAngle() / angle);
        turn.slerp(want, k);
        bone.quaternion.copy(turn).multiply(restQ);
      }
    },
  };
}
