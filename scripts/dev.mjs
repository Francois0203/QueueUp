// Local development: Firebase emulators (Auth, Firestore, Functions) + Vite with hot reload.
// Open http://localhost:3000. Uses the offline "demo-queueup" project: no cloud resources, no cost.
// Requires Java 21+ for the Firestore emulator.
import { spawn } from 'node:child_process';

const isWin = process.platform === 'win32';
const env = { ...process.env, USE_EMULATORS: 'true', FIREBASE_PROJECT_ID: 'demo-queueup' };

const procs = [
  spawn(isWin ? 'firebase.cmd' : 'firebase', ['emulators:start', '--project', 'demo-queueup', '--only', 'auth,firestore,functions'], { stdio: 'inherit', env, shell: isWin }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit', env }),
];

const stop = () => { for (const p of procs) p.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', code => { if (code) stop(); });
