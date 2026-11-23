// QueueUp — live song requests & voting for a party.
// One server = one party. State persists to data/state.json.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { createSpotify } from './spotify.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const PORT = Number(process.env.PORT) || 3000;

// ---------------------------------------------------------------- state

const DEFAULT_SETTINGS = {
  partyName: 'Tonight',
  requestsOpen: true,
  votingOpen: true,
  maxPendingPerGuest: 3,
  allowExplicit: true,
  autoQueueAt: 0,          // 0 = off; otherwise auto-queue at this many votes
  showNames: true,
  publicUrl: '',
};

let saveTimer = null;
const state = loadState();
if (process.env.DJ_PIN) state.djPin = String(process.env.DJ_PIN);
if (!state.djPin) state.djPin = String(crypto.randomInt(100000, 1000000));
saveSoon();

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return {
      settings: { ...DEFAULT_SETTINGS, ...s.settings },
      requests: s.requests || [],
      nowPlaying: s.nowPlaying || null,
      spotify: s.spotify || null,
      djPin: s.djPin || '',
    };
  } catch {
    return { settings: { ...DEFAULT_SETTINGS }, requests: [], nowPlaying: null, spotify: null, djPin: '' };
  }
}

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    const tmp = STATE_FILE + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(state, null, 2));
    await fsp.rename(tmp, STATE_FILE);
  }, 300);
}

// ---------------------------------------------------------------- spotify

const spotify = createSpotify({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.SPOTIFY_REDIRECT_URI || `http://127.0.0.1:${PORT}/auth/spotify/callback`,
  getAuth: () => state.spotify,
  setAuth: (a) => { state.spotify = a; saveSoon(); },
});

let lastPollKey = '';
async function pollSpotify() {
  if (!spotify.connected) return;
  try {
    const np = await spotify.nowPlaying();
    const key = np ? `${np.track.id}:${np.isPlaying}` : 'none';
    // Progress is interpolated on the client; only broadcast on track / play-state change
    // or when the drift would be noticeable.
    const drift = np && state.nowPlaying?.track?.id === np.track.id
      ? Math.abs(expectedProgress(state.nowPlaying) - np.progressMs) : Infinity;
    if (key !== lastPollKey || drift > 2500) {
      lastPollKey = key;
      state.nowPlaying = np ? { ...np, updatedAt: Date.now(), source: 'spotify' } : null;
      if (np) markPlayed(np.track.id);
      changed();
    }
  } catch (err) {
    if (err.status === 401 || /invalid_grant|revoked/i.test(err.message)) {
      console.warn('Spotify auth lost:', err.message);
      state.spotify = null;
      changed();
    }
  }
}
setInterval(pollSpotify, 4000);

function expectedProgress(np) {
  if (!np) return 0;
  return np.isPlaying ? np.progressMs + (Date.now() - np.updatedAt) : np.progressMs;
}

function markPlayed(trackId) {
  for (const r of state.requests) {
    if (r.track.id === trackId && (r.status === 'queued' || r.status === 'pending')) {
      r.status = 'played';
      r.playedAt = Date.now();
    }
  }
}

// ---------------------------------------------------------------- realtime (SSE)

const clients = new Set(); // { res, guestId, isDj }

function publicState(guestId, isDj) {
  const s = state.settings;
  const visible = state.requests
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
    }));
  return {
    settings: {
      partyName: s.partyName,
      requestsOpen: s.requestsOpen,
      votingOpen: s.votingOpen,
      maxPendingPerGuest: s.maxPendingPerGuest,
      ...(isDj ? s : {}),
    },
    nowPlaying: state.nowPlaying,
    requests: visible,
    spotify: { configured: spotify.configured, connected: spotify.connected, ...(isDj ? { user: state.spotify?.user || null } : {}) },
    listeners: [...clients].filter(c => !c.isDj).length,
    publicUrl: isDj ? publicUrl() : undefined,
    serverTime: Date.now(),
  };
}

let broadcastTimer = null;
function changed() {
  saveSoon();
  // Coalesce bursts of changes into one push.
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    for (const c of clients) send(c, 'state', publicState(c.guestId, c.isDj));
  }, 50);
}

