import { SIGNS } from './hands.js';
import { auditSigns, summarize } from './audit.js';

/**
 * The arms' and hands' pose for a frame, everything in the right order, plus the debug helpers that pose both hands in a sign.
 * `holding()` tells whether the fine-tuning dock needs the motion held still; `pose.guards` turns the body and hand-to-hand guards off.
 */
export function createArmPose({ scene, hands, handsL, tweaks, limits, boneLimits, twist, handHits, handGuard, fingerGuard, holding = () => false, guards = true }) {
  const both = [hands, handsL];

  /** Everything posed for this frame (`frozen` holds the hands still; `tweakDt` lets the audit snap the tweaks). */
  function arms(dt, { frozen = false, tweakDt = dt } = {}) {
    tweaks?.setKey(hands?.key ?? null);
    tweaks?.step(tweakDt);
    tweaks?.applyPre(); // body offsets first: the arms' IK reads the shoulders
    for (const h of both) h?.update(frozen ? 0 : dt);
    tweaks?.applyPost(); // face, arms and fingers after hands.js / mouth.js have posed them
    limits?.apply(); // fingers can't bend the wrong way (after the tweaks, which may push them there)
    if (pose.guards) for (const [side, h] of [['R', hands], ['L', handsL]]) fingerGuard?.apply(side, Math.min(h?.weight ?? 0, 1)); // the thumb and the fingers are kept out of each other
    for (const h of both) {
      if (!h) continue;
      h.motionPaused = frozen || holding(); // tuning a sign needs it to hold still
      h.applyMotion(); // signs that move (Z) trace their path on top of the tuned pose
    }
    if (pose.guards) {
      // the hands are kept out of each other and out of the body; each pushes the other back a little, so several rounds
      for (let i = 0; i < 7; i++) {
        const separated = handGuard?.apply(Math.min(hands?.weight ?? 0, handsL?.weight ?? 0, 1));
        for (const h of both) h?.avoidBody();
        if (!separated && !handGuard?.touching()) break; // clear of each other, also after the body guard has had its say
      }
    }
    twist?.apply(); // the arms have their final pose: the forearm's twist bones follow the hand
  }

  /** Both hands in `sign` with its motion held at fraction r (null: none), everything posed at once. */
  function show(sign, r = null) {
    for (const h of both) {
      h?.snapSign(sign);
      h?.freezeMotion(r);
    }
    // twice: the fingers' curl along the motion path is read one pose late, so one pass would show the sign before it
    for (let i = 0; i < 2; i++) {
      arms(0, { frozen: true, tweakDt: 10 });
      boneLimits?.apply();
    }
    scene.updateMatrixWorld(true);
  }

  /** Show every sign through the real pose pipeline and measure the hands' capsules going into each other (signing/audit.js). */
  function audit() {
    const rows = auditSigns({ signs: SIGNS, show, hits: handHits });
    for (const h of both) h?.freezeMotion(null);
    return { rows, summary: summarize(rows) };
  }

  const pose = { guards, arms, show, audit };
  return pose;
}
