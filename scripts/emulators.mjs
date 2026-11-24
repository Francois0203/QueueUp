// Runs the Firebase CLI with a Java 21+ runtime for the emulators.
// Windows often has an old Java first on PATH (Oracle's "javapath"), so put the newest JDK in front.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const FIREBASE = path.resolve(import.meta.dirname, '../node_modules/firebase-tools/lib/bin/firebase.js');
const bin = home => path.join(home, 'bin');
const exe = process.platform === 'win32' ? 'java.exe' : 'java';

// `java -version` prints to stderr.
const javaVersion = dir => spawnSync(path.join(dir, exe), ['-version'], { encoding: 'utf8' }).stderr || '';
const major = text => {
  const m = /version "(\d+)(?:\.(\d+))?/.exec(text);
  return !m ? 0 : m[1] === '1' ? Number(m[2]) : Number(m[1]);
};

/** Folder holding a Java 21+ binary, or null to leave PATH alone. */
function findJava() {
  const homes = [];
  if (process.env.JAVA_HOME) homes.push(process.env.JAVA_HOME);
  if (process.platform === 'win32') {
    for (const vendor of ['Eclipse Adoptium', 'Java', 'Microsoft', 'Zulu']) {
      const root = path.join(process.env.ProgramFiles || 'C:\\Program Files', vendor);
      if (existsSync(root)) for (const d of readdirSync(root).sort().reverse()) homes.push(path.join(root, d));
    }
  }
  for (const home of homes) {
    if (existsSync(path.join(bin(home), exe)) && major(javaVersion(bin(home))) >= 21) return bin(home);
  }
  return null;
}

/** Start `firebase <args>` with Java 21+ on PATH. Returns the child process. */
export function firebase(args, env = process.env) {
  const javaBin = findJava();
  if (!javaBin) console.warn('Java 21+ not found. Install it (winget install EclipseAdoptium.Temurin.21.JDK) and open a new terminal.');
  const key = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';
  const childEnv = { ...env, NODE_OPTIONS: `${env.NODE_OPTIONS || ''} --no-deprecation`.trim() };
  if (javaBin) childEnv[key] = `${javaBin}${path.delimiter}${env[key] || ''}`;
  return spawn(process.execPath, [FIREBASE, ...args], { stdio: 'inherit', env: childEnv });
}

// `node scripts/emulators.mjs <firebase args>` runs the CLI directly (used by `npm test`).
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  firebase(process.argv.slice(2)).on('exit', code => process.exit(code ?? 1));
}
