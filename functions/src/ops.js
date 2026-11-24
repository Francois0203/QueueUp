// QueueUp party operations. Every write goes through here; Firestore rules forbid client writes.
import crypto from 'node:crypto';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { authorizeUrl, exchangeCode, clientFor, isClientId } from './spotify.js';
import { fail, clean, randomCode, isPartyCode, limited, signTrack, verifyTrack, randomKey, timingSafeEqualStr } from './util.js';

const TERMS_VERSION = '2026-11-24'; // bump when the Terms change materially
const IDLE_MS = 48 * 3600_000;      // parties idle this long are deleted
const CLOSED_TTL_MS = 3 * 3600_000; // played/dismissed requests kept this long
const QUEUED_TTL_MS = 2 * 3600_000; // 'Up next' songs that never played are cleared after this
const INVITE_TTL_MS = 10 * 60_000;  // one-time DJ links work this long

// DJ links are stored hashed, so a leaked database copy can't be used to sign in.
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

const DEFAULT_SETTINGS = {
  requestsOpen: true,
  votingOpen: true,
  maxPendingPerGuest: 3,
  allowExplicit: true,
  autoQueueAt: 0,
  showNames: true,
};

const db = () => getFirestore();
const publicUrl = () => (process.env.PUBLIC_URL || `https://${process.env.GCLOUD_PROJECT}.web.app`).replace(/\/$/, '');
export const redirectUri = () => `${publicUrl()}/auth/spotify/callback`;

function refs(code) {
  const party = db().doc(`parties/${code}`);
  return {
    party,
    dj: party.collection('private').doc('dj'),           // readable by signed-in DJs only
    secrets: party.collection('private').doc('secrets'), // never readable by clients
    requests: party.collection('requests'),
    meta: party.collection('requestMeta'),                // requester names (DJ only)
    guests: party.collection('guests'),
  };
}

async function loadParty(code) {
  if (!isPartyCode(code)) fail('invalid-argument', 'That party code isn’t valid.');
  const r = refs(code);
  const snap = await r.party.get();
  if (!snap.exists) fail('not-found', 'This party has ended or the code is wrong.');
  return { r, party: snap.data() };
}

async function loadDj(code, uid) {
  const { r, party } = await loadParty(code);
  const dj = (await r.dj.get()).data() || {};
  return { r, party, dj, isDj: Array.isArray(dj.djUids) && dj.djUids.includes(uid) };
}

async function requireDj(code, uid) {
  const ctx = await loadDj(code, uid);
  if (!ctx.isDj) fail('permission-denied', 'DJ login required.');
  return ctx;
}

// lastActive drives cleanup. Writing the party doc makes every guest re-read it,
// so it's refreshed at most every 10 minutes per party.
const lastTouched = new Map();
async function touch(r, code) {
  const now = Date.now();
  if (now - (lastTouched.get(code) || 0) < 10 * 60_000) return;
  lastTouched.set(code, now);
  // Awaited: once the function has replied it gets almost no CPU, so a background write could stall.
  await r.party.update({ lastActive: now }).catch(() => lastTouched.delete(code));
}

// ---------------------------------------------------------------- Spotify sessions

/**
 * Per-instance cache of each party's Spotify connection, so concurrent calls in one instance
 * share a single token refresh. Rotated tokens are persisted to Firestore straight away.
 */
const sessions = new Map();
const backoff = new Map();   // code -> time until which Spotify asked us to slow down
const searchCache = new Map();

async function session(r, code) {
  let s = sessions.get(code);
  if (!s || Date.now() - s.loadedAt > 30_000) {
    const sec = (await r.secrets.get()).data() || {};
    s = { r, conn: sec.spotify || null, signKey: sec.signKey, loadedAt: Date.now(), dirty: false };
    s.client = clientFor(() => s.conn, c => { s.conn = c; s.dirty = true; });
    sessions.set(code, s);
  }
  return s;
}
async function persist(s) {
  if (!s.dirty) return;
  s.dirty = false;
  await s.r.secrets.set({ spotify: s.conn }, { merge: true });
}

