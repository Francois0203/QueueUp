import crypto from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';

export const fail = (code, message) => { throw new HttpsError(code, message); };

// Strip control characters, invisible characters and text-direction overrides
// (used to make names or titles display as something they are not).
const UNSAFE_CHARS = /[\p{Cc}​‎‏‪-‮⁠-⁤⁦-⁩﻿]/gu;
export const clean = (v, max) => String(v ?? '').replace(UNSAFE_CHARS, '').replace(/\s+/g, ' ').trim().slice(0, max);

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
export function randomCode() {
  let c = '';
  for (let i = 0; i < 5; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  return c;
}
export const isPartyCode = c => typeof c === 'string' && /^[A-Z0-9]{5}$/.test(c);

/**
 * In-memory sliding-window limiter (per function instance; instances are capped at a few,
 * so limits hold within a small factor). With record=false it only checks.
 */
const hits = new Map();
export function limited(key, max, windowMs, record = true) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter(t => now - t < windowMs);
  if (list.length >= max) { hits.set(key, list); return true; }
  if (record) list.push(now);
  hits.set(key, list);
  return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (!v.some(t => now - t < 3600_000)) hits.delete(k);
}, 600_000).unref();

/** HMAC over a track's fields, so guests can't alter search results before requesting. */
export function signTrack(key, t) {
  const payload = JSON.stringify([t.id, t.uri, t.title, t.artist, t.album, t.art, t.durationMs, t.explicit]);
  return crypto.createHmac('sha256', key).update(payload).digest('base64url');
}
export function verifyTrack(key, t, sig) {
  if (typeof sig !== 'string' || !t || typeof t !== 'object') return false;
  const expected = Buffer.from(signTrack(key, t));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

export const randomKey = () => crypto.randomBytes(32).toString('base64url');
export const timingSafeEqualStr = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};
