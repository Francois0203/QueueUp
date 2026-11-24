// End-to-end tests: starts a real QueueUp server against a fake Spotify.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeSpotify } from './fake-spotify.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 40000 + Math.floor(Math.random() * 20000);
const B = `http://127.0.0.1:${PORT}`;
let fake, proc, dataDir, ipSeq = 0;

before(async () => {
  fake = await startFakeSpotify();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queueup-test-'));
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), DATA_DIR: dataDir, TRUST_PROXY: '1', PUBLIC_URL: '',
      SPOTIFY_ACCOUNTS_URL: fake.accountsUrl, SPOTIFY_API_URL: fake.apiUrl,
      OPERATOR_NAME: 'Test Operator <b>Ltd</b>', OPERATOR_CONTACT: 'legal@example.test', GOVERNING_LAW: 'Testland',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start:\n' + log)), 8000);
    const onData = d => { log += d; if (log.includes('QueueUp is live')) { clearTimeout(t); resolve(); } };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
  });
});

after(async () => {
  proc?.kill();
  await fake?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** A browser: keeps its own cookies and its own (proxy-reported) IP. */
function browser(ip = `10.0.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`) {
  const jar = new Map();
  const call = async (p, { method = 'GET', body, headers = {}, raw = false } = {}) => {
    const res = await fetch(B + p, {
      method, redirect: 'manual',
      headers: {
        'X-Forwarded-For': `6.6.6.${Math.floor(Math.random() * 250)}, ${ip}`, // first entry is forgeable
        Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';'); const i = kv.indexOf('=');
      jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
    if (raw) return res;
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, data, headers: res.headers };
  };
  call.ip = ip;
  return call;
}

async function newParty(name = 'Test party') {
  const dj = browser();
  const r = await dj('/api/rooms', { method: 'POST', body: { partyName: name, acceptTerms: true } });
  assert.equal(r.status, 201);
  return { dj, code: r.data.code, pin: r.data.pin, base: `/api/r/${r.data.code}` };
}

/** Runs the real PKCE login against the fake Spotify. */
async function connectSpotify({ dj, base, code }) {
  const start = await dj(`${base}/dj/spotify/start`, { method: 'POST', body: { clientId: 'b'.repeat(32) } });
  const state = new URL(start.data.url).searchParams.get('state');
  const cb = await dj(`/auth/spotify/callback?state=${state}&code=authcode`, { raw: true });
  assert.equal(cb.headers.get('location'), `/dj/${code}?spotify=connected`);
}

// ------------------------------------------------------------------ basics

test('pages and assets are served; source and traversal are not', async () => {
  const b = browser();
  for (const p of ['/', '/p/ABCDE', '/dj/ABCDE', '/styles.css', '/home.js', '/guest.js', '/dj.js', '/shared.js', '/favicon.svg', '/healthz',
    '/terms', '/privacy', '/fonts/inter-latin-wght-normal.woff2', '/fonts/OFL.txt']) {
    assert.equal((await b(p, { raw: true })).status, 200, p);
  }
  assert.equal((await b('/p/abcde', { raw: true })).status, 302);
  assert.equal((await b('/server.js', { raw: true })).status, 404);
  assert.equal((await b('/..%2fserver.js', { raw: true })).status, 404);
});

test('parties are isolated, and only their DJ controls them', async () => {
  const a = await newParty('A'), b = await newParty('B');
  assert.notEqual(a.code, b.code);
  assert.equal((await a.dj(`${a.base}/dj/me`)).data.dj, true);
  assert.equal((await a.dj(`${b.base}/dj/me`)).data.dj, false);

  const guest = browser();
  assert.equal((await guest(`${a.base}/requests`, { method: 'POST', body: { title: 'Only in A' } })).status, 201);
  assert.equal((await guest(`${b.base}/state`)).data.requests.length, 0);

  const gs = (await guest(`${a.base}/state`)).data;
  assert.equal(gs.pin, undefined, 'guests never see the PIN');
  assert.equal(gs.spotify.redirectUri, undefined);
  assert.equal((await guest(`${a.base}/dj/settings`, { method: 'PATCH', body: { partyName: 'x' } })).status, 401);
  assert.equal((await guest(`${a.base}/dj/end`, { method: 'POST' })).status, 401);
});

test('votes, duplicate merging and per-guest limits', async () => {
  const { base } = await newParty();
  const g1 = browser(), g2 = browser();
  const id = (await g1(`${base}/requests`, { method: 'POST', body: { title: 'Dreams', artist: 'Fleetwood Mac' } })).data.id;
  assert.equal((await g2(`${base}/requests`, { method: 'POST', body: { title: 'dreams', artist: 'fleetwood mac' } })).data.merged, true);
  assert.equal((await g2(`${base}/state`)).data.requests[0].votes, 2);
  assert.equal((await g2(`${base}/requests/${id}/vote`, { method: 'POST' })).data.votes, 1);
  for (const t of ['b', 'c']) await g1(`${base}/requests`, { method: 'POST', body: { title: t } });
  assert.equal((await g1(`${base}/requests`, { method: 'POST', body: { title: 'd' } })).status, 429);
});

test('ending a party removes it for everyone, other parties live on', async () => {
  const a = await newParty(), b = await newParty();
  assert.equal((await a.dj(`${a.base}/dj/end`, { method: 'POST' })).status, 200);
  assert.equal((await browser()(`${a.base}/state`)).status, 404);
  assert.equal((await browser()(`${b.base}/state`)).status, 200);
});

// ------------------------------------------------------------------ review fixes

test('#1 a guest cannot fake song details or dodge the explicit filter', async () => {
  const party = await newParty();
  await connectSpotify(party);
  const { dj, base } = party;
  const guest = browser();

  // Unknown / forged song ids are rejected outright.
  const forged = await guest(`${base}/requests`, { method: 'POST', body: {
    track: { id: 'forged', uri: 'spotify:track:SOMETHING_ELSE', title: 'Happy Birthday', explicit: false } } });
  assert.equal(forged.status, 400);

  // After a real search, the server uses its own copy, whatever the browser claims.
  const { results } = (await guest(`${base}/search?q=dreams`)).data;
  const dreams = results.find(t => t.title === 'Dreams');
  const r = await guest(`${base}/requests`, { method: 'POST', body: {
    track: { ...dreams, title: 'Happy Birthday', uri: 'spotify:track:SOMETHING_ELSE' } } });
  assert.equal(r.status, 201);
  const req = (await dj(`${base}/state`)).data.requests.find(x => x.id === r.data.id);
  assert.equal(req.track.title, 'Dreams');
  assert.equal(req.track.uri, dreams.uri);

  // Queueing sends the real URI to Spotify.
  assert.equal((await dj(`${base}/dj/requests/${req.id}/queue`, { method: 'POST' })).status, 200);
  assert.equal(fake.state.queued.at(-1), dreams.uri);

  // Explicit filter: hidden from search, and a remembered explicit id is refused.
  const explicit = fake.tracks.find(t => t.explicit);
  await dj(`${base}/dj/settings`, { method: 'PATCH', body: { allowExplicit: false } });
  const filtered = (await guest(`${base}/search?q=rude`)).data.results;
  assert.ok(!filtered.some(t => t.id === explicit.id), 'explicit hidden from search');
  const sneaky = await browser()(`${base}/requests`, { method: 'POST', body: { trackId: explicit.id, track: { explicit: false } } });
  assert.equal(sneaky.status, 403);
});

test('#2 Spotify connection survives expired tokens and parallel calls', async () => {
  const party = await newParty();
  await connectSpotify(party);
  fake.expireAllTokens(); // every outstanding access token now rejected
  fake.state.refreshCalls = 0;
  const guests = [1, 2, 3, 4, 5, 6].map(() => browser());
  const res = await Promise.all(guests.map(g => g(`${party.base}/search?q=dreams`)));
  assert.ok(res.every(r => r.status === 200), 'all searches succeed');
  assert.equal(fake.state.refreshCalls, 1, 'one shared refresh');
  assert.equal((await party.dj(`${party.base}/state`)).data.spotify.connected, true);
});

test('#3 Spotify login only completes in the DJ\'s own signed-in browser', async () => {
  const { dj, base, code } = await newParty();
  const start = await dj(`${base}/dj/spotify/start`, { method: 'POST', body: { clientId: 'c'.repeat(32) } });
  const state = new URL(start.data.url).searchParams.get('state');
  const u = new URL(start.data.url);
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(!u.searchParams.has('client_secret'));

  const victim = browser(); // not this party's DJ
  const cb = await victim(`/auth/spotify/callback?state=${state}&code=authcode`, { raw: true });
  assert.equal(cb.headers.get('location'), `/dj/${code}?spotify=signin`);
  assert.equal((await dj(`${base}/state`)).data.spotify.connected, false);
  // The state is single-use: replaying it fails.
  const replay = await dj(`/auth/spotify/callback?state=${state}&code=authcode`, { raw: true });
  assert.equal(replay.headers.get('location'), '/?spotify=expired');
});

test('#4 rate limits use the proxy-added IP, not the forgeable first entry', async () => {
  const { base, pin } = await newParty();
  const attacker = browser('203.0.113.7'); // forged first XFF entry changes every request
  for (let i = 0; i < 8; i++) {
    assert.equal((await attacker(`${base}/dj/login`, { method: 'POST', body: { pin: '000000' } })).status, 401);
  }
  assert.equal((await attacker(`${base}/dj/login`, { method: 'POST', body: { pin: '000000' } })).status, 429);
  // #6: the attacker can't lock the real DJ out from another device.
  assert.equal((await browser()(`${base}/dj/login`, { method: 'POST', body: { pin } })).status, 200);
});

test('#6 guessing party codes gets rate-limited, normal use does not', async () => {
  const guesser = browser();
  const statuses = [];
  for (let i = 0; i < 25; i++) statuses.push((await guesser(`/api/r/ZZZZ${'ABCDEFGHJK'[i % 10]}/state`)).status);
  assert.ok(statuses.includes(429), 'misses are limited');
  const { base } = await newParty();
  const fan = browser();
  for (let i = 0; i < 40; i++) assert.equal((await fan(`${base}/state`)).status, 200);
});

test('#7 state is saved atomically, and encrypted at rest', async () => {
  const party = await newParty('Persisted');
  await connectSpotify(party);
  for (let i = 0; i < 20; i++) await browser()(`${party.base}/requests`, { method: 'POST', body: { title: `Song ${i}` } });
  await new Promise(r => setTimeout(r, 1200));
  const files = fs.readdirSync(dataDir);
  assert.ok(files.includes('rooms.json'));
  assert.ok(!files.some(f => f.endsWith('.tmp')), 'no temp files left behind');
  const raw = fs.readFileSync(path.join(dataDir, 'rooms.json'), 'utf8');
  const file = JSON.parse(raw);
  assert.equal(file.v, 1);
  assert.ok(file.iv && file.tag && file.data, 'AES-GCM envelope');
  for (const secret of [party.pin, 'Persisted', 'Song 1', 'refreshToken', 'accessToken']) {
    assert.ok(!raw.includes(secret), `"${secret}" must not appear in plaintext`);
  }
});

// ------------------------------------------------------------------ hardening

test('hosts must accept the Terms; acceptance is required server-side', async () => {
  const b = browser();
  assert.equal((await b('/api/rooms', { method: 'POST', body: { partyName: 'x' } })).status, 400);
  assert.equal((await b('/api/rooms', { method: 'POST', body: { partyName: 'x', acceptTerms: 'yes' } })).status, 400);
  assert.equal((await b('/api/rooms', { method: 'POST', body: { partyName: 'x', acceptTerms: true } })).status, 201);
});

test('security headers: CSP, no framing, no sniffing', async () => {
  for (const p of ['/', '/api/rooms/ZZZZZ', '/terms']) {
    const r = await browser()(p, { raw: true });
    const csp = r.headers.get('content-security-policy') || '';
    assert.match(csp, /default-src 'self'/, p);
    assert.match(csp, /script-src 'self'(;|$)/, `${p}: no inline/remote scripts`);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
  }
});

test('cross-site POSTs are blocked', async () => {
  const { base } = await newParty();
  const r = await browser()(`${base}/requests`, { method: 'POST', body: { title: 'x' }, headers: { Origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
  const ok = await browser()(`${base}/requests`, { method: 'POST', body: { title: 'x' }, headers: { Origin: B } });
  assert.equal(ok.status, 201);
});

test('legal pages are filled with operator details, HTML-escaped', async () => {
  const html = await (await browser()('/terms', { raw: true })).text();
  assert.ok(html.includes('Test Operator &lt;b&gt;Ltd&lt;/b&gt;'), 'escaped');
  assert.ok(!html.includes('<b>Ltd</b>'));
  assert.ok(html.includes('Testland'));
  assert.ok(!/\{\{\w+\}\}/.test(html), 'no unfilled placeholders');
  const privacy = await (await browser()('/privacy', { raw: true })).text();
  assert.ok(privacy.includes('legal@example.test'));
});

test('invisible and text-direction characters are stripped from names and titles', async () => {
  const { base, dj } = await newParty();
  await browser()(`${base}/requests`, { method: 'POST', body: { title: 'Good‮dab Song​', name: 'A\u0000l⁦ex' } });
  const req = (await dj(`${base}/state`)).data.requests[0];
  assert.equal(req.track.title, 'Gooddab Song');
  assert.equal(req.by, 'Alex');
});

test('DJ can block a disruptive guest', async () => {
  const { base, dj } = await newParty();
  const troll = browser(), fan = browser();
  const id = (await troll(`${base}/requests`, { method: 'POST', body: { title: 'Rude title' } })).data.id;
  const fanId = (await fan(`${base}/requests`, { method: 'POST', body: { title: 'Nice song' } })).data.id;
  await troll(`${base}/requests/${fanId}/vote`, { method: 'POST' });
  assert.equal((await dj(`${base}/dj/requests/${id}/block`, { method: 'POST' })).status, 200);
  const st = (await dj(`${base}/state`)).data;
  assert.ok(!st.requests.some(r => r.id === id), 'their request is gone');
  assert.equal(st.requests.find(r => r.id === fanId).votes, 1, 'their votes are removed');
  assert.equal(st.blockedCount, 1);
  assert.equal((await troll(`${base}/requests`, { method: 'POST', body: { title: 'again' } })).status, 403);
  assert.equal((await troll(`${base}/requests/${fanId}/vote`, { method: 'POST' })).status, 403);
  await dj(`${base}/dj/unblock-all`, { method: 'POST' });
  assert.equal((await troll(`${base}/requests`, { method: 'POST', body: { title: 'sorry' } })).status, 201);
});

test('searches are cached and Spotify rate limits are respected', async () => {
  const party = await newParty();
  await connectSpotify(party);
  const before = fake.state.searchCalls;
  for (let i = 0; i < 5; i++) assert.equal((await browser()(`${party.base}/search?q=Same%20Song`)).status, 200);
  assert.equal(fake.state.searchCalls - before, 1, 'one Spotify call for repeated searches');

  fake.state.rateLimitSearch = 3;
  try {
    const first = await browser()(`${party.base}/search?q=new%20one`);
    assert.equal(first.status, 429);
    const calls = fake.state.searchCalls;
    const second = await browser()(`${party.base}/search?q=another`);
    assert.equal(second.status, 429);
    assert.equal(fake.state.searchCalls, calls, 'backs off without calling Spotify again');
    assert.equal((await party.dj(`${party.base}/state`)).data.spotify.connected, true, 'not disconnected');
  } finally { fake.state.rateLimitSearch = 0; }
});

test('guests can withdraw only their own requests', async () => {
  const { base } = await newParty();
  const a = browser(), b = browser();
  const id = (await a(`${base}/requests`, { method: 'POST', body: { title: 'Mine' } })).data.id;
  assert.equal((await b(`${base}/requests/${id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await a(`${base}/requests/${id}`, { method: 'DELETE' })).status, 200);
});
