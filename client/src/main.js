import { createSplash } from './ui/splash.js';
import { createStage } from './stage.js';
import { createPanels } from './app/panels.js';
import { startLoop } from './app/loop.js';
import { loadModel } from './app/loadModel.js';

const splash = createSplash();
const stage = createStage();
createPanels();
startLoop(stage);
loadModel(stage, splash);
