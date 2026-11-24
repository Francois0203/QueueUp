import { httpsCallable } from 'firebase/functions';
import { FirebaseError } from 'firebase/app';
import { doc, getDoc } from 'firebase/firestore';
import { db, ensureUser, functions } from './firebase';

/** Error with the server's message and a Firebase code like "not-found" or "permission-denied". */
export class ApiError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

const apiFn = httpsCallable<Record<string, unknown>, unknown>(functions, 'api');

/** Calls an operation on the QueueUp API (one Cloud Function, see functions/src/ops.js). */
export async function call<T = { ok: true }>(op: string, data: Record<string, unknown> = {}): Promise<T> {
  await ensureUser();
  try {
    const res = await apiFn({ op, ...data });
    return res.data as T;
  } catch (e) {
    if (e instanceof FirebaseError) {
      const code = e.code.replace(/^functions\//, '');
      const offline = code === 'unavailable' && !navigator.onLine;
      throw new ApiError(offline ? 'You seem to be offline. Check your connection.' : e.message || 'Something went wrong.', code);
    }
    throw new ApiError('You seem to be offline. Check your connection.', 'unavailable');
  }
}

/** Does a party with this code exist? (reads the public party doc) */
export async function partyExists(code: string): Promise<{ name: string } | null> {
  await ensureUser();
  const snap = await getDoc(doc(db, 'parties', code));
  return snap.exists() ? { name: (snap.data().name as string) || 'Tonight' } : null;
}
