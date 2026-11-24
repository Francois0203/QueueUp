// Spotify Web API client using Authorization Code + PKCE.
// Each DJ brings their own Spotify developer app (Client ID only, no secret), which keeps
// every party within Spotify's development-mode limits: the DJ is the app owner and its only user.
import crypto from 'node:crypto';

// Overridable only so the test suite can point at a fake Spotify server.
const ACCOUNTS = process.env.SPOTIFY_ACCOUNTS_URL || 'https://accounts.spotify.com';
const API = process.env.SPOTIFY_API_URL || 'https://api.spotify.com/v1';
const SCOPES = [
  'user-read-private',
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-modify-playback-state',
].join(' ');

const notConnected = () => Object.assign(new Error('Spotify not connected'), { status: 401 });

export const isClientId =id => /^[a-f0-9]{32}$/i.test(String(id || ''));

/** Returns { url, verifier } for redirecting the DJ to Spotify's consent screen. */
export function authorizeUrl({ clientId, redirectUri, state }) {
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: redirectUri,
    state,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });
  return { url: `${ACCOUNTS}/authorize?${params}`, verifier };
}

async function tokenRequest(body) {
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text, code = '';
    try { const j = JSON.parse(text); code = j.error || ''; msg = j.error_description || j.error || text; } catch {}
    const err = new Error(`Spotify login failed: ${msg}`);
    err.status = res.status;
    // Definitive: the refresh token was revoked/rotated away, or the DJ's app was deleted.
    // Anything else (5xx, 429, network) is temporary and must not disconnect the party.
    err.revoked = code === 'invalid_grant' || code === 'invalid_client';
    throw err;
  }
  return JSON.parse(text);
}

const toAuth = (t, prevRefresh) => ({
  accessToken: t.access_token,
  refreshToken: t.refresh_token || prevRefresh,
  expiresAt: Date.now() + (t.expires_in - 60) * 1000,
});

export async function exchangeCode({ clientId, code, verifier, redirectUri }) {
  const t = await tokenRequest({
    grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier,
  });
  return toAuth(t);
}

/**
 * A client bound to one room's Spotify connection.
 * getConn/setConn read and write { clientId, auth, user } on the room.
 */
export function clientFor(getConn, setConn) {
  // Spotify rotates refresh tokens under PKCE. If several calls refreshed at once, the later
  // ones would use an already-used token and fail, so all callers share one in-flight refresh.
  let refreshing = null;

  function refresh() {
    refreshing ??= (async () => {
      const conn = getConn();
      if (!conn?.auth) throw notConnected();
      const used = conn.auth.refreshToken;
      const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: used, client_id: conn.clientId });
      // The DJ may have disconnected or reconnected meanwhile; don't resurrect a stale login.
      const now = getConn();
      if (now?.auth?.refreshToken === used) setConn({ ...now, auth: toAuth(t, used) });
      if (!getConn()?.auth) throw notConnected();
      return getConn().auth.accessToken;
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  async function accessToken() {
    const conn = getConn();
    if (!conn?.auth) throw notConnected();
    if (Date.now() < conn.auth.expiresAt) return conn.auth.accessToken;
    return refresh();
  }

  async function api(path, { method = 'GET' } = {}, retried = false) {
    const token = await accessToken();
    const res = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401 && !retried) {
      // Token rejected before its expiry: refresh once and retry. A second 401 is definitive.
      const conn = getConn();
      if (conn?.auth) setConn({ ...conn, auth: { ...conn.auth, expiresAt: 0 } });
      return api(path, { method }, true);
    }
    if (res.status === 204) return null;
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { msg = JSON.parse(text).error?.message || text; } catch {}
      throw Object.assign(new Error(msg || `Spotify error ${res.status}`), {
        status: res.status,
        revoked: res.status === 401,
        retryAfter: Number(res.headers.get('retry-after')) || 0, // seconds, sent with 429
      });
    }
    // Some successful calls (like adding to the queue) reply with a body that isn't JSON.
    try { return text ? JSON.parse(text) : null; } catch { return null; }
  }

  return {
    async me() {
      const me = await api('/me');
      return { name: me.display_name || me.id, product: me.product || '' };
    },
    async search(q) {
      // Development-mode apps are capped at limit=10.
      const data = await api(`/search?type=track&limit=10&q=${encodeURIComponent(q)}`);
      return (data?.tracks?.items || []).filter(Boolean).map(toTrack);
    },
    async nowPlaying() {
      const data = await api('/me/player/currently-playing');
      if (!data || !data.item || data.currently_playing_type !== 'track') return null;
      return { track: toTrack(data.item), progressMs: data.progress_ms ?? 0, isPlaying: Boolean(data.is_playing) };
    },
    /**
     * What plays next: songs queued by hand first, then the rest of the playlist or album.
     * Spotify returns up to about 20 and doesn't say which were queued by hand.
     */
    async queue() {
      const data = await api('/me/player/queue');
      return (data?.queue || []).filter(t => t?.type === 'track' && t.id).map(toTrack);
    },
    async addToQueue(uri) {
      await api(`/me/player/queue?uri=${encodeURIComponent(uri)}`, { method: 'POST' });
    },
  };
}

export function toTrack(t) {
  const images = t.album?.images || [];
  return {
    id: t.id,
    uri: t.uri,
    title: t.name,
    artist: (t.artists || []).map(a => a.name).join(', '),
    album: t.album?.name || '',
    art: (images[1] || images[0])?.url || '',
    durationMs: t.duration_ms || 0,
    explicit: Boolean(t.explicit),
  };
}
