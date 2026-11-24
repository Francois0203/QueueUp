// QueueUp Cloud Functions (2nd gen, europe-west1).
// One callable "api" handles every operation, so a single warm instance serves everything
// (fewer cold starts, lower cost). Instances are capped to keep the bill at ~$0.
import { initializeApp } from 'firebase-admin/app';
import { setGlobalOptions, logger } from 'firebase-functions';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { ops, cleanupIdleParties } from './src/ops.js';

initializeApp();

/**
 * Best-effort client IP. Google's front end APPENDS the real client address to X-Forwarded-For,
 * so the last entry is trustworthy; earlier entries (and req.ip under "trust proxy") can be forged.
 * Limits never rely on IP alone: they also key on the signed-in identity and the party.
 */
function clientIp(req) {
  const xff = String(req?.headers?.['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  return xff.pop() || req?.socket?.remoteAddress || '';
}

setGlobalOptions({ region: 'europe-west1', maxInstances: 3 });

export const api = onCall(
  {
    memory: '256MiB',
    cpu: 1,              // needed for concurrency > 1
    concurrency: 40,     // one instance serves a whole party
    timeoutSeconds: 30,
    // Turn on once App Check (reCAPTCHA Enterprise) is set up: blocks scripted abuse of the API.
    enforceAppCheck: process.env.ENFORCE_APP_CHECK === 'true',
  },
  async request => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Please reload the page.');
    const { op, ...data } = request.data || {};
    const fn = Object.hasOwn(ops, op) ? ops[op] : null;
    if (!fn) throw new HttpsError('invalid-argument', 'Unknown operation.');
    try {
      return await fn(data, { uid: request.auth.uid, ip: clientIp(request.rawRequest) });
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      logger.error(`api.${op} failed`, e);
      throw new HttpsError('internal', 'Something went wrong. Try again.');
    }
  },
);

export const cleanup = onSchedule({ schedule: 'every 24 hours', memory: '256MiB', timeoutSeconds: 300 }, cleanupIdleParties);