async function withSpotify(code, r, fn) {
  let s = await session(r, code);
  if (!s.conn?.auth) fail('failed-precondition', 'Spotify is not connected.');
  if ((backoff.get(code) || 0) > Date.now()) fail('resource-exhausted', 'Spotify is busy. Try again in a few seconds.');
  try {
    const out = await fn(s.client);
    await persist(s);
    return out;
  } catch (e) {
    await persist(s).catch(() => {});
    if (e.status === 429) backoff.set(code, Date.now() + Math.min(e.retryAfter || 5, 120) * 1000);
    if (e.revoked) {
      // Another instance may have rotated the refresh token meanwhile: reload and retry once.
      const used = s.conn?.auth?.refreshToken;
      sessions.delete(code);
      s = await session(r, code);
      if (s.conn?.auth && s.conn.auth.refreshToken !== used) {
        const out = await fn(s.client);
        await persist(s);
        return out;
      }
      logger.warn(`[${code}] Spotify auth lost: ${e.message}`);
      await disconnect(code, r);
    }
    throw e;
  }
}

async function disconnect(code, r) {
  sessions.delete(code);
  for (const k of searchCache.keys()) if (k.startsWith(`${code}:`)) searchCache.delete(k);
  const party = (await r.party.get()).data();
  const batch = db().batch();
  batch.set(r.secrets, { spotify: FieldValue.delete() }, { merge: true });
  batch.set(r.dj, { spotify: FieldValue.delete() }, { merge: true });
  batch.update(r.party, { spotifyConnected: false, ...(party?.nowPlaying?.source === 'spotify' ? { nowPlaying: null } : {}) });
  await batch.commit();
}

function spotifyFail(e) {
  if (e.code && typeof e.code === 'string' && e.httpErrorCode) throw e; // already an HttpsError
  if (e.status === 404) fail('failed-precondition', 'No active Spotify device. Open Spotify and start playing something first.');
  if (e.status === 403) fail('failed-precondition', 'Spotify refused to queue. Queuing needs Spotify Premium.');
  if (e.status === 429) fail('resource-exhausted', 'Spotify is busy. Try again in a few seconds.');
  if (e.revoked) fail('failed-precondition', 'Spotify disconnected. Reconnect it in Settings.');
  logger.error('Spotify error', e);
  fail('unavailable', 'Spotify is unavailable right now.');
}

// ---------------------------------------------------------------- helpers

async function queueRequest(code, r, party, id, data) {
  if (party.spotifyConnected && data.track.uri) {
    try { await withSpotify(code, r, c => c.addToQueue(data.track.uri)); } catch (e) { spotifyFail(e); }
  }
  await r.requests.doc(id).update({ status: 'queued', queuedAt: Date.now() });
}

async function maybeAutoQueue(code, r, party, id, votes) {
  const n = party.settings?.autoQueueAt || 0;
  if (n > 0 && votes >= n) {
    const doc = await r.requests.doc(id).get();
    if (doc.exists && doc.data().status === 'pending') {
      try { await queueRequest(code, r, party, id, doc.data()); } catch (e) { logger.warn(`[${code}] auto-queue failed`, e.message); }
    }
  }
}

/**
 * Close a request (played, dismissed or skipped). It's stamped with expireAt, and Firestore's TTL
 * policy deletes it and its requester name after that, even if the party goes quiet.
 */
function closeRequest(batch, r, ref, status, now = Date.now()) {
  const expireAt = Timestamp.fromMillis(now + CLOSED_TTL_MS);
  batch.update(ref, { status, closedAt: now, expireAt, ...(status === 'played' ? { playedAt: now } : {}) });
  batch.set(r.meta.doc(ref.id), { expireAt }, { merge: true });
}

/**
 * Housekeeping while a party is busy (at most every 10 minutes): delete closed requests now rather
 * than waiting for TTL, and clear "Up next" songs that never played (removed from Spotify's queue,
 * or a DJ without Spotify who never marked them).
 */
const lastTidied = new Map();
async function tidy(code, r) {
  const now = Date.now();
  if (now - (lastTidied.get(code) || 0) < 10 * 60_000) return;
  lastTidied.set(code, now);
  const [old, queued] = await Promise.all([
    r.requests.where('closedAt', '<', now - CLOSED_TTL_MS).limit(100).get(),
    r.requests.where('status', '==', 'queued').get(),
  ]);
  const stale = queued.docs.filter(d => d.data().queuedAt < now - QUEUED_TTL_MS);
  if (old.empty && !stale.length) return;
  const batch = db().batch();
  old.forEach(d => { batch.delete(d.ref); batch.delete(r.meta.doc(d.id)); });
  stale.forEach(d => closeRequest(batch, r, d.ref, 'skipped', now));
  await batch.commit();
}