function send(c, event, data) {
  c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

setInterval(() => { for (const c of clients) c.res.write(': ping\n\n'); }, 25_000);

// ---------------------------------------------------------------- helpers

function publicUrl() {
  if (state.settings.publicUrl) return state.settings.publicUrl.replace(/\/$/, '');
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  // Prefer typical home/venue Wi-Fi ranges over VPN (e.g. Tailscale 100.x) or virtual adapters.
  const score = ip =>
    ip.startsWith('192.168.') ? 3 :
    ip.startsWith('10.') ? 2 :
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 1 : 0;
  const candidates = Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
    .map(i => i.address)
    .sort((a, b) => score(b) - score(a));
  return `http://${candidates[0] || '127.0.0.1'}:${PORT}`;
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookie(name, value, maxAgeSec) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

function json(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
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

const djSessions = new Set();
const loginAttempts = new Map(); // ip -> [timestamps]

function isDj(req) {
  return djSessions.has(parseCookies(req).qu_dj);
}

function sortRequests() {
  // Queued first (in order queued), then pending by votes, then oldest first.
  state.requests.sort((a, b) => {
    const rank = s => ({ queued: 0, pending: 1, played: 2, dismissed: 3 }[s]);
    if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);
    if (a.status === 'queued') return a.queuedAt - b.queuedAt;
    return b.votes.length - a.votes.length || a.createdAt - b.createdAt;
  });
}

function pruneRequests() {
  // Keep history bounded: drop dismissed/played older than 3 hours, cap at 300 entries.
  const cutoff = Date.now() - 3 * 3600_000;
  state.requests = state.requests.filter(r =>
    !((r.status === 'dismissed' || r.status === 'played') && (r.playedAt || r.createdAt) < cutoff));
  if (state.requests.length > 300) state.requests = state.requests.slice(0, 300);
}

async function queueRequest(r) {
  if (spotify.connected && r.track.uri) {
    await spotify.addToQueue(r.track.uri); // throws if no active device / not Premium
  }
  r.status = 'queued';
  r.queuedAt = Date.now();
}

// ---------------------------------------------------------------- routes

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

async function serveStatic(res, file) {
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR)) return json(res, 404, { error: 'Not found' });
  try {
    const data = await fsp.readFile(full);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    json(res, 404, { error: 'Not found' });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (err) {
    const status = err.status && err.status < 500 ? err.status : 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) json(res, status, { error: err.message || 'Something went wrong' });
  }
});

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const method = req.method;

  // Every visitor gets an anonymous guest id (used for votes and request limits).
  const cookies = parseCookies(req);
  let guestId = cookies.qu_gid;
  const setCookies = [];
  if (!guestId || !/^[a-f0-9]{32}$/.test(guestId)) {
    guestId = crypto.randomBytes(16).toString('hex');
    setCookies.push(cookie('qu_gid', guestId, 365 * 86400));
  }
  if (setCookies.length) res.setHeader('Set-Cookie', setCookies);
  const dj = isDj(req);

  // ---- pages
  if (method === 'GET' && p === '/') return serveStatic(res, 'index.html');
  if (method === 'GET' && p === '/dj') return serveStatic(res, 'dj.html');

  // ---- realtime
  if (method === 'GET' && p === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const c = { res, guestId, isDj: dj };
    clients.add(c);
    send(c, 'state', publicState(guestId, dj));
    changed(); // listener count changed
    req.on('close', () => { clients.delete(c); changed(); });
    return;
  }

  if (method === 'GET' && p === '/api/state') return json(res, 200, publicState(guestId, dj));

  // ---- guest: search
  if (method === 'GET' && p === '/api/search') {
    const q = clean(url.searchParams.get('q'), 100);
    if (!q) return json(res, 200, { results: [] });
    if (!spotify.connected) return json(res, 200, { results: [], manual: true });
    let results = await spotify.search(q);
    if (!state.settings.allowExplicit) results = results.filter(t => !t.explicit);
    return json(res, 200, { results });
  }

  // ---- guest: request a song
  if (method === 'POST' && p === '/api/requests') {
    const s = state.settings;
    if (!s.requestsOpen && !dj) return json(res, 403, { error: 'Requests are paused right now.' });
    const body = await readBody(req);
    let track;
    if (body.track?.id && body.track?.uri?.startsWith('spotify:track:')) {
      const t = body.track;
      track = {
        id: clean(t.id, 64), uri: clean(t.uri, 100), title: clean(t.title, 200), artist: clean(t.artist, 200),
        album: clean(t.album, 200), art: /^https:\/\/i\.scdn\.co\//.test(t.art) ? clean(t.art, 300) : '',
        durationMs: Number(t.durationMs) || 0, explicit: Boolean(t.explicit),
      };
    } else {
      const title = clean(body.title, 120);
      const artist = clean(body.artist, 120);
      if (!title) return json(res, 400, { error: 'Song title is required.' });
      track = {
        id: 'manual:' + `${title}|${artist}`.toLowerCase(), uri: '', title, artist,
        album: '', art: '', durationMs: 0, explicit: false,
      };
    }
    if (track.explicit && !s.allowExplicit) return json(res, 403, { error: 'Explicit songs are turned off tonight.' });

    // Same song already waiting? Count it as a vote instead of a duplicate.
    const existing = state.requests.find(r => r.track.id === track.id && (r.status === 'pending' || r.status === 'queued'));
    if (existing) {
      if (existing.status === 'pending' && !existing.votes.includes(guestId)) existing.votes.push(guestId);
      sortRequests();
      changed();
      return json(res, 200, { ok: true, merged: true, status: existing.status });
    }

    const mine = state.requests.filter(r => r.by.guestId === guestId && r.status === 'pending').length;
    if (!dj && s.maxPendingPerGuest > 0 && mine >= s.maxPendingPerGuest) {
      return json(res, 429, { error: `You can have ${s.maxPendingPerGuest} open request${s.maxPendingPerGuest === 1 ? '' : 's'} at a time.` });
    }

    const r = {
      id: crypto.randomUUID(),
      track,
      by: { guestId, name: clean(body.name, 24) },
      votes: [guestId],
      status: 'pending',
      createdAt: Date.now(),
    };
    state.requests.push(r);
    await maybeAutoQueue(r);
    pruneRequests();
    sortRequests();
    changed();
    return json(res, 201, { ok: true, id: r.id });
  }

  // ---- guest: vote / unvote
  let m = p.match(/^\/api\/requests\/([\w-]+)\/vote$/);
  if (m && method === 'POST') {
    if (!state.settings.votingOpen) return json(res, 403, { error: 'Voting is paused right now.' });
    const r = state.requests.find(x => x.id === m[1]);
    if (!r || r.status !== 'pending') return json(res, 404, { error: 'That request is no longer open.' });
    const i = r.votes.indexOf(guestId);
    if (i >= 0) r.votes.splice(i, 1); else r.votes.push(guestId);
    if (i < 0) await maybeAutoQueue(r);
    sortRequests();
    changed();
    return json(res, 200, { ok: true, voted: i < 0, votes: r.votes.length });
  }

  // ---- guest: withdraw own request
  m = p.match(/^\/api\/requests\/([\w-]+)$/);
  if (m && method === 'DELETE') {
    const r = state.requests.find(x => x.id === m[1]);
    if (!r || (r.by.guestId !== guestId && !dj)) return json(res, 404, { error: 'Not found' });
    if (r.status !== 'pending') return json(res, 409, { error: 'Already handled by the DJ.' });
    state.requests = state.requests.filter(x => x !== r);
    changed();
    return json(res, 200, { ok: true });
  }

  // ---- DJ auth
  if (method === 'POST' && p === '/api/dj/login') {
    const ip = req.socket.remoteAddress || '';
    const now = Date.now();
    const recent = (loginAttempts.get(ip) || []).filter(t => now - t < 60_000);
    if (recent.length >= 5) return json(res, 429, { error: 'Too many attempts. Wait a minute.' });
    const body = await readBody(req);
    const ok = crypto.timingSafeEqual(
      crypto.createHash('sha256').update(String(body.pin ?? '')).digest(),
      crypto.createHash('sha256').update(state.djPin).digest());
    if (!ok) {
      recent.push(now);
      loginAttempts.set(ip, recent);
      return json(res, 401, { error: 'Wrong PIN.' });
    }
    const token = crypto.randomBytes(24).toString('hex');
    djSessions.add(token);
    return json(res, 200, { ok: true }, { 'Set-Cookie': [...setCookies, cookie('qu_dj', token, 7 * 86400)] });
  }

  if (method === 'POST' && p === '/api/dj/logout') {
    djSessions.delete(cookies.qu_dj);
    return json(res, 200, { ok: true }, { 'Set-Cookie': cookie('qu_dj', '', 0) });
  }

  if (method === 'GET' && p === '/api/dj/me') return json(res, 200, { dj });

  // ---- Spotify OAuth (DJ only)
  if (method === 'GET' && p === '/auth/spotify/login') {
    if (!dj) return redirect(res, '/dj');
    if (!spotify.configured) return redirect(res, '/dj?spotify=not-configured');
    // OAuth must complete on the redirect URI's host (Spotify requires 127.0.0.1 or https).
    return redirect(res, spotify.authorizeUrl());
  }

  if (method === 'GET' && p === '/auth/spotify/callback') {
    const err = url.searchParams.get('error');
    if (err) return redirect(res, '/dj?spotify=denied');
    try {
      await spotify.handleCallback(url.searchParams.get('code'), url.searchParams.get('state'));
      lastPollKey = '';
      await pollSpotify();
      changed();
      return redirect(res, '/dj?spotify=connected');
    } catch (e) {
      console.error(e);
      return redirect(res, '/dj?spotify=error');
    }
  }

  // ---- everything below is DJ-only
  if (p.startsWith('/api/dj/')) {
    if (!dj) return json(res, 401, { error: 'DJ login required.' });

    if (method === 'POST' && p === '/api/dj/spotify/disconnect') {
      spotify.disconnect();
      changed();
      return json(res, 200, { ok: true });
    }

    if (method === 'GET' && p === '/api/dj/qr.svg') {
      const svg = await QRCode.toString(publicUrl(), { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
      return res.end(svg);
    }

    if (method === 'PATCH' && p === '/api/dj/settings') {
      const body = await readBody(req);
      const s = state.settings;
      if ('partyName' in body) s.partyName = clean(body.partyName, 40) || DEFAULT_SETTINGS.partyName;
      for (const k of ['requestsOpen', 'votingOpen', 'allowExplicit', 'showNames']) if (k in body) s[k] = Boolean(body[k]);
      if ('maxPendingPerGuest' in body) s.maxPendingPerGuest = Math.max(0, Math.min(20, Math.round(Number(body.maxPendingPerGuest) || 0)));
      if ('autoQueueAt' in body) s.autoQueueAt = Math.max(0, Math.min(100, Math.round(Number(body.autoQueueAt) || 0)));
      if ('publicUrl' in body) {
        const v = clean(body.publicUrl, 200);
        if (v && !/^https?:\/\/[^\s]+$/i.test(v)) return json(res, 400, { error: 'Guest link must start with http:// or https://' });
        s.publicUrl = v;
      }
      changed();
      return json(res, 200, { ok: true, settings: s });
    }

    m = p.match(/^\/api\/dj\/requests\/([\w-]+)\/(queue|dismiss|playing|restore)$/);
    if (m && method === 'POST') {
      const r = state.requests.find(x => x.id === m[1]);
      if (!r) return json(res, 404, { error: 'Request not found.' });
      const action = m[2];
      if (action === 'queue') {
        try { await queueRequest(r); }
        catch (e) { return json(res, 502, { error: spotifyHint(e) }); }
      } else if (action === 'dismiss') {
        r.status = 'dismissed';
      } else if (action === 'restore') {
        r.status = 'pending';
      } else if (action === 'playing') {
        // Manual "now playing" for DJs not using Spotify.
        state.nowPlaying = { track: r.track, progressMs: 0, isPlaying: true, updatedAt: Date.now(), source: 'manual' };
        r.status = 'played';
        r.playedAt = Date.now();
      }
      sortRequests();
      changed();
      return json(res, 200, { ok: true });
    }

    if (method === 'POST' && p === '/api/dj/now-playing') {
      const body = await readBody(req);
      const title = clean(body.title, 120);
      state.nowPlaying = title
        ? { track: { id: 'manual:' + title.toLowerCase(), uri: '', title, artist: clean(body.artist, 120), album: '', art: '', durationMs: 0, explicit: false },
            progressMs: 0, isPlaying: true, updatedAt: Date.now(), source: 'manual' }
        : null;
      changed();
      return json(res, 200, { ok: true });
    }

    if (method === 'POST' && p === '/api/dj/clear') {
      const body = await readBody(req);
      if (body.scope === 'all') state.requests = [];
      else state.requests = state.requests.filter(r => r.status === 'pending' || r.status === 'queued');
      changed();
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: 'Not found' });
  }

  // ---- static assets
  if (method === 'GET' && /^\/[\w.-]+$/.test(p)) return serveStatic(res, p.slice(1));

  json(res, 404, { error: 'Not found' });
}

async function maybeAutoQueue(r) {
  const n = state.settings.autoQueueAt;
  if (n > 0 && r.status === 'pending' && r.votes.length >= n) {
    try { await queueRequest(r); }
    catch (e) { console.warn('Auto-queue failed:', e.message); }
  }
}

function spotifyHint(e) {
  if (e.status === 404) return 'No active Spotify device. Start playing something in Spotify first.';
  if (e.status === 403) return 'Spotify refused to queue. Queuing requires Spotify Premium.';
  return `Spotify: ${e.message}`;
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

server.listen(PORT, () => {
  console.log(`\n  QueueUp is live`);
  console.log(`  Guests:  ${publicUrl()}`);
  console.log(`  DJ:      http://127.0.0.1:${PORT}/dj   (PIN ${state.djPin})`);
  console.log(`  Spotify: ${spotify.configured ? (spotify.connected ? 'connected' : 'ready to connect from /dj') : 'not configured (see .env.example)'}\n`);
});
