import fingerspellingFile from './fingerspelling.json';
import wordsFile from './words.json';
import limitsFile from './limits.json';

// The signs the page runs on. They come from the server (GET /api/data: the database, so edits made by the editors show at once);
// when the server cannot be reached, the copies the page was built with (the JSON files next to this one) are used instead, so the
// public page keeps working without a backend. The answer has the shape of the files, plus `versions` (what an edit is based on).
// This module waits for the answer (top-level await): everything that reads the data imports it from here.
const TIMEOUT_MS = 5000;

async function fetchData() {
  try {
    const res = await fetch('/api/data', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.fingerspelling?.signs || !data?.words?.signs || !data?.limits) throw new Error('unexpected answer');
    return data;
  } catch (err) {
    console.info('Using the signs the page was built with (no server data):', err.message);
    return null;
  }
}

const remote = await fetchData();

export const fingerspelling = remote?.fingerspelling ?? fingerspellingFile;
export const words = remote?.words ?? wordsFile;
export const limits = remote?.limits ?? limitsFile;
/** The hand orients and the thumb poses the editors saved ({ name: entry }, { rig: { name: pose } }): what shared.json holds is replaced by them (hands.js). */
export const orients = remote?.orients ?? {};
export const thumbPoses = remote?.thumbPoses ?? {};
/** The keyframes ({ sign: { n: points in its path, points: { index: { bone: entry } } } }) and what the base poses do with the body's bones ({ orient: { bone: entry } }). */
export const frames = remote?.frames ?? {};
export const poses = remote?.poses ?? {};
/** Save counters of the signs ("*global", "*limits", "*orients", "*thumbPoses", "*frames", "*poses" for the rest); the editor keeps it up to date. Empty when the data is the bundled copy. */
export const versions = remote?.versions ?? {};
/** Whether the data came from the server (only then can edits be saved). */
export const fromServer = !!remote;
