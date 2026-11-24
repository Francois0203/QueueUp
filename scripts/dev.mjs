// Local development: Firebase emulators (Auth, Firestore, Functions) + Vite with hot reload.
// Open http://localhost:3000. Uses the offline "demo-queueup" project: no cloud resources, no cost.
// Requires Java 21+ for the Firestore emulator (found automatically, see emulators.mjs).
import { spawn, spawnSync } from 'node:child_process';
import { firebase } from './emulators.mjs';

const env = { ...process.env, USE_EMULATORS: 'true', FIREBASE_PROJECT_ID: 'demo-queueup' };

const emulators = firebase(['emulators:start', '--project', 'demo-queueup', '--only', 'auth,firestore,functions'], env);
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit', env });

/** Kill a process and everything it started (on Windows, kill() leaves the Java emulator running). */
function killTree(p) {
  if (p.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/T', '/F', '/PID', String(p.pid)], { stdio: 'ignore' });
  else p.kill('SIGTERM');
}

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  killTree(vite);
  // Ctrl+C also reaches the emulators: give them a moment to shut down cleanly, then force it.
  const force = setTimeout(() => { killTree(emulators); process.exit(0); }, 8000);
  if (emulators.exitCode !== null) { clearTimeout(force); process.exit(0); }
  emulators.on('exit', () => { clearTimeout(force); process.exit(0); });
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
vite.on('exit', stop);
emulators.on('exit', code => { if (!stopping) { killTree(vite); process.exit(code ?? 1); } });
