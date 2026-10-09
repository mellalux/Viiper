import { createSplash } from './ui/splash.js';
import { createStage } from './stage.js';
import { createPanels } from './app/panels.js';
import { startLoop } from './app/loop.js';
import { loadModel } from './app/loadModel.js';
import { createAccountMenu } from './ui/account.js';
import { createAboutButton } from './ui/about.js';

const splash = createSplash();
const stage = createStage();
createPanels();
createAccountMenu();
createAboutButton();
startLoop(stage);
loadModel(stage, splash);
