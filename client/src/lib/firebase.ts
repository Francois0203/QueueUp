import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { connectFirestoreEmulator, initializeFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';

const cfg = __FIREBASE__;

export const app = initializeApp(cfg.config);

// App Check (reCAPTCHA Enterprise) blocks scripted abuse once a site key is configured.
if (cfg.appCheckKey && !cfg.emulators) {
  import('firebase/app-check').then(({ initializeAppCheck, ReCaptchaEnterpriseProvider }) => {
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(cfg.appCheckKey), isTokenAutoRefreshEnabled: true });
  });
}

export const auth = getAuth(app);
export const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
export const functions = getFunctions(app, 'europe-west1');

if (cfg.emulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}

/** Public site address (Spotify redirect + QR codes point here). */
export const PUBLIC_URL = cfg.publicUrl;
export const SPOTIFY_REDIRECT_URI = `${PUBLIC_URL}/auth/spotify/callback`;

/**
 * Every visitor gets an anonymous Firebase identity (no account, no personal data).
 * It's how votes are counted once and how a browser is recognised as a party's DJ.
 */
let userPromise: Promise<string> | null = null;
export function ensureUser(): Promise<string> {
  userPromise ??= new Promise<string>((resolve, reject) => {
    const stop = onAuthStateChanged(auth, user => {
      if (user) { stop(); resolve(user.uid); return; }
      signInAnonymously(auth).catch(e => { stop(); userPromise = null; reject(e); });
    });
  });
  return userPromise;
}
