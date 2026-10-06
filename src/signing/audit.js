// Dev check: shows every sign (at a few points of its motion) through the real pose pipeline and measures which capsules of the
// hands go into each other (handHits.js). ?audit=1 runs it after the model has loaded and writes the result as JSON into
// <pre id="audit-result"> (and window.__audit); `window.__app.audit()` runs it again from the console.
const SAMPLES = [0, 0.25, 0.5, 0.75, 1];

/**
 * @param signs the SIGNS table (sign name -> definition)
 * @param show (sign, r) puts both hands in that sign with its motion held at fraction r (null: no motion) and poses everything
 * @param hits what handHits.js built (measure())
 * @param keep only hits deeper than this many metres are listed
 */
export function auditSigns({ signs, show, hits, keep = 0.001 }) {
  const rows = [];
  for (const [name, sign] of Object.entries(signs)) {
    for (const r of sign.motion ? SAMPLES : [null]) {
      show(name, r);
      const found = hits.measure(keep).map((h) => ({ ...h, depth: Math.round(h.depth * 10000) / 10 })); // mm, one decimal
      rows.push({ sign: name, r, hits: found.slice(0, 12) });
    }
  }
  return rows;
}

/** The result as a readable ranking: per kind of contact, the signs with the deepest overlap. */
export function summarize(rows, top = 12) {
  const byKind = {};
  for (const { sign, r, hits } of rows) {
    for (const h of hits) {
      const k = (byKind[h.kind] ??= {});
      const best = k[sign];
      if (!best || h.depth > best.depth) k[sign] = { depth: h.depth, r, pair: `${h.a} ~ ${h.b}` };
    }
  }
  return Object.fromEntries(
    Object.entries(byKind).map(([kind, signs]) => [
      kind,
      {
        signs: Object.keys(signs).length,
        worst: Object.entries(signs)
          .sort((a, b) => b[1].depth - a[1].depth)
          .slice(0, top)
          .map(([sign, v]) => ({ sign, ...v })),
      },
    ]),
  );
}
