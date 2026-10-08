import { canon, fingerprint } from '../util.js';

// A table of named entries from shared.json (the hand orients, the thumb poses) as the editor changes them: the working copy of the table,
// in place (hands.js reads the table live, so a change shows at the next setSign). What the table held when the page loaded (shared.json
// with what the server has saved over it, see hands.js) is remembered as the baseline; an entry that differs from it is "changed".
// Changed entries are kept in localStorage under `storageKey` for the signed-in editor only (restoreDrafts is called only for a
// signed-in user) until the editor saves them to the server (the whole table; markSaved then makes it the baseline): everybody sees
// the saved table.
// `label` names the table in the console message about a dropped working copy.
export function createWorkingTable(table, storageKey, label) {
  const clone = (v) => structuredClone(v);
  const baseline = new Map(Object.entries(table).map(([k, o]) => [k, clone(o)]));

  const names = () => Object.keys(table);
  const baselineOf = (name) => clone(baseline.get(name) ?? {});
  /** The entry as it is now (a copy). */
  const get = (name) => clone(table[name] ?? {});
  const isChanged = (name) => canon(table[name] ?? null) !== canon(baseline.get(name) ?? null);
  const changedNames = () => names().filter(isChanged);

  /** Replace an entry; the object in the table stays the same one. */
  function set(name, entry) {
    const target = (table[name] ??= {});
    for (const k of Object.keys(target)) delete target[k];
    Object.assign(target, clone(entry));
  }
  /** Back to what shared.json holds. */
  const reset = (name) => set(name, baselineOf(name));

  /** The changed entries, for the undo snapshots: { name: entry }. */
  const exportAll = () => Object.fromEntries(changedNames().map((k) => [k, get(k)]));
  /** Put the entries back to a snapshot of exportAll: those in it as they were, all others as shared.json holds them. */
  function loadAll(snap) {
    for (const k of names()) set(k, snap?.[k] ?? baselineOf(k));
  }

  /** Keep the changed entries in localStorage (each with a fingerprint of the file's version it was made from). */
  function persist() {
    try {
      const drafts = Object.fromEntries(changedNames().map((k) => [k, { base: fingerprint(canon(baseline.get(k))), entry: get(k) }]));
      if (Object.keys(drafts).length) localStorage.setItem(storageKey, JSON.stringify(drafts));
      else localStorage.removeItem(storageKey);
    } catch {}
  }

  /** Put the working copy back (drafts made from an older version of shared.json are dropped). Call once at start, for a signed-in user. */
  function restoreDrafts() {
    let drafts = null;
    try {
      drafts = JSON.parse(localStorage.getItem(storageKey));
    } catch {}
    for (const [k, d] of Object.entries(drafts ?? {})) {
      if (baseline.has(k) && d?.entry && d.base === fingerprint(canon(baseline.get(k)))) set(k, d.entry);
      else console.info(`Dropped a stale working copy of the ${label} ${k} (shared.json has changed since it was made).`);
    }
    persist();
  }

  /** Back to the baseline (what the page loaded: shared.json with what the server had saved) for every entry, and the working copy is dropped. */
  function resetAll() {
    loadAll(null);
    persist();
  }

  /** The whole table as it is now (a copy): what is saved to the server. */
  const all = () => clone(table);
  /** The table was saved to the server: it is the baseline now, and the working copy is dropped. */
  function markSaved() {
    for (const [k, o] of Object.entries(table)) baseline.set(k, clone(o));
    persist();
  }

  return { names, baselineOf, get, all, isChanged, changedNames, set, reset, exportAll, loadAll, persist, restoreDrafts, resetAll, markSaved };
}
