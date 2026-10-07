// Starts the API server and the Vite dev server together; Ctrl+C stops both.
import { spawn } from 'node:child_process';

const run = (name, workspace) =>
  spawn('npm', ['run', 'dev', '-w', workspace], { stdio: 'inherit', shell: process.platform === 'win32' }).on('exit', (code) => {
    console.log(`[dev] ${name} exited (${code})`);
    stop();
  });

const children = [run('server', 'server'), run('client', 'client')];
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill();
  setTimeout(() => process.exit(0), 300);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
