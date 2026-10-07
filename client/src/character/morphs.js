// Shape keys (morph targets) of the loaded model, shared by everything that drives the face: the mouth, the blink and
// the hand-tuned offsets each write their weights into their own layer, and flush() writes the sum of the layers to
// every mesh that has the shape. That way no driver overwrites another's work.
export function createMorphs(root) {
  const targets = new Map(); // name -> [{ influences, index }] on every mesh that has the shape
  root.traverse((o) => {
    if (!o.morphTargetDictionary || !o.morphTargetInfluences) return;
    for (const [name, index] of Object.entries(o.morphTargetDictionary)) {
      if (!targets.has(name)) targets.set(name, []);
      targets.get(name).push({ influences: o.morphTargetInfluences, index });
    }
  });

  const layers = new Map(); // layer -> Map(name -> weight)
  const touched = new Set(); // names some layer has written (so they get reset to 0 when the weights return to 0)

  return {
    /** Every shape name the model has. */
    names: [...targets.keys()],
    has: (name) => targets.has(name),
    /** Weight `value` for shape `name` from `layer` (any string); layers add up. */
    set(layer, name, value) {
      if (!targets.has(name)) return;
      if (!layers.has(layer)) layers.set(layer, new Map());
      layers.get(layer).set(name, value);
      touched.add(name);
    },
    /** Write the summed weights to the meshes; call once per frame after all drivers have run. */
    flush() {
      for (const name of touched) {
        let sum = 0;
        for (const layer of layers.values()) sum += layer.get(name) ?? 0;
        for (const { influences, index } of targets.get(name)) influences[index] = sum;
      }
    },
  };
}
