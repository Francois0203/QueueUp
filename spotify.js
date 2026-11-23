// Thin Spotify Web API client. Only the DJ authenticates; guests search through the DJ's token.
import crypto from 'node:crypto';

const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';
const SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-modify-playback-state',
].join(' ');

export function createSpotify({ clientId, clientSecret, redirectUri, getAuth, setAuth }) {
  const configured = Boolean(clientId && clientSecret && redirectUri);
  const pendingStates = new Map(); // oauth state -> expiry

  function authorizeUrl() {
    const state = crypto.randomBytes(16).toString('hex');
    pendingStates.set(state, Date.now() + 10 * 60_000);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: SCOPES,
      redirect_uri: redirectUri,
      state,
    });
    return `${ACCOUNTS}/authorize?${params}`;
  }

  async function tokenRequest(body) {
    const res = await fetch(`${ACCOUNTS}/api/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      },
      body: new URLSearchParams(body),
    });
    if (!res.ok) throw new Error(`Spotify token error ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async function handleCallback(code, state) {
    const expiry = pendingStates.get(state);
    pendingStates.delete(state);
    if (!expiry || expiry < Date.now()) throw new Error('Login expired, please try again.');
    const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
    const auth = {
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
      expiresAt: Date.now() + (t.expires_in - 60) * 1000,
      user: null,
    };
    setAuth(auth);
    try {
      const me = await api('/me');
      setAuth({ ...getAuth(), user: { name: me.display_name || me.id, product: me.product } });
    } catch { /* non-fatal */ }
  }

  async function accessToken() {
    const auth = getAuth();
    if (!auth) throw new Error('Spotify not connected');
    if (Date.now() < auth.expiresAt) return auth.accessToken;
    const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: auth.refreshToken });
    const next = {
      ...auth,
      accessToken: t.access_token,
      refreshToken: t.refresh_token || auth.refreshToken,
      expiresAt: Date.now() + (t.expires_in - 60) * 1000,
    };
    setAuth(next);
    return next.accessToken;
  }

  async function api(path, { method = 'GET' } = {}) {
    const token = await accessToken();
    const res = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 204) return null;
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { msg = JSON.parse(text).error?.message || text; } catch {}
      const err = new Error(msg || `Spotify error ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return text ? JSON.parse(text) : null;
  }

  return {
    configured,
    get connected() { return Boolean(getAuth()); },
    authorizeUrl,
    handleCallback,
    disconnect: () => setAuth(null),

    async search(q) {
      // Development-mode apps are capped at limit=10.
      const data = await api(`/search?type=track&limit=10&q=${encodeURIComponent(q)}`);
      return (data?.tracks?.items || []).map(toTrack);
    },

    async nowPlaying() {
      const data = await api('/me/player/currently-playing');
      if (!data || !data.item || data.currently_playing_type !== 'track') return null;
      return { track: toTrack(data.item), progressMs: data.progress_ms ?? 0, isPlaying: data.is_playing };
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
