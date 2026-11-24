// QueueUp — live song requests & voting for parties.
// Many independent rooms per server. Each DJ connects their own Spotify developer app.
// State persists to data/rooms.json. Designed to run as a single long-lived process.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { authorizeUrl, exchangeCode, clientFor, isClientId } from './spotify.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'rooms.json');
const PORT = Number(process.env.PORT) || 3000;
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const ROOM_TTL_MS = 48 * 3600_000;   // rooms idle this long are deleted
const MAX_ROOMS = 2000;

// ---------------------------------------------------------------- urls

function lanAddress() {
  // Prefer typical home/venue Wi-Fi ranges over VPN (e.g. Tailscale 100.x) or virtual adapters.
  const score = ip => ip.startsWith('192.168.') ? 3 : ip.startsWith('10.') ? 2 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 1 : 0;
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
    .map(i => i.address).sort((a, b) => score(b) - score(a));
  return ips[0] || '127.0.0.1';
}

/** Base URL guests' phones use (QR codes). */
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://${lanAddress()}:${PORT}`).replace(/\/$/, '');
/** Redirect URI every DJ registers in their Spotify app. Spotify requires https or a 127.0.0.1 loopback. */
const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI
  || (PUBLIC_URL.startsWith('https://') ? `${PUBLIC_URL}/auth/spotify/callback` : `http://127.0.0.1:${PORT}/auth/spotify/callback`);

// ---------------------------------------------------------------- state

const DEFAULT_SETTINGS = {
  partyName: 'Tonight',
  requestsOpen: true,
  votingOpen: true,
  maxPendingPerGuest: 3,
  allowExplicit: true,
  autoQueueAt: 0,   // 0 = off
  showNames: true,
};

/** @type {Map<string, any>} persisted rooms */
let rooms = new Map();
/** @type {Map<string, {clients:Set<any>, timer:any, pollKey:string}>} runtime-only data */
const live = new Map();
let saveTimer = null;

try {
  const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  for (const r of raw.rooms || []) rooms.set(r.code, { ...r, settings: { ...DEFAULT_SETTINGS, ...r.settings } });
} catch { /* first run */ }

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 400);
}

// One write at a time, each to its own temp file, so overlapping saves can't
// interleave or rename a half-written file over rooms.json.
let saving = false, saveAgain = false, tmpSeq = 0;
async function flushSave() {
  if (saving) { saveAgain = true; return; }
  saving = true;
  const tmp = `${STATE_FILE}.${process.pid}.${++tmpSeq}.tmp`;
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    await fsp.writeFile(tmp, JSON.stringify({ rooms: [...rooms.values()] }), { mode: 0o600 });
    await fsp.rename(tmp, STATE_FILE);
  } catch (e) {
    console.error('Save failed:', e);
    fsp.rm(tmp, { force: true }).catch(() => {});
  } finally {
    saving = false;
    if (saveAgain) { saveAgain = false; flushSave(); }
  }
}

function runtime(code) {
  let rt = live.get(code);
  if (!rt) {
    rt = {
      clients: new Set(), timer: null, pollKey: '',
      spotify: null,        // cached client, so token refreshes are shared (single-flight)
      tracks: new Map(),    // trackId -> { track, exp }: songs this server returned from search
    };
    live.set(code, rt);
  }
  return rt;
}

// ---- #1: only accept songs the server itself returned from Spotify search
const TRACK_TTL_MS = 60 * 60_000;
const TRACK_CACHE_MAX = 1000;
function rememberTracks(room, tracks) {
  const cache = runtime(room.code).tracks;
  const exp = Date.now() + TRACK_TTL_MS;
  for (const t of tracks) { cache.delete(t.id); cache.set(t.id, { track: t, exp }); }
  while (cache.size > TRACK_CACHE_MAX) cache.delete(cache.keys().next().value); // oldest first
}
function knownTrack(room, id) {
  const hit = runtime(room.code).tracks.get(String(id || ''));
  return hit && hit.exp > Date.now() ? hit.track : null;
}

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 5; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

function createRoom(partyName) {
  const room = {
    code: newCode(),
    createdAt: Date.now(),
    lastActive: Date.now(),
    djPin: String(crypto.randomInt(100000, 1000000)),
    djSessions: [],   // [{ hash, exp }]
    settings: { ...DEFAULT_SETTINGS, partyName: partyName || DEFAULT_SETTINGS.partyName },
    requests: [],
    nowPlaying: null,
    spotify: null,    // { clientId, auth, user }
  };
  rooms.set(room.code, room);
  saveSoon();
  return room;
}

