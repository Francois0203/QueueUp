// Unit tests for the Spotify client: token refresh behaviour.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeSpotify } from './fake-spotify.mjs';

let fake, sp;
before(async () => {
  fake = await startFakeSpotify();
  process.env.SPOTIFY_ACCOUNTS_URL = fake.accountsUrl;
  process.env.SPOTIFY_API_URL = fake.apiUrl;
  sp = await import('../spotify.js'); // reads the env at import time
});
after(() => fake.close());

/** A connection whose access token has expired, holding a fresh refresh token. */
async function expiredConn() {
  const auth = await sp.exchangeCode({ clientId: 'a'.repeat(32), code: 'c', verifier: 'v', redirectUri: 'http://127.0.0.1/cb' });
  fake.expireAllTokens();
  let conn = { clientId: 'a'.repeat(32), auth: { ...auth, expiresAt: 0 }, user: null };
  return { get: () => conn, set: c => { conn = c; } };
}

test('concurrent calls share one token refresh (refresh tokens rotate)', async () => {
  const c = await expiredConn();
  const client = sp.clientFor(c.get, c.set);
  fake.state.refreshCalls = 0;
  const results = await Promise.allSettled([1, 2, 3, 4, 5].map(() => client.search('dreams')));
  assert.equal(fake.state.refreshCalls, 1, 'exactly one refresh');
  assert.ok(results.every(r => r.status === 'fulfilled'), 'no call failed');
  assert.ok(c.get().auth.expiresAt > Date.now(), 'new token stored');
});

test('a Spotify outage during refresh is NOT treated as revoked', async () => {
  const c = await expiredConn();
  const client = sp.clientFor(c.get, c.set);
  fake.state.failRefreshWith = 503;
  try {
    await assert.rejects(client.search('x'), err => err.revoked === false);
  } finally { fake.state.failRefreshWith = 0; }
  assert.ok(c.get().auth, 'connection kept');
});

test('a reused (rotated) refresh token IS treated as revoked', async () => {
  const c = await expiredConn();
  fake.state.usedRefresh.add(c.get().auth.refreshToken);
  const client = sp.clientFor(c.get, c.set);
  await assert.rejects(client.search('x'), err => err.revoked === true);
});

test('a 401 before expiry triggers one refresh + retry, not a disconnect', async () => {
  const c = await expiredConn();
  const client = sp.clientFor(c.get, c.set);
  await client.search('warm up');      // refreshes once, token now valid
  fake.expireAllTokens();               // Spotify invalidates it early
  const results = await client.search('again');
  assert.equal(results.length, 2);
});

test('a refresh finishing after a disconnect does not reconnect', async () => {
  const c = await expiredConn();
  const client = sp.clientFor(c.get, c.set);
  const pending = client.search('x');
  c.set(null); // DJ disconnects while the refresh is in flight
  await assert.rejects(pending);
  assert.equal(c.get(), null);
});
