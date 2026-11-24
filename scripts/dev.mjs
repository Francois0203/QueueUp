// Local development: Firebase emulators (Auth, Firestore, Functions) + Vite with hot reload.
// Open http://localhost:3000. Uses the offline "demo-queueup" project: no cloud resources, no cost.
// Requires Java 21+ for the Firestore emulator (found automatically, see emulators.mjs).
import { spawn } from 'node:child_process';
import { firebase } from './emulators.mjs';

const env = { ...process.env, USE_EMULATORS: 'true', FIREBASE_PROJECT_ID: 'demo-queueup' };

const procs = [
  firebase(['emulators:start', '--project', 'demo-queueup', '--only', 'auth,firestore,functions'], env),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit', env }),
];

const stop = () => { for (const p of procs) p.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', code => { if (code) stop(); });