function deleteRoom(code) {
  const rt = live.get(code);
  if (rt) for (const c of rt.clients) { send(c, 'ended', {}); c.res.end(); }
  live.delete(code);
  rooms.delete(code);
  saveSoon();
}

// Delete idle rooms.
setInterval(() => {
  const cutoff = Date.now() - ROOM_TTL_MS;
  for (const r of rooms.values()) {
    if (r.lastActive < cutoff && !(live.get(r.code)?.clients.size)) deleteRoom(r.code);
  }
}, 10 * 60_000);

// ---------------------------------------------------------------- spotify per room

function spotifyOf(room) {
  const rt = runtime(room.code);
  // Read the room through the map so a client never writes into a deleted room.
  rt.spotify ??= clientFor(
    () => rooms.get(room.code)?.spotify,
    conn => { const r = rooms.get(room.code); if (r) { r.spotify = conn; saveSoon(); } });
  return rt.spotify;
}

function spotifyError(room, err) {
  // Only a definitive auth failure drops the connection (refresh token revoked, app deleted,
  // or still 401 after a fresh token). Outages and 5xx/429 are temporary and must not disconnect.
  if (err.revoked) {
    console.warn(`[${room.code}] Spotify auth lost:`, err.message);
    room.spotify = room.spotify ? { clientId: room.spotify.clientId, auth: null, user: null } : null;
    changed(room);
  }
}

const isConnected = room => Boolean(room.spotify?.auth);

async function pollRoom(room) {
  if (!isConnected(room)) return;
  const rt = runtime(room.code);
  try {
    const np = await spotifyOf(room).nowPlaying();
    const key = np ? `${np.track.id}:${np.isPlaying}` : 'none';
    const drift = np && room.nowPlaying?.track?.id === np.track.id
      ? Math.abs(expectedProgress(room.nowPlaying) - np.progressMs) : Infinity;
    if (key !== rt.pollKey || drift > 2500) {
      rt.pollKey = key;
      room.nowPlaying = np ? { ...np, updatedAt: Date.now(), source: 'spotify' } : null;
      if (np) markPlayed(room, np.track.id);
      changed(room);
    }
  } catch (err) { spotifyError(room, err); }
}

// Poll only rooms someone is looking at.
setInterval(() => {
  for (const [code, rt] of live) {
    const room = rooms.get(code);
    if (room && rt.clients.size) pollRoom(room);
  }
}, 4000);

function expectedProgress(np) {
  if (!np) return 0;
  return np.isPlaying ? np.progressMs + (Date.now() - np.updatedAt) : np.progressMs;
}

function markPlayed(room, trackId) {
  for (const r of room.requests) {
    if (r.track.id === trackId && (r.status === 'queued' || r.status === 'pending')) {
      r.status = 'played';
      r.playedAt = Date.now();
    }
  }
}

// ---------------------------------------------------------------- realtime (SSE)

function publicState(room, guestId, isDj) {
  const s = room.settings;
  const rt = runtime(room.code);
  return {
    code: room.code,
    settings: isDj ? { ...s } : {
      partyName: s.partyName, requestsOpen: s.requestsOpen, votingOpen: s.votingOpen, maxPendingPerGuest: s.maxPendingPerGuest,
    },
    nowPlaying: room.nowPlaying,
    requests: room.requests
      .filter(r => r.status === 'pending' || r.status === 'queued' || (isDj && r.status === 'played'))
      .map(r => ({
        id: r.id,
        track: r.track,
        status: r.status,
        votes: r.votes.length,
        voted: r.votes.includes(guestId),
        mine: r.by.guestId === guestId,
        by: (s.showNames || isDj) ? r.by.name || '' : '',
        createdAt: r.createdAt,
        queuedAt: r.queuedAt || 0,
        playedAt: r.playedAt || 0,
      })),
    spotify: {
      connected: isConnected(room),
      ...(isDj ? {
        clientId: room.spotify?.clientId || '',
        user: room.spotify?.user || null,
        redirectUri: REDIRECT_URI,
      } : {}),
    },
    listeners: [...rt.clients].filter(c => !c.isDj).length,
    ...(isDj ? { guestUrl: `${PUBLIC_URL}/p/${room.code}`, pin: room.djPin } : {}),
    serverTime: Date.now(),
  };
}

