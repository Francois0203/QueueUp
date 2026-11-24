// Minimal fake of Spotify's accounts + Web API, enough to test QueueUp end to end.
import http from 'node:http';

export async function startFakeSpotify() {
  const state = {
    validTokens: new Set(),
    usedRefresh: new Set(),
    refreshCalls: 0,
    failRefreshWith: 0,          // set to e.g. 500 to simulate an outage
    searchCalls: 0,
    rateLimitSearch: 0,          // set to N seconds to answer search with 429 + Retry-After
    queued: [],
    nowPlaying: null,
    seq: 0,
  };
  const tracks = [
    { id: 'track00000000000000001', name: 'Dreams', explicit: false, artists: [{ name: 'Fleetwood Mac' }] },
    { id: 'track00000000000000002', name: 'Rude Song', explicit: true, artists: [{ name: 'Some Band' }] },
  ].map(t => ({ ...t, uri: `spotify:track:${t.id}`, duration_ms: 200000, album: { name: 'Album', images: [] } }));

  const issue = () => {
    const n = ++state.seq;
    state.validTokens.add(`at${n}`);
    return { access_token: `at${n}`, refresh_token: `rt${n}`, expires_in: 3600, token_type: 'Bearer' };
  };
  const send = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let body = '';
    for await (const c of req) body += c;

    if (req.method === 'POST' && url.pathname === '/api/token') {
      const p = new URLSearchParams(body);
      if (!p.get('client_id')) return send(res, 400, { error: 'invalid_client' });
      if (p.get('grant_type') === 'authorization_code') {
        if (!p.get('code_verifier')) return send(res, 400, { error: 'invalid_request' });
        return send(res, 200, issue());
      }
      if (p.get('grant_type') === 'refresh_token') {
        state.refreshCalls++;
        await new Promise(r => setTimeout(r, 30)); // widen the race window
        if (state.failRefreshWith) return send(res, state.failRefreshWith, { error: 'server_error' });
        const rt = p.get('refresh_token');
        // PKCE refresh tokens rotate: reusing one is rejected.
        if (state.usedRefresh.has(rt)) return send(res, 400, { error: 'invalid_grant' });
        state.usedRefresh.add(rt);
        return send(res, 200, issue());
      }
      return send(res, 400, { error: 'unsupported_grant_type' });
    }

    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!state.validTokens.has(token)) return send(res, 401, { error: { status: 401, message: 'Invalid access token' } });

    if (url.pathname === '/v1/me') return send(res, 200, { id: 'dj', display_name: 'Test DJ', product: 'premium' });
    if (url.pathname === '/v1/search') {
      state.searchCalls++;
      if (state.rateLimitSearch) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(state.rateLimitSearch) });
        return res.end(JSON.stringify({ error: { status: 429, message: 'API rate limit exceeded' } }));
      }
      return send(res, 200, { tracks: { items: tracks } });
    }
    if (url.pathname === '/v1/me/player/currently-playing') {
      return state.nowPlaying ? send(res, 200, { item: state.nowPlaying, progress_ms: 1000, is_playing: true, currently_playing_type: 'track' }) : send(res, 204);
    }
    if (req.method === 'POST' && url.pathname === '/v1/me/player/queue') {
      state.queued.push(url.searchParams.get('uri'));
      return send(res, 204);
    }
    send(res, 404, { error: { status: 404, message: 'Not found' } });
  });

  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    state, tracks,
    accountsUrl: base,
    apiUrl: `${base}/v1`,
    expireAllTokens: () => state.validTokens.clear(),
    close: () => new Promise(r => { server.closeAllConnections(); server.close(r); }),
  };
}
