// End-to-end tests against the Firebase emulators (Auth, Firestore, Functions) and a fake Spotify.
// Run with: npm test   (firebase emulators:exec starts everything, then runs this file)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startFakeSpotify } from './fake-spotify.mjs';

const PROJECT = 'demo-queueup-test';
const FN = `http://127.0.0.1:5001/${PROJECT}/europe-west1/api`;
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake';

// Admin access to inspect data (bypasses rules; emulators:exec sets FIRESTORE_EMULATOR_HOST).
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
initializeApp({ projectId: PROJECT });
const admin = getFirestore();

let fake;
before(async () => { fake = await startFakeSpotify({ port: 8799 }); });
after(async () => { await fake?.close(); });

/** A browser: an anonymous Firebase user that calls the API like the app does. */
async function browser() {
  const r = await fetch(AUTH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
  const { idToken, localId } = await r.json();
  const call = async (op, data = {}) => {
    const res = await fetch(FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ data: { op, ...data } }),
    });
    const j = await res.json();
    return j.error ? { error: j.error.status, message: j.error.message } : { data: j.result };
  };
  /** Firestore REST read as this user: the security rules apply. */
  call.read = async path => (await fetch(`${FS}/${path}`, { headers: { Authorization: `Bearer ${idToken}` } })).status;
  call.write = async path => (await fetch(`${FS}/${path}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { hacked: { booleanValue: true } } }),
  })).status;
  call.uid = localId;
  return call;
}

async function newParty(name = 'Test party') {
  const dj = await browser();
  const r = await dj('createParty', { partyName: name, acceptTerms: true });
  assert.ok(r.data, JSON.stringify(r));
  return { dj, code: r.data.code, pin: r.data.pin };
}

const requestsOf = async code => (await admin.collection(`parties/${code}/requests`).get()).docs.map(d => ({ id: d.id, ...d.data() }));

async function connectSpotify({ dj, code }) {
  const start = await dj('spotifyStart', { code, clientId: 'b'.repeat(32) });
  const state = new URL(start.data.url).searchParams.get('state');
  const done = await dj('spotifyComplete', { code, state, authCode: 'authcode' });
  assert.deepEqual(done, { data: { ok: true } });
}

// ------------------------------------------------------------------ hosting, terms, access rules

test('hosts must accept the Terms; acceptance is recorded', async () => {
  const b = await browser();
  assert.equal((await b('createParty', { partyName: 'x' })).error, 'INVALID_ARGUMENT');
  assert.equal((await b('createParty', { partyName: 'x', acceptTerms: 'yes' })).error, 'INVALID_ARGUMENT');
  const ok = await b('createParty', { partyName: 'x', acceptTerms: true });
  assert.match(ok.data.code, /^[A-Z2-9]{5}$/);
  assert.match(ok.data.pin, /^\d{6}$/);
  const dj = (await admin.doc(`parties/${ok.data.code}/private/dj`).get()).data();
  assert.equal(dj.termsAccepted.uid, b.uid);
  assert.ok(dj.termsAccepted.version);
});

test('Firestore rules: read-only, DJ data for DJs, secrets for nobody', async () => {
  const { dj, code } = await newParty();
  const guest = await browser();
  assert.equal(await guest.read(`parties/${code}`), 200, 'party is readable');
  assert.equal(await guest.read(`parties/${code}/requests`), 200, 'requests are readable');
  assert.equal(await guest.read(`parties/${code}/private/dj`), 403, 'guest cannot read DJ data');
  assert.equal(await dj.read(`parties/${code}/private/dj`), 200, 'DJ can read DJ data');
  assert.equal(await guest.read(`parties/${code}/requestMeta`), 403, 'guest cannot read requester names');
  assert.equal(await dj.read(`parties/${code}/requestMeta`), 200);
  for (const who of [guest, dj]) {
    assert.equal(await who.read(`parties/${code}/private/secrets`), 403, 'nobody reads Spotify tokens');
    assert.equal(await who.read(`parties/${code}/guests`), 403);
    assert.equal(await who.write(`parties/${code}`), 403, 'no direct writes');
    assert.equal(await who.write(`parties/${code}/requests/x`), 403);
  }
  assert.equal(await guest.read('parties'), 403, 'cannot list all parties');
});

test('parties are isolated, and only their DJ controls them', async () => {
  const a = await newParty('A'), b = await newParty('B');
  assert.notEqual(a.code, b.code);
  const guest = await browser();
  assert.ok((await guest('request', { code: a.code, title: 'Only in A' })).data);
  assert.equal((await requestsOf(b.code)).length, 0);
  assert.equal((await guest('settings', { code: a.code, patch: { partyName: 'x' } })).error, 'PERMISSION_DENIED');
  assert.equal((await a.dj('settings', { code: b.code, patch: { partyName: 'x' } })).error, 'PERMISSION_DENIED');
  assert.equal((await guest('end', { code: a.code })).error, 'PERMISSION_DENIED');
  assert.equal((await guest('request', { code: 'ZZZZZ', title: 'x' })).error, 'NOT_FOUND');
});

test('votes, duplicate merging and per-guest limits', async () => {
  const { code } = await newParty();
  const g1 = await browser(), g2 = await browser();
  const { id } = (await g1('request', { code, title: 'Dreams', artist: 'Fleetwood Mac' })).data;
  const merged = await g2('request', { code, title: 'dreams', artist: 'fleetwood mac' });
  assert.equal(merged.data.merged, true);
  let reqs = await requestsOf(code);
  assert.equal(reqs.length, 1);
  assert.deepEqual(new Set(reqs[0].votes), new Set([g1.uid, g2.uid]));
  assert.equal((await g2('vote', { code, id, on: false })).data.votes, 1);
  assert.equal((await g2('vote', { code, id, on: true })).data.votes, 2);
  assert.equal((await g2('vote', { code, id, on: true })).data.votes, 2, 'voting twice counts once');
  for (const t of ['b', 'c']) assert.ok((await g1('request', { code, title: t })).data);
  assert.equal((await g1('request', { code, title: 'd' })).error, 'RESOURCE_EXHAUSTED');
});

test('guests can withdraw only their own requests', async () => {
  const { code } = await newParty();
  const a = await browser(), b = await browser();
  const { id } = (await a('request', { code, title: 'Mine' })).data;
  assert.equal((await b('withdraw', { code, id })).error, 'NOT_FOUND');
  assert.deepEqual((await a('withdraw', { code, id })).data, { ok: true });
  assert.equal((await requestsOf(code)).length, 0);
});

test('invisible and text-direction characters are stripped', async () => {
  const { code } = await newParty();
  await (await browser())('request', { code, title: 'Good‮dab Song​', name: 'A\u0000l⁦ex' });
  const [req] = await requestsOf(code);
  assert.equal(req.track.title, 'Gooddab Song');
  assert.equal(req.byName, 'Alex');
});

test('hiding guest names removes them from the public data, DJ still sees them', async () => {
  const { dj, code } = await newParty();
  const { id } = (await (await browser())('request', { code, title: 'Song', name: 'Ana' })).data;
  await dj('settings', { code, patch: { showNames: false } });
  assert.equal((await admin.doc(`parties/${code}/requests/${id}`).get()).data().byName, '');
  assert.equal((await admin.doc(`parties/${code}/requestMeta/${id}`).get()).data().name, 'Ana');
  await dj('settings', { code, patch: { showNames: true } });
  assert.equal((await admin.doc(`parties/${code}/requests/${id}`).get()).data().byName, 'Ana');
});

test('DJ can block a disruptive guest', async () => {
  const { dj, code } = await newParty();
  const troll = await browser(), fan = await browser();
  const { id } = (await troll('request', { code, title: 'Rude title' })).data;
  const fanId = (await fan('request', { code, title: 'Nice song' })).data.id;
  await troll('vote', { code, id: fanId, on: true });
  assert.deepEqual((await dj('action', { code, id, action: 'block' })).data, { ok: true });
  const reqs = await requestsOf(code);
  assert.equal(reqs.find(r => r.id === id).status, 'dismissed');
  assert.deepEqual(reqs.find(r => r.id === fanId).votes, [fan.uid], 'their votes are removed');
  assert.equal((await troll('request', { code, title: 'again' })).error, 'PERMISSION_DENIED');
  assert.equal((await troll('vote', { code, id: fanId, on: true })).error, 'PERMISSION_DENIED');
  await dj('unblockAll', { code });
  assert.ok((await troll('request', { code, title: 'sorry' })).data);
});

test('second device signs in as DJ with the PIN; wrong PIN refused', async () => {
  const { code, pin } = await newParty();
  const phone = await browser();
  assert.equal((await phone('djLogin', { code, pin: '000000' })).error, 'PERMISSION_DENIED');
  assert.deepEqual((await phone('djLogin', { code, pin })).data, { ok: true });
  assert.equal(await phone.read(`parties/${code}/private/dj`), 200);
  assert.deepEqual((await phone('settings', { code, patch: { requestsOpen: false } })).data, { ok: true });
  assert.equal((await (await browser())('request', { code, title: 'x' })).error, 'FAILED_PRECONDITION', 'requests paused');
  await phone('djLogout', { code });
  assert.equal(await phone.read(`parties/${code}/private/dj`), 403);
});

test('a one-time DJ link signs in one device, once; only DJs can make one', async () => {
  const { dj, code } = await newParty();
  const guest = await browser();
  assert.equal((await guest('djInvite', { code })).error, 'PERMISSION_DENIED', 'guests cannot make DJ links');

  const { token } = (await dj('djInvite', { code })).data;
  const secrets = JSON.stringify((await admin.doc(`parties/${code}/private/secrets`).get()).data());
  assert.ok(!secrets.includes(token), 'only a hash of the link is stored');

  const phone = await browser();
  assert.deepEqual((await phone('djLogin', { code, invite: token })).data, { ok: true });
  assert.equal(await phone.read(`parties/${code}/private/dj`), 200, 'the phone is now a DJ');
  assert.equal((await (await browser())('djLogin', { code, invite: token })).error, 'PERMISSION_DENIED', 'used up');

  // Expired links are refused.
  const late = (await dj('djInvite', { code })).data.token;
  const ref = admin.doc(`parties/${code}/private/secrets`);
  const invites = (await ref.get()).data().invites;
  await ref.update(Object.fromEntries(Object.keys(invites).map(k => [`invites.${k}`, { exp: Date.now() - 1 }])));
  assert.equal((await (await browser())('djLogin', { code, invite: late })).error, 'PERMISSION_DENIED', 'expired');

  // A link for one party doesn't work on another.
  const other = await newParty();
  const t2 = (await dj('djInvite', { code })).data.token;
  assert.equal((await (await browser())('djLogin', { code: other.code, invite: t2 })).error, 'PERMISSION_DENIED');
});

// ------------------------------------------------------------------ Spotify

test('a guest cannot fake song details or dodge the explicit filter', async () => {
  const party = await newParty();
  await connectSpotify(party);
  const { dj, code } = party;
  const guest = await browser();
  const { results } = (await guest('search', { code, q: 'dreams' })).data;
  const dreams = results.find(t => t.title === 'Dreams');
  assert.ok(dreams.sig, 'results are signed');

  // Forged / altered tracks are refused.
  const { sig, ...track } = dreams;
  assert.equal((await guest('request', { code, track: { ...track, title: 'Happy Birthday' }, sig })).error, 'INVALID_ARGUMENT');
  assert.equal((await guest('request', { code, track: { ...track, uri: 'spotify:track:SOMETHING_ELSE' }, sig })).error, 'INVALID_ARGUMENT');
  assert.equal((await guest('request', { code, track, sig: 'forged' })).error, 'INVALID_ARGUMENT');

  // The genuine one works, and queueing sends the real URI to Spotify.
  const { id } = (await guest('request', { code, track, sig })).data;
  assert.deepEqual((await dj('action', { code, id, action: 'queue' })).data, { ok: true });
  assert.equal(fake.state.queued.at(-1), dreams.uri);

  // Explicit filter: hidden from search, and a previously signed explicit song is refused.
  const rude = (await guest('search', { code, q: 'rude' })).data.results.find(t => t.explicit);
  await dj('settings', { code, patch: { allowExplicit: false } });
  const filtered = (await guest('search', { code, q: 'rude 2' })).data.results;
  assert.ok(!filtered.some(t => t.explicit), 'explicit hidden from search');
  const { sig: rsig, ...rtrack } = rude;
  assert.equal((await (await browser())('request', { code, track: rtrack, sig: rsig })).error, 'FAILED_PRECONDITION');
});

test('Spotify login only completes in the DJ browser that started it; state is single-use', async () => {
  const { dj, code, pin } = await newParty();
  const start = await dj('spotifyStart', { code, clientId: 'c'.repeat(32) });
  const u = new URL(start.data.url);
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(!u.searchParams.has('client_secret'));
  assert.equal(u.searchParams.get('redirect_uri'), 'https://demo-queueup-test.web.app/auth/spotify/callback');
  const state = u.searchParams.get('state');

  const otherDj = await browser();
  await otherDj('djLogin', { code, pin });
  assert.equal((await otherDj('spotifyComplete', { code, state, authCode: 'x' })).error, 'PERMISSION_DENIED', 'different browser refused');
  assert.equal((await dj('spotifyComplete', { code, state, authCode: 'x' })).error, 'DEADLINE_EXCEEDED', 'state already used');
  assert.equal((await admin.doc(`parties/${code}`).get()).data().spotifyConnected, false);
});

test('Spotify stays connected through expired tokens and parallel calls', async () => {
  const party = await newParty();
  await connectSpotify(party);
  fake.expireAllTokens();
  fake.state.refreshCalls = 0;
  const guests = await Promise.all([1, 2, 3, 4, 5].map(() => browser()));
  const res = await Promise.all(guests.map((g, i) => g('search', { code: party.code, q: `fresh query ${i}` })));
  assert.ok(res.every(r => r.data), JSON.stringify(res.find(r => r.error)));
  assert.equal(fake.state.refreshCalls, 1, 'one shared refresh');
  assert.equal((await admin.doc(`parties/${party.code}`).get()).data().spotifyConnected, true);
});

test('searches are cached and Spotify rate limits are respected', async () => {
  const party = await newParty();
  await connectSpotify(party);
  const before = fake.state.searchCalls;
  for (let i = 0; i < 4; i++) assert.ok((await (await browser())('search', { code: party.code, q: 'Same Song' })).data);
  assert.equal(fake.state.searchCalls - before, 1, 'one Spotify call for repeated searches');
  fake.state.rateLimitSearch = 3;
  try {
    assert.equal((await party.dj('search', { code: party.code, q: 'new one' })).error, 'RESOURCE_EXHAUSTED');
    const calls = fake.state.searchCalls;
    assert.equal((await party.dj('search', { code: party.code, q: 'another' })).error, 'RESOURCE_EXHAUSTED');
    assert.equal(fake.state.searchCalls, calls, 'backs off without calling Spotify again');
    assert.equal((await admin.doc(`parties/${party.code}`).get()).data().spotifyConnected, true, 'not disconnected');
  } finally { fake.state.rateLimitSearch = 0; }
});

test('now playing syncs from Spotify and marks the request as played', async () => {
  const party = await newParty();
  await connectSpotify(party);
  const g = await browser();
  const t = (await g('search', { code: party.code, q: 'np test' })).data.results[0];
  const { sig, ...track } = t;
  const { id } = (await g('request', { code: party.code, track, sig })).data;
  fake.state.nowPlaying = fake.tracks.find(x => x.id === t.id);
  await new Promise(r => setTimeout(r, 4100)); // server throttles polls per party
  await party.dj('poll', { code: party.code });
  const p = (await admin.doc(`parties/${party.code}`).get()).data();
  assert.equal(p.nowPlaying?.track.id, t.id);
  assert.equal((await admin.doc(`parties/${party.code}/requests/${id}`).get()).data().status, 'played');
  fake.state.nowPlaying = null;
});

// ------------------------------------------------------------------ lifecycle

test('ending a party deletes all its data; other parties live on', async () => {
  const a = await newParty(), b = await newParty();
  await (await browser())('request', { code: a.code, title: 'x' });
  assert.deepEqual((await a.dj('end', { code: a.code })).data, { ok: true });
  assert.equal((await admin.doc(`parties/${a.code}`).get()).exists, false);
  assert.equal((await requestsOf(a.code)).length, 0);
  assert.equal((await admin.doc(`parties/${a.code}/private/secrets`).get()).exists, false);
  assert.equal((await admin.doc(`parties/${b.code}`).get()).exists, true);
});

test('guest count counts people once', async () => {
  const { code } = await newParty();
  const g = await browser();
  await g('join', { code }); await g('join', { code });
  await (await browser())('join', { code });
  assert.equal((await admin.doc(`parties/${code}`).get()).data().guestCount, 2);
});

// Runs last: it trips the PIN limiter for this test machine's IP.
test('PIN guessing is rate-limited', async () => {
  const { code } = await newParty();
  const attacker = await browser();
  // Earlier tests may already have used a guess from this IP, so allow the limit to trip early.
  const results = [];
  for (let i = 0; i < 9; i++) results.push((await attacker('djLogin', { code, pin: '000000' })).error);
  assert.ok(results.every(e => e === 'PERMISSION_DENIED' || e === 'RESOURCE_EXHAUSTED'), results.join());
  assert.ok(results.filter(e => e === 'PERMISSION_DENIED').length <= 8, 'at most 8 guesses a minute');
  assert.equal(results.at(-1), 'RESOURCE_EXHAUSTED');
  const fresh = await browser(); // new identity, same IP: still limited
  assert.equal((await fresh('djLogin', { code, pin: '000000' })).error, 'RESOURCE_EXHAUSTED');
});