function changed(room) {
  room.lastActive = Date.now();
  saveSoon();
  const rt = runtime(room.code);
  if (rt.timer) return; // coalesce bursts
  rt.timer = setTimeout(() => {
    rt.timer = null;
    for (const c of rt.clients) send(c, 'state', publicState(room, c.guestId, c.isDj));
  }, 50);
}

function send(c, event, data) {
  c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

setInterval(() => {
  for (const rt of live.values()) for (const c of rt.clients) c.res.write(': ping\n\n');
}, 25_000);

// ---------------------------------------------------------------- helpers

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const SECURE = PUBLIC_URL.startsWith('https://');
function cookie(name, value, maxAgeSec) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${SECURE ? '; Secure' : ''}`;
}

function json(res, status, data, headers = {}) {
  // Keep any cookie already set (e.g. the guest id) when a route adds its own.
  if (headers['Set-Cookie'] && res.getHeader('Set-Cookie')) {
    headers = { ...headers, 'Set-Cookie': [].concat(res.getHeader('Set-Cookie'), headers['Set-Cookie']) };
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16_384) throw Object.assign(new Error('Body too large'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const sha = v => crypto.createHash('sha256').update(String(v)).digest('hex');

function clientIp(req) {
  if (TRUST_PROXY) {
    // Use the LAST entry: it is appended by our own proxy (ALB/nginx). Earlier entries
    // come from the client and can be forged to dodge rate limits.
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean).pop();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress || '';
}

/**
 * Sliding-window limiter: allow `max` hits per `windowMs` per key.
 * With record=false it only checks, without counting this call.
 */
const limits = new Map();
function limited(key, max, windowMs, record = true) {
  const now = Date.now();
  const hits = (limits.get(key) || []).filter(t => now - t < windowMs);
  if (hits.length >= max) { limits.set(key, hits); return true; }
  if (!record) return false;
  hits.push(now);
  limits.set(key, hits);
  return false;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of limits) if (!v.some(t => now - t < 3600_000)) limits.delete(k); }, 600_000);

const djCookie = code => `qu_dj_${code}`;
function isDj(req, room) {
  const token = parseCookies(req)[djCookie(room.code)];
  if (!token) return false;
  const h = sha(token), now = Date.now();
  return room.djSessions.some(s => s.hash === h && s.exp > now);
}
function newDjSession(room) {
  const token = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  room.djSessions = room.djSessions.filter(s => s.exp > now).slice(-19);
  room.djSessions.push({ hash: sha(token), exp: now + 7 * 86400_000 });
  saveSoon();
  return cookie(djCookie(room.code), token, 7 * 86400);
}

function sortRequests(room) {
  const rank = s => ({ queued: 0, pending: 1, played: 2, dismissed: 3 }[s]);
  room.requests.sort((a, b) => {
    if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);
    if (a.status === 'queued') return a.queuedAt - b.queuedAt;
    return b.votes.length - a.votes.length || a.createdAt - b.createdAt;
  });
}

function pruneRequests(room) {
  const cutoff = Date.now() - 3 * 3600_000;
  room.requests = room.requests.filter(r =>
    !((r.status === 'dismissed' || r.status === 'played') && (r.playedAt || r.createdAt) < cutoff));
  if (room.requests.length > 300) room.requests = room.requests.slice(0, 300);
}

async function queueRequest(room, r) {
  if (isConnected(room) && r.track.uri) await spotifyOf(room).addToQueue(r.track.uri);
  r.status = 'queued';
  r.queuedAt = Date.now();
}

async function maybeAutoQueue(room, r) {
  const n = room.settings.autoQueueAt;
  if (n > 0 && r.status === 'pending' && r.votes.length >= n) {
    try { await queueRequest(room, r); }
    catch (e) { spotifyError(room, e); console.warn(`[${room.code}] Auto-queue failed:`, e.message); }
  }
}

function spotifyHint(e) {
  if (e.status === 404) return 'No active Spotify device. Open Spotify and start playing something first.';
  if (e.status === 403) return 'Spotify refused to queue. Queuing needs Spotify Premium.';
  if (e.revoked) return 'Spotify disconnected. Reconnect it in Settings.';
  if (e.status === 429) return 'Spotify is rate-limiting right now. Try again in a few seconds.';
  return `Spotify: ${e.message}`;
}

// ---------------------------------------------------------------- static

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

async function serveStatic(res, file, status = 200) {
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR + path.sep)) return json(res, 404, { error: 'Not found' });
  try {
    const data = await fsp.readFile(full);
    res.writeHead(status, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SECURITY_HEADERS });
    res.end(data);
  } catch {
    json(res, 404, { error: 'Not found' });
  }
}

// ---------------------------------------------------------------- routes

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (err) {
    const status = err.status && err.status < 500 ? err.status : 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) json(res, status, { error: status === 500 ? 'Something went wrong' : err.message });
  }
});

/** Pending Spotify logins: state -> { code, clientId, verifier, exp } */
const pendingLogins = new Map();

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const method = req.method;
  const cookies = parseCookies(req);

  // Anonymous guest id for votes and request limits.
  let guestId = cookies.qu_gid;
  if (!guestId || !/^[a-f0-9]{32}$/.test(guestId)) {
    guestId = crypto.randomBytes(16).toString('hex');
    res.setHeader('Set-Cookie', cookie('qu_gid', guestId, 365 * 86400));
  }

  // ---- pages
  if (method === 'GET') {
    if (p === '/') return serveStatic(res, 'home.html');
    if (/^\/p\/[A-Za-z0-9]{5}$/.test(p)) {
      const code = p.slice(3).toUpperCase();
      if (code !== p.slice(3)) return redirect(res, `/p/${code}`);
      return serveStatic(res, 'index.html');
    }
    if (/^\/dj\/[A-Za-z0-9]{5}$/.test(p)) return serveStatic(res, 'dj.html');
    if (p === '/healthz') return json(res, 200, { ok: true, rooms: rooms.size });
  }

  // ---- create a party
  if (method === 'POST' && p === '/api/rooms') {
    if (limited(`create:${clientIp(req)}`, 10, 3600_000)) return json(res, 429, { error: 'Too many parties created. Try again later.' });
    if (rooms.size >= MAX_ROOMS) return json(res, 503, { error: 'QueueUp is full right now. Try again later.' });
    const body = await readBody(req);
    const room = createRoom(clean(body.partyName, 40));
    return json(res, 201, { code: room.code, pin: room.djPin }, { 'Set-Cookie': newDjSession(room) });
  }

  // ---- does a party exist? (join form)
  let m = p.match(/^\/api\/rooms\/([A-Za-z0-9]{5})$/);
  if (m && method === 'GET') {
    const room = rooms.get(m[1].toUpperCase());
    if (room) return json(res, 200, { code: room.code, partyName: room.settings.partyName });
    if (limited(`miss:${clientIp(req)}`, 20, 60_000)) return json(res, 429, { error: 'Too many wrong codes. Wait a minute.' });
    return json(res, 404, { error: 'No party with that code.' });
  }

  // ---- Spotify OAuth callback (global; state maps back to a room)
  if (method === 'GET' && p === '/auth/spotify/callback') {
    const pending = pendingLogins.get(url.searchParams.get('state') || '');
    pendingLogins.delete(url.searchParams.get('state') || '');
    if (!pending || pending.exp < Date.now()) return redirect(res, '/?spotify=expired');
    const room = rooms.get(pending.code);
    if (!room) return redirect(res, '/');
    const back = `/dj/${room.code}`;
    // The browser finishing the login must be this party's signed-in DJ. Otherwise someone could
    // send a DJ a login link started from *their* party and capture that DJ's Spotify.
    if (!isDj(req, room)) return redirect(res, `${back}?spotify=signin`);
    if (url.searchParams.get('error')) return redirect(res, `${back}?spotify=denied`);
    try {
      const auth = await exchangeCode({ clientId: pending.clientId, code: url.searchParams.get('code'), verifier: pending.verifier, redirectUri: REDIRECT_URI });
      room.spotify = { clientId: pending.clientId, auth, user: null };
      try {
        const user = await spotifyOf(room).me();
        room.spotify = { ...room.spotify, user };
      } catch (e) { console.warn('Spotify /me failed:', e.message); }
      runtime(room.code).pollKey = '';
      await pollRoom(room);
      changed(room);
      return redirect(res, `${back}?spotify=connected`);
    } catch (e) {
      console.error(`[${room.code}]`, e.message);
      return redirect(res, `${back}?spotify=error`);
    }
  }

  // ---- everything else is scoped to a room: /api/r/:code/...
  m = p.match(/^\/api\/r\/([A-Z0-9]{5})(\/.*)$/);
  if (!m) {
    if (method === 'GET' && /^\/[\w-]+\.(css|js|svg|png|ico|webmanifest)$/.test(p)) return serveStatic(res, p.slice(1));
    return json(res, 404, { error: 'Not found' });
  }
  const room = rooms.get(m[1]);
  if (!room) {
    // Only misses count, so normal use is never limited but guessing codes is.
    if (limited(`miss:${clientIp(req)}`, 20, 60_000)) return json(res, 429, { error: 'Too many wrong codes. Wait a minute.' });
    return json(res, 404, { error: 'This party has ended or the code is wrong.' });
  }
  const sub = m[2];
  const dj = isDj(req, room);

  // realtime stream
  if (method === 'GET' && sub === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const rt = runtime(room.code);
    const c = { res, guestId, isDj: dj };
    rt.clients.add(c);
    send(c, 'state', publicState(room, guestId, dj));
    if (!rt.pollKey && isConnected(room)) pollRoom(room);
    changed(room);
    req.on('close', () => { rt.clients.delete(c); if (rooms.has(room.code)) changed(room); });
    return;
  }

  if (method === 'GET' && sub === '/state') return json(res, 200, publicState(room, guestId, dj));

  // guest: search Spotify (through the DJ's connection)
  if (method === 'GET' && sub === '/search') {
    const q = clean(url.searchParams.get('q'), 100);
    if (!q) return json(res, 200, { results: [] });
    if (!isConnected(room)) return json(res, 200, { results: [], manual: true });
    if (limited(`search:${room.code}:${guestId}`, 40, 60_000)) return json(res, 429, { error: 'Searching too fast. Wait a moment.' });
    try {
      let results = await spotifyOf(room).search(q);
      rememberTracks(room, results);
      if (!room.settings.allowExplicit) results = results.filter(t => !t.explicit);
      return json(res, 200, { results });
    } catch (e) {
      spotifyError(room, e);
      return json(res, e.status === 429 ? 429 : 502, { error: e.status === 429 ? 'Spotify is busy. Try again in a few seconds.' : 'Search is unavailable right now.' });
    }
  }

  // guest: request a song
  if (method === 'POST' && sub === '/requests') {
    const s = room.settings;
    if (!s.requestsOpen && !dj) return json(res, 403, { error: 'Requests are paused right now.' });
    if (limited(`req:${room.code}:${guestId}`, 10, 60_000)) return json(res, 429, { error: 'Too many requests. Wait a moment.' });
    const body = await readBody(req);
    let track;
    const pickedId = body.trackId ?? body.track?.id;
    if (pickedId) {
      // Never trust song details from the browser: a guest could show one title and queue another,
      // or clear the explicit flag. Use the copy this server got from Spotify search.
      track = knownTrack(room, pickedId);
      if (!track) return json(res, 400, { error: 'That song isn’t available anymore. Search for it again.' });
    } else {
      const title = clean(body.title, 120);
      const artist = clean(body.artist, 120);
      if (!title) return json(res, 400, { error: 'Song title is required.' });
      track = { id: 'manual:' + `${title}|${artist}`.toLowerCase(), uri: '', title, artist, album: '', art: '', durationMs: 0, explicit: false };
    }
    if (track.explicit && !s.allowExplicit) return json(res, 403, { error: 'Explicit songs are turned off tonight.' });

    // Already waiting? Count it as a vote instead of a duplicate.
    const existing = room.requests.find(r => r.track.id === track.id && (r.status === 'pending' || r.status === 'queued'));
    if (existing) {
      if (existing.status === 'pending' && !existing.votes.includes(guestId) && s.votingOpen) {
        existing.votes.push(guestId);
        await maybeAutoQueue(room, existing);
      }
      sortRequests(room);
      changed(room);
      return json(res, 200, { ok: true, merged: true, status: existing.status });
    }

    const mine = room.requests.filter(r => r.by.guestId === guestId && r.status === 'pending').length;
    if (!dj && s.maxPendingPerGuest > 0 && mine >= s.maxPendingPerGuest) {
      return json(res, 429, { error: `You can have ${s.maxPendingPerGuest} open request${s.maxPendingPerGuest === 1 ? '' : 's'} at a time.` });
    }

    const r = { id: crypto.randomUUID(), track, by: { guestId, name: clean(body.name, 24) }, votes: [guestId], status: 'pending', createdAt: Date.now() };
    room.requests.push(r);
    await maybeAutoQueue(room, r);
    pruneRequests(room);
    sortRequests(room);
    changed(room);
    return json(res, 201, { ok: true, id: r.id });
  }

  // guest: vote / unvote
  let mm = sub.match(/^\/requests\/([\w-]+)\/vote$/);
  if (mm && method === 'POST') {
    if (!room.settings.votingOpen) return json(res, 403, { error: 'Voting is paused right now.' });
    const r = room.requests.find(x => x.id === mm[1]);
    if (!r || r.status !== 'pending') return json(res, 404, { error: 'That request is no longer open.' });
    const i = r.votes.indexOf(guestId);
    if (i >= 0) r.votes.splice(i, 1); else r.votes.push(guestId);
    if (i < 0) await maybeAutoQueue(room, r);
    sortRequests(room);
    changed(room);
    return json(res, 200, { ok: true, voted: i < 0, votes: r.votes.length });
  }

  // guest: withdraw own request
  mm = sub.match(/^\/requests\/([\w-]+)$/);
  if (mm && method === 'DELETE') {
    const r = room.requests.find(x => x.id === mm[1]);
    if (!r || (r.by.guestId !== guestId && !dj)) return json(res, 404, { error: 'Not found' });
    if (r.status !== 'pending') return json(res, 409, { error: 'Already handled by the DJ.' });
    room.requests = room.requests.filter(x => x !== r);
    changed(room);
    return json(res, 200, { ok: true });
  }

  // DJ auth
  if (method === 'POST' && sub === '/dj/login') {
    // Per-IP limits only. A per-party limit would let any guest lock the real DJ out.
    // 8/min and 40/hour per IP makes guessing a 6-digit PIN impractical.
    const ip = clientIp(req);
    if (limited(`pinfail:${ip}`, 8, 60_000, false) || limited(`pinfailh:${ip}`, 40, 3600_000, false)) {
      return json(res, 429, { error: 'Too many attempts. Wait a few minutes.' });
    }
    const body = await readBody(req);
    const ok = crypto.timingSafeEqual(Buffer.from(sha(String(body.pin ?? '').trim())), Buffer.from(sha(room.djPin)));
    if (!ok) {
      limited(`pinfail:${ip}`, 8, 60_000);      // count failures only
      limited(`pinfailh:${ip}`, 40, 3600_000);
      return json(res, 401, { error: 'Wrong PIN.' });
    }
    return json(res, 200, { ok: true }, { 'Set-Cookie': newDjSession(room) });
  }
  if (method === 'POST' && sub === '/dj/logout') {
    const h = sha(cookies[djCookie(room.code)] || '');
    room.djSessions = room.djSessions.filter(s => s.hash !== h);
    saveSoon();
    return json(res, 200, { ok: true }, { 'Set-Cookie': cookie(djCookie(room.code), '', 0) });
  }
  if (method === 'GET' && sub === '/dj/me') return json(res, 200, { dj, partyName: room.settings.partyName });

  // ---- DJ only below
  if (!sub.startsWith('/dj/')) return json(res, 404, { error: 'Not found' });
  if (!dj) return json(res, 401, { error: 'DJ login required.' });

  if (method === 'POST' && sub === '/dj/spotify/start') {
    const body = await readBody(req);
    const clientId = clean(body.clientId, 64);
    if (!isClientId(clientId)) return json(res, 400, { error: 'That doesn’t look like a Spotify Client ID (32 letters and numbers).' });
    const state = crypto.randomBytes(16).toString('hex');
    const { url: authUrl, verifier } = authorizeUrl({ clientId, redirectUri: REDIRECT_URI, state });
    const now = Date.now();
    for (const [k, v] of pendingLogins) if (v.exp < now) pendingLogins.delete(k);
    pendingLogins.set(state, { code: room.code, clientId, verifier, exp: now + 10 * 60_000 });
    room.spotify = { clientId, auth: room.spotify?.clientId === clientId ? room.spotify.auth : null, user: room.spotify?.user || null };
    saveSoon();
    return json(res, 200, { url: authUrl });
  }

  if (method === 'POST' && sub === '/dj/spotify/disconnect') {
    room.spotify = room.spotify ? { clientId: room.spotify.clientId, auth: null, user: null } : null;
    if (room.nowPlaying?.source === 'spotify') room.nowPlaying = null;
    changed(room);
    return json(res, 200, { ok: true });
  }

  if (method === 'GET' && sub === '/dj/qr.svg') {
    const svg = await QRCode.toString(`${PUBLIC_URL}/p/${room.code}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
    return res.end(svg);
  }

  if (method === 'PATCH' && sub === '/dj/settings') {
    const body = await readBody(req);
    const s = room.settings;
    if ('partyName' in body) s.partyName = clean(body.partyName, 40) || DEFAULT_SETTINGS.partyName;
    for (const k of ['requestsOpen', 'votingOpen', 'allowExplicit', 'showNames']) if (k in body) s[k] = Boolean(body[k]);
    if ('maxPendingPerGuest' in body) s.maxPendingPerGuest = Math.max(0, Math.min(20, Math.round(Number(body.maxPendingPerGuest) || 0)));
    if ('autoQueueAt' in body) s.autoQueueAt = Math.max(0, Math.min(100, Math.round(Number(body.autoQueueAt) || 0)));
    changed(room);
    return json(res, 200, { ok: true, settings: s });
  }

  mm = sub.match(/^\/dj\/requests\/([\w-]+)\/(queue|dismiss|playing|restore)$/);
  if (mm && method === 'POST') {
    const r = room.requests.find(x => x.id === mm[1]);
    if (!r) return json(res, 404, { error: 'Request not found.' });
    const action = mm[2];
    if (action === 'queue') {
      try { await queueRequest(room, r); }
      catch (e) { spotifyError(room, e); return json(res, 502, { error: spotifyHint(e) }); }
    } else if (action === 'dismiss') {
      r.status = 'dismissed';
    } else if (action === 'restore') {
      r.status = 'pending';
    } else if (action === 'playing') {
      room.nowPlaying = { track: r.track, progressMs: 0, isPlaying: true, updatedAt: Date.now(), source: 'manual' };
      r.status = 'played';
      r.playedAt = Date.now();
    }
    sortRequests(room);
    changed(room);
    return json(res, 200, { ok: true });
  }

  if (method === 'POST' && sub === '/dj/now-playing') {
    const body = await readBody(req);
    const title = clean(body.title, 120);
    room.nowPlaying = title
      ? { track: { id: 'manual:' + title.toLowerCase(), uri: '', title, artist: clean(body.artist, 120), album: '', art: '', durationMs: 0, explicit: false },
          progressMs: 0, isPlaying: true, updatedAt: Date.now(), source: 'manual' }
      : null;
    changed(room);
    return json(res, 200, { ok: true });
  }

  if (method === 'POST' && sub === '/dj/clear') {
    const body = await readBody(req);
    room.requests = body.scope === 'all' ? [] : room.requests.filter(r => r.status === 'pending' || r.status === 'queued');
    changed(room);
    return json(res, 200, { ok: true });
  }

  if (method === 'POST' && sub === '/dj/end') {
    deleteRoom(room.code);
    return json(res, 200, { ok: true }, { 'Set-Cookie': cookie(djCookie(room.code), '', 0) });
  }

  return json(res, 404, { error: 'Not found' });
}

server.listen(PORT, () => {
  console.log(`\n  QueueUp is live  (${rooms.size} saved part${rooms.size === 1 ? 'y' : 'ies'})`);
  console.log(`  Open:          http://127.0.0.1:${PORT}`);
  console.log(`  Guest links:   ${PUBLIC_URL}/p/<code>`);
  console.log(`  Spotify redirect URI (DJs add this to their Spotify app):`);
  console.log(`                 ${REDIRECT_URI}\n`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    clearTimeout(saveTimer);
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify({ rooms: [...rooms.values()] }), { mode: 0o600 });
    } catch (e) { console.error(e); }
    process.exit(0);
  });
}