/**
 * A song started playing: close its requests as played. Spotify plays its queue in order, so if it
 * was queued, anything queued before it that hasn't played was skipped or removed: clear those too.
 */
async function markPlayed(r, trackId) {
  const [mine, queued] = await Promise.all([
    r.requests.where('trackId', '==', trackId).where('status', 'in', ['pending', 'queued']).get(),
    r.requests.where('status', '==', 'queued').get(),
  ]);
  if (mine.empty) return;
  const now = Date.now();
  const batch = db().batch();
  mine.forEach(d => closeRequest(batch, r, d.ref, 'played', now));
  const at = Math.max(...mine.docs.map(d => (d.data().status === 'queued' ? d.data().queuedAt : 0)));
  if (at > 0) {
    queued.docs
      .filter(d => d.data().trackId !== trackId && d.data().queuedAt < at)
      .forEach(d => closeRequest(batch, r, d.ref, 'skipped', now));
  }
  await batch.commit();
}

const cleanTrack = t => ({
  id: clean(t.id, 64), uri: clean(t.uri, 100), title: clean(t.title, 200), artist: clean(t.artist, 200),
  album: clean(t.album, 200), art: /^https:\/\/i\.scdn\.co\//.test(t.art) ? clean(t.art, 300) : '',
  durationMs: Number(t.durationMs) || 0, explicit: Boolean(t.explicit),
});

// ---------------------------------------------------------------- operations

