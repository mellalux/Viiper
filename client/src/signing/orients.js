import { ORIENT } from './hands.js';
import { createWorkingTable } from './workingTable.js';

// The named orients (shared.json, section `orient`: where a hand is held and which way it points) as the base-pose editor changes them.
// hands.js reads ORIENT live, so changing an entry here shows at the next setSign. A working copy until it is saved to the server: see workingTable.js.
export const { names, baselineOf, get, all, isChanged, changedNames, set, reset, exportAll, loadAll, persist, restoreDrafts, resetAll, markSaved } = createWorkingTable(ORIENT, 'viiper.orients', 'base pose');