export const ops = {
  /** Host a party. The caller becomes its first DJ. */
  async createParty({ partyName, acceptTerms }, { uid, ip }) {
    if (acceptTerms !== true) fail('invalid-argument', 'Please accept the Terms to host a party.');
    const perHour = Number(process.env.CREATE_LIMIT_PER_HOUR) || 10;
    if (limited(`create:${ip}`, perHour, 3600_000) || limited(`create:${uid}`, perHour, 3600_000)
      || limited('create:all', perHour * 20, 3600_000)) { // global cap per instance: bounds abuse cost
      fail('resource-exhausted', 'Too many parties created. Try again later.');
    }
    const now = Date.now();
    const pin = String(crypto.randomInt(100000, 1000000));
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode();
      const r = refs(code);
      const batch = db().batch();
      batch.create(r.party, {
        name: clean(partyName, 40) || 'Tonight',
        settings: DEFAULT_SETTINGS,
        nowPlaying: null,
        spotifyConnected: false,
        guestCount: 0,
        createdAt: now,
        lastActive: now,
      });
      batch.set(r.dj, { pin, djUids: [uid], blocked: [], termsAccepted: { version: TERMS_VERSION, at: now, uid } });
      batch.set(r.secrets, { signKey: randomKey(), oauth: {} });
      try {
        await batch.commit();
        return { code, pin };
      } catch (e) {
        if (e.code !== 6) throw e; // 6 = ALREADY_EXISTS: code taken, try another
      }
    }
    fail('unavailable', 'Could not create a party. Try again.');
  },

  /** A guest opened the party page: counts unique guests (one write per guest, ever). */
  async join({ code }, { uid }) {
    const { r } = await loadParty(code);
    try {
      await r.guests.doc(uid).create({ at: Date.now() });
      await r.party.update({ guestCount: FieldValue.increment(1) });
    } catch (e) {
      if (e.code !== 6) throw e; // already joined
    }
    await touch(r, code);
    return { ok: true };
  },

  /** Spotify search through the DJ's connection. Results are signed so they can't be altered. */
  async search({ code, q }, { uid }) {
    const query = clean(q, 100);
    const { r, party } = await loadParty(code);
    if (!query) return { results: [] };
    if (!party.spotifyConnected) return { results: [], manual: true };
    if (limited(`search:${code}:${uid}`, 40, 60_000)) fail('resource-exhausted', 'Searching too fast. Wait a moment.');
    const key = `${code}:${query.toLowerCase()}`;
    let results = searchCache.get(key)?.exp > Date.now() ? searchCache.get(key).results : null;
    if (!results) {
      try { results = await withSpotify(code, r, c => c.search(query)); } catch (e) { spotifyFail(e); }
      searchCache.set(key, { results, exp: Date.now() + 5 * 60_000 });
      if (searchCache.size > 2000) searchCache.delete(searchCache.keys().next().value);
    }
    const s = await session(r, code);
    if (!party.settings?.allowExplicit) results = results.filter(t => !t.explicit);
    return { results: results.map(t => ({ ...t, sig: signTrack(s.signKey, t) })) };
  },

  /** Request a song: a signed Spotify result, or a typed title in manual mode. */
  async request({ code, track, sig, title, artist, name }, { uid }) {
    const { r, party, dj, isDj } = await loadDj(code, uid);
    const s = party.settings || {};
    if (!isDj && dj.blocked?.includes(uid)) fail('permission-denied', 'The DJ isn’t taking requests from you right now.');
    if (!s.requestsOpen && !isDj) fail('failed-precondition', 'Requests are paused right now.');
    if (limited(`req:${code}:${uid}`, 10, 60_000)) fail('resource-exhausted', 'Too many requests. Wait a moment.');

    let t;
    if (track) {
      // Only accept songs this server returned from search, unaltered (title, link, explicit flag).
      const { signKey } = await session(r, code);
      if (!verifyTrack(signKey, track, sig)) fail('invalid-argument', 'That song isn’t available anymore. Search for it again.');
      t = cleanTrack(track);
    } else {
      const tt = clean(title, 120);
      const aa = clean(artist, 120);
      if (!tt) fail('invalid-argument', 'Song title is required.');
      t = { id: 'manual:' + `${tt}|${aa}`.toLowerCase(), uri: '', title: tt, artist: aa, album: '', art: '', durationMs: 0, explicit: false };
    }
    if (t.explicit && !s.allowExplicit) fail('failed-precondition', 'Explicit songs are turned off tonight.');

    // Already waiting? Count it as a vote instead of a duplicate.
    const dup = await r.requests.where('trackId', '==', t.id).where('status', 'in', ['pending', 'queued']).limit(1).get();
    if (!dup.empty) {
      const d = dup.docs[0];
      const data = d.data();
      if (data.status === 'pending' && s.votingOpen && !data.votes.includes(uid)) {
        await d.ref.update({ votes: FieldValue.arrayUnion(uid) });
        await maybeAutoQueue(code, r, party, d.id, data.votes.length + 1);
      }
      return { merged: true, status: data.status, id: d.id };
    }

    if (!isDj && s.maxPendingPerGuest > 0) {
      const mine = await r.requests.where('byUid', '==', uid).where('status', '==', 'pending').count().get();
      if (mine.data().count >= s.maxPendingPerGuest) {
        fail('resource-exhausted', `You can have ${s.maxPendingPerGuest} open request${s.maxPendingPerGuest === 1 ? '' : 's'} at a time.`);
      }
    }

    const displayName = clean(name, 24);
    const ref = r.requests.doc();
    const batch = db().batch();
    batch.set(ref, {
      trackId: t.id, track: t, status: 'pending', votes: [uid], byUid: uid,
      byName: s.showNames ? displayName : '', createdAt: Date.now(), queuedAt: 0, playedAt: 0,
    });
    batch.set(r.meta.doc(ref.id), { name: displayName, uid });
    await batch.commit();
    await maybeAutoQueue(code, r, party, ref.id, 1);
    await touch(r, code);
    await tidy(code, r).catch(e => logger.warn(`[${code}] tidy failed`, e.message));
    return { id: ref.id };
  },

  async vote({ code, id, on }, { uid }) {
    const { r, party, dj } = await loadDj(code, uid);
    if (dj.blocked?.includes(uid)) fail('permission-denied', 'The DJ isn’t taking votes from you right now.');
    if (!party.settings?.votingOpen) fail('failed-precondition', 'Voting is paused right now.');
    if (limited(`vote:${code}:${uid}`, 60, 60_000)) fail('resource-exhausted', 'Easy there. Wait a moment.');
    const ref = r.requests.doc(String(id || 'x'));
    const doc = await ref.get();
    if (!doc.exists || doc.data().status !== 'pending') fail('not-found', 'That request is no longer open.');
    // arrayUnion/arrayRemove: idempotent and contention-free, even when many people vote at once.
    await ref.update({ votes: on ? FieldValue.arrayUnion(uid) : FieldValue.arrayRemove(uid) });
    const votes = new Set(doc.data().votes);
    if (on) votes.add(uid); else votes.delete(uid);
    if (on) await maybeAutoQueue(code, r, party, ref.id, votes.size);
    return { voted: Boolean(on), votes: votes.size };
  },

  async withdraw({ code, id }, { uid }) {
    const { r, isDj } = await loadDj(code, uid);
    const ref = r.requests.doc(String(id || 'x'));
    const doc = await ref.get();
    if (!doc.exists || (doc.data().byUid !== uid && !isDj)) fail('not-found', 'Not found.');
    if (doc.data().status !== 'pending') fail('failed-precondition', 'Already handled by the DJ.');
    const batch = db().batch();
    batch.delete(ref);
    batch.delete(r.meta.doc(ref.id));
    await batch.commit();
    return { ok: true };
  },

  /**
   * Refresh "now playing" from Spotify. Every open DJ console and guest page nudges this, so it
   * checks the cheap in-memory throttle before touching the database: at most one Spotify check
   * per party every 3 seconds, and it only writes when something actually changed.
   */
  async poll({ code }, { uid }) {
    if (!isPartyCode(code)) fail('invalid-argument', 'That party code isn’t valid.');
    if (limited(`pollu:${uid}`, 30, 60_000) || limited(`poll:${code}`, 1, 3000)) return { ok: true };
    const { r, party } = await loadParty(code);
    if (!party.spotifyConnected) return { ok: true };
    let np;
    try { np = await withSpotify(code, r, c => c.nowPlaying()); } catch (e) { if (e.httpErrorCode) throw e; return { ok: false }; }
    const cur = party.nowPlaying;
    const expected = cur ? (cur.isPlaying ? cur.progressMs + (Date.now() - cur.updatedAt) : cur.progressMs) : 0;
    const changed = !np !== !cur
      || (np && (np.track.id !== cur.track.id || np.isPlaying !== cur.isPlaying || Math.abs(expected - np.progressMs) > 2500));
    if (changed) {
      await r.party.update({ nowPlaying: np ? { ...np, updatedAt: Date.now(), source: 'spotify' } : null });
      if (np) await markPlayed(r, np.track.id);
    }
    await tidy(code, r).catch(e => logger.warn(`[${code}] tidy failed`, e.message));
    return { ok: true };
  },

  // ---------------- DJ

  /** A DJ makes a one-time link (shown as a QR code) to sign in another device without the PIN. */
  async djInvite({ code }, { uid }) {
    const { r } = await requireDj(code, uid);
    if (limited(`invite:${uid}`, 10, 3600_000)) fail('resource-exhausted', 'Too many DJ links. Wait a while.');
    const token = randomKey();
    const now = Date.now();
    const sec = (await r.secrets.get()).data() || {};
    const expired = Object.entries(sec.invites || {}).filter(([, v]) => v.exp < now).map(([k]) => `invites.${k}`);
    await r.secrets.update({
      [`invites.${sha256(token)}`]: { exp: now + INVITE_TTL_MS },
      ...Object.fromEntries(expired.map(k => [k, FieldValue.delete()])),
    });
    return { token, expiresInMs: INVITE_TTL_MS };
  },

  async djLogin({ code, pin, invite }, { uid, ip }) {
    // Wrong guesses are counted per IP, per browser identity (8/min, 40/h) and per party (100/h).
    // The party cap is high so a guest can't lock the DJ out, but a 6-digit PIN still takes
    // thousands of hours to guess. Signed-in DJ devices are never affected.
    const keys = [`pin:${ip}`, `pin:${uid}`];
    for (const k of keys) {
      if (limited(k, 8, 60_000, false) || limited(`${k}:h`, 40, 3600_000, false)) fail('resource-exhausted', 'Too many attempts. Wait a few minutes.');
    }
    if (limited(`pin:party:${code}`, 100, 3600_000, false)) fail('resource-exhausted', 'Too many attempts. Wait a few minutes.');
    const { r, dj } = await loadDj(code, uid);
    const wrong = message => {
      for (const k of keys) { limited(k, 8, 60_000); limited(`${k}:h`, 40, 3600_000); }
      limited(`pin:party:${code}`, 100, 3600_000);
      fail('permission-denied', message);
    };
    if (invite) {
      // One-time DJ link: valid for a few minutes and used up on the first sign-in.
      const key = sha256(String(invite));
      const ok = await db().runTransaction(async tx => {
        const found = (await tx.get(r.secrets)).data()?.invites?.[key];
        if (!found) return false;
        tx.update(r.secrets, { [`invites.${key}`]: FieldValue.delete() });
        return found.exp > Date.now();
      });
      if (!ok) wrong('This DJ link has expired or was already used. Ask for a new one.');
    } else if (!timingSafeEqualStr(String(pin ?? '').trim(), dj.pin)) {
      wrong('Wrong PIN.');
    }
    const djUids = [...(dj.djUids || []).filter(u => u !== uid), uid].slice(-20);
    await r.dj.update({ djUids });
    return { ok: true };
  },

  async djLogout({ code }, { uid }) {
    const { r } = await loadParty(code);
    await r.dj.update({ djUids: FieldValue.arrayRemove(uid) });
    return { ok: true };
  },

  async settings({ code, patch = {} }, { uid }) {
    const { r } = await requireDj(code, uid);
    const u = {};
    if ('partyName' in patch) u.name = clean(patch.partyName, 40) || 'Tonight';
    for (const k of ['requestsOpen', 'votingOpen', 'allowExplicit', 'showNames']) if (k in patch) u[`settings.${k}`] = Boolean(patch[k]);
    if ('maxPendingPerGuest' in patch) u['settings.maxPendingPerGuest'] = Math.max(0, Math.min(20, Math.round(Number(patch.maxPendingPerGuest) || 0)));
    if ('autoQueueAt' in patch) u['settings.autoQueueAt'] = Math.max(0, Math.min(100, Math.round(Number(patch.autoQueueAt) || 0)));
    if (!Object.keys(u).length) return { ok: true };
    u.lastActive = Date.now();
    await r.party.update(u);
    if ('showNames' in patch) {
      // Names live in requestMeta (DJ only); copy them to the public docs only when allowed.
      const [reqs, metas] = await Promise.all([r.requests.where('status', 'in', ['pending', 'queued', 'played']).get(), r.meta.get()]);
      const names = new Map(metas.docs.map(d => [d.id, d.data().name || '']));
      const batch = db().batch();
      reqs.forEach(d => batch.update(d.ref, { byName: patch.showNames ? names.get(d.id) || '' : '' }));
      await batch.commit();
    }
    return { ok: true };
  },

  async action({ code, id, action }, { uid }) {
    const { r, party } = await requireDj(code, uid);
    const ref = r.requests.doc(String(id || 'x'));
    const doc = await ref.get();
    if (!doc.exists) fail('not-found', 'Request not found.');
    const data = doc.data();
    const now = Date.now();
    switch (action) {
      case 'queue':
        await queueRequest(code, r, party, ref.id, data);
        break;
      case 'dismiss': {
        const batch = db().batch();
        closeRequest(batch, r, ref, 'dismissed', now);
        await batch.commit();
        break;
      }
      case 'restore': {
        const batch = db().batch();
        batch.update(ref, { status: 'pending', closedAt: FieldValue.delete(), expireAt: FieldValue.delete() });
        batch.set(r.meta.doc(ref.id), { expireAt: FieldValue.delete() }, { merge: true });
        await batch.commit();
        break;
      }
      case 'playing':
        await r.party.update({ nowPlaying: { track: data.track, progressMs: 0, isPlaying: true, updatedAt: now, source: 'manual' } });
        await markPlayed(r, data.trackId);
        break;
      case 'block': {
        // Remove the requester's open requests and votes, refuse new ones.
        const g = data.byUid;
        await r.dj.update({ blocked: FieldValue.arrayUnion(g) });
        const pending = await r.requests.where('status', '==', 'pending').get();
        const batch = db().batch();
        pending.forEach(d => {
          const x = d.data();
          if (x.byUid === g) closeRequest(batch, r, d.ref, 'dismissed', now);
          else if (x.votes.includes(g)) batch.update(d.ref, { votes: FieldValue.arrayRemove(g) });
        });
        await batch.commit();
        break;
      }
      default: fail('invalid-argument', 'Unknown action.');
    }
    await touch(r, code);
    await tidy(code, r).catch(e => logger.warn(`[${code}] tidy failed`, e.message));
    return { ok: true };
  },

  async unblockAll({ code }, { uid }) {
    const { r } = await requireDj(code, uid);
    await r.dj.update({ blocked: [] });
    return { ok: true };
  },

  async nowPlaying({ code, title, artist }, { uid }) {
    const { r } = await requireDj(code, uid);
    const t = clean(title, 120);
    await r.party.update({
      nowPlaying: t
        ? { track: { id: 'manual:' + t.toLowerCase(), uri: '', title: t, artist: clean(artist, 120), album: '', art: '', durationMs: 0, explicit: false },
            progressMs: 0, isPlaying: true, updatedAt: Date.now(), source: 'manual' }
        : null,
    });
    return { ok: true };
  },

  async clear({ code, scope }, { uid }) {
    const { r } = await requireDj(code, uid);
    const q = scope === 'all' ? r.requests : r.requests.where('status', 'in', ['played', 'dismissed']);
    const snap = await q.get();
    const writer = db().bulkWriter();
    snap.forEach(d => { writer.delete(d.ref); writer.delete(r.meta.doc(d.id)); });
    await writer.close();
    return { ok: true };
  },

  async end({ code }, { uid }) {
    const { r } = await requireDj(code, uid);
    sessions.delete(code);
    await db().recursiveDelete(r.party);
    return { ok: true };
  },

  // ---------------- Spotify connect (Authorization Code + PKCE, no client secret)

  async spotifyStart({ code, clientId, local }, { uid }) {
    const { r } = await requireDj(code, uid);
    const id = clean(clientId, 64);
    if (!isClientId(id)) fail('invalid-argument', 'That doesn’t look like a Spotify Client ID (32 letters and numbers).');
    const nonce = crypto.randomBytes(16).toString('hex');
    // state = party.nonce.origin; "l" sends the browser back to http://localhost:3000 after login.
    const state = `${code}.${nonce}.${local ? 'l' : 'p'}`;
    const { url, verifier } = authorizeUrl({ clientId: id, redirectUri: redirectUri(), state });
    const sec = (await r.secrets.get()).data() || {};
    const now = Date.now();
    const oauth = Object.fromEntries(Object.entries(sec.oauth || {}).filter(([, v]) => v.exp > now));
    oauth[nonce] = { clientId: id, verifier, uid, exp: now + 10 * 60_000 };
    await r.secrets.set({ oauth }, { mergeFields: ['oauth'] }); // replaces the map, dropping expired logins
    return { url };
  },

  async spotifyComplete({ code, state, authCode, error }, { uid }) {
    const { r } = await requireDj(code, uid);
    const [stateCode, nonce] = String(state || '').split('.');
    if (stateCode !== code || !nonce) fail('invalid-argument', 'Spotify login expired. Try again.');
    const sec = (await r.secrets.get()).data() || {};
    const pending = sec.oauth?.[nonce];
    await r.secrets.update({ [`oauth.${nonce}`]: FieldValue.delete() }); // single use
    if (!pending || pending.exp < Date.now()) fail('deadline-exceeded', 'Spotify login expired. Try again.');
    // The browser finishing the login must be the DJ who started it. Otherwise someone could send a
    // DJ a login link started from *their* party and capture that DJ's Spotify.
    if (pending.uid !== uid) fail('permission-denied', 'Finish connecting Spotify in the browser where you started.');
    if (error) fail('cancelled', 'Spotify access was declined.');
    let auth;
    try {
      auth = await exchangeCode({ clientId: pending.clientId, code: authCode, verifier: pending.verifier, redirectUri: redirectUri() });
    } catch (e) {
      logger.warn(`[${code}] Spotify code exchange failed: ${e.message}`);
      fail('failed-precondition', 'Spotify login failed. Check the Client ID and that the Redirect URI matches exactly.');
    }
    sessions.delete(code);
    await r.secrets.set({ spotify: { clientId: pending.clientId, auth } }, { merge: true });
    let user = null;
    try { user = await withSpotify(code, r, c => c.me()); } catch (e) { logger.warn('Spotify /me failed', e.message); }
    await r.dj.set({ spotify: { clientId: pending.clientId, user } }, { merge: true });
    await r.party.update({ spotifyConnected: true, lastActive: Date.now() });
    return { ok: true };
  },

  async spotifyDisconnect({ code }, { uid }) {
    const { r } = await requireDj(code, uid);
    await disconnect(code, r);
    return { ok: true };
  },
};

/** Daily: delete parties idle for 48 hours (data minimisation, and keeps storage free). */
export async function cleanupIdleParties() {
  const cutoff = Date.now() - IDLE_MS;
  const idle = await db().collection('parties').where('lastActive', '<', cutoff).limit(200).get();
  for (const doc of idle.docs) await db().recursiveDelete(doc.ref);
  logger.info(`Cleanup: removed ${idle.size} idle parties`);
}
