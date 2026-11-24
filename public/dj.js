import { icons, h, api, toast, connect, renderList, setArt, subline, roomCode } from './shared.js';

const $ = id => document.getElementById(id);
const CODE = roomCode();
const BASE = `/api/r/${CODE}`;
let S = null;
let editing = false; // don't clobber inputs while the DJ is typing

for (const id of ['logo', 'loginLogo']) $(id).innerHTML = icons.logo;
document.querySelectorAll('[data-close]').forEach(b => { b.innerHTML = icons.x; b.onclick = closeSheets; });

// ------------------------------------------------------------- auth

(async () => {
  try {
    const { dj, partyName } = await api(`${BASE}/dj/me`);
    if (dj) return start();
    $('loginTitle').textContent = partyName;
    showLogin();
  } catch {
    // Party doesn't exist (anymore).
    location.replace('/');
  }
})();

function showLogin() {
  $('login').hidden = false;
  $('app').hidden = true;
  setTimeout(() => $('pin').focus(), 100);
}

$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await api(`${BASE}/dj/login`, { method: 'POST', body: { pin: $('pin').value.trim() } });
    $('login').hidden = true;
    start();
  } catch (err) {
    const card = $('loginForm');
    card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
    $('pin').value = '';
    toast(err.message, { error: true });
  }
});

let started = false;
function start() {
  if (started) return;
  started = true;
  $('app').hidden = false;
  moveThumb();
  let first = true;
  connect(BASE, state => {
    S = state;
    render();
    if (first) { first = false; onFirstState(); }
  }, online => {
    if (!online) $('chipGuests').lastChild.textContent = 'Reconnecting';
  }, () => location.replace('/'));
}

function onFirstState() {
  const params = new URLSearchParams(location.search);
  const msg = params.get('spotify');
  if (msg) {
    const text = {
      connected: 'Spotify connected',
      denied: 'Spotify access was declined',
      error: 'Spotify login failed. Check the Client ID and that the redirect URI matches exactly.',
      signin: 'Finish connecting Spotify in a browser where you’re signed in as this party’s DJ.',
    }[msg];
    if (text) toast(text, { error: msg !== 'connected', ms: msg === 'connected' ? 2600 : 6000 });
    if (msg === 'error') openSpotifySetup();
  }
  if (params.has('welcome')) {
    $('welcomePin').textContent = S.pin;
    $('welcomeCode').textContent = S.code;
    openSheet('welcome');
  }
  if (params.toString()) history.replaceState(null, '', location.pathname);
}

// ------------------------------------------------------------- sheets

function openSheet(id) {
  closeSheets();
  $(id).classList.add('open');
  $(id).setAttribute('aria-hidden', 'false');
  $('scrim').classList.add('open');
}
function closeSheets() {
  document.querySelectorAll('.sheet.open').forEach(s => { s.classList.remove('open'); s.setAttribute('aria-hidden', 'true'); });
  $('scrim').classList.remove('open');
}
$('scrim').onclick = closeSheets;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheets(); });

$('welcomeShare').onclick = () => { closeSheets(); selectTab('share'); };
$('welcomeSpotify').onclick = openSpotifySetup;

// ------------------------------------------------------------- tabs

const tabs = [...document.querySelectorAll('#tabs button')];
tabs.forEach(b => b.addEventListener('click', () => selectTab(b.dataset.tab)));
function selectTab(name) {
  tabs.forEach(t => t.classList.toggle('on', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('on', p.id === `panel-${name}`));
  moveThumb();
  if (name === 'share') $('qr').src = `${BASE}/dj/qr.svg`;
}
function moveThumb() {
  const on = tabs.find(t => t.classList.contains('on'));
  const thumb = $('segThumb');
  thumb.style.width = `${on.offsetWidth}px`;
  thumb.style.transform = `translateX(${on.offsetLeft - 4}px)`;
}
addEventListener('resize', moveThumb);

// ------------------------------------------------------------- render

function render() {
  const s = S.settings;
  document.title = `${s.partyName} · DJ · QueueUp`;
  $('partyName').textContent = s.partyName;
  $('qrTitle').textContent = s.partyName;
  $('chipGuests').lastChild.textContent = `${S.listeners} guest${S.listeners === 1 ? '' : 's'}`;
  $('chipGuests').classList.toggle('ok', S.listeners > 0);
  $('chipSpotify').classList.toggle('ok', S.spotify.connected);
  $('chipSpotify').lastChild.textContent = S.spotify.connected ? 'Spotify' : 'Manual mode';

  const np = S.nowPlaying;
  setArt($('npArt'), np?.track);
  $('npLabel').textContent = np ? (np.isPlaying ? 'Now playing' : 'Paused') : 'Now playing';
  $('npTitle').textContent = np ? np.track.title : 'Nothing playing';
  $('npArtist').textContent = np ? np.track.artist : (S.spotify.connected ? 'Start playback in Spotify' : 'Set it manually, or connect Spotify');
  $('npEdit').hidden = S.spotify.connected;

  const by = st => S.requests.filter(r => r.status === st);
  const queued = by('queued'), pending = by('pending');
  const played = by('played').sort((a, b) => b.playedAt - a.playedAt).slice(0, 15);

  $('queuedWrap').hidden = !queued.length;
  $('queuedCount').textContent = queued.length || '';
  renderList($('queued'), queued, r => r.id, buildRow, updateRow);

  $('pendingCount').textContent = pending.length || '';
  $('pendingEmpty').hidden = pending.length > 0;
  renderList($('pending'), pending, r => r.id, buildRow, updateRow);

  $('playedWrap').hidden = !played.length;
  $('playedCount').textContent = played.length || '';
  renderList($('played'), played, r => r.id, buildRow, updateRow);

  $('guestUrl').value = S.guestUrl;
  $('openGuest').href = S.guestUrl;
  $('codeText').textContent = S.code;

  if (!editing) renderSettings();
}

function buildRow() {
  return h('li', { class: 'row' },
    h('div', { class: 'art' }),
    h('div', { class: 'meta' }, h('div', { class: 'title' }), h('div', { class: 'sub' })),
    h('div', { class: 'actions' }));
}

function updateRow(el, r) {
  setArt(el.querySelector('.art'), r.track);
  el.classList.toggle('queued', r.status === 'queued');
  el.style.opacity = r.status === 'played' ? '.55' : '';
  el.querySelector('.title').textContent = r.track.title;
  // "typed in" only matters when Spotify is connected (it can't be auto-queued).
  const extra = [r.by && `from ${r.by}`, !r.track.uri && S.spotify.connected && 'typed in'].filter(Boolean).join(' · ');
  el.querySelector('.sub').replaceChildren(...subline(r.track, extra));

  const sig = `${r.status}|${r.votes}|${S.spotify.connected}`;
  const actions = el.querySelector('.actions');
  if (actions.dataset.sig === sig) return;
  actions.dataset.sig = sig;

  const votes = h('div', { class: 'votes-count' }, r.votes, h('small', {}, r.votes === 1 ? 'VOTE' : 'VOTES'));
  const btn = (label, icon, cls, action, title) =>
    h('button', { class: `btn btn-sm ${cls}`, title: title || label, 'aria-label': title || label, onclick: e => act(r.id, action, e.currentTarget) },
      icon ? h('span', { html: icon, style: 'display:inline-flex' }) : null, h('span', { class: 'lbl' }, label));
  const toSpotify = S.spotify.connected && r.track.uri;

  if (r.status === 'pending') {
    actions.replaceChildren(
      votes,
      h('button', { class: 'btn btn-icon btn-ghost', title: 'Dismiss', 'aria-label': 'Dismiss', html: icons.x, onclick: e => act(r.id, 'dismiss', e.currentTarget) }),
      btn('Queue', icons.queue, 'btn-primary', 'queue', toSpotify ? 'Add to your Spotify queue' : 'Mark as queued'));
  } else if (r.status === 'queued') {
    actions.replaceChildren(
      toSpotify ? h('span', { class: 'tag' }, 'In Spotify queue') : btn('Playing', icons.play, '', 'playing', 'Mark as now playing'),
      h('button', { class: 'btn btn-icon btn-ghost', title: 'Back to requests', 'aria-label': 'Back to requests', html: icons.undo, onclick: e => act(r.id, 'restore', e.currentTarget) }));
  } else {
    actions.replaceChildren(h('span', { class: 'tag', style: 'color:var(--faint)' }, 'Played'));
  }
}

async function act(id, action, button) {
  button?.classList.add('loading');
  try {
    await api(`${BASE}/dj/requests/${id}/${action}`, { method: 'POST' });
    if (action === 'queue') toast(S.spotify.connected ? 'Added to Spotify queue' : 'Queued');
  } catch (e) {
    toast(e.message, { error: true, ms: 5000 });
  } finally {
    button?.classList.remove('loading');
  }
}

// ------------------------------------------------------------- manual now playing

$('npEdit').onclick = () => {
  const f = $('npForm');
  f.hidden = !f.hidden;
  if (!f.hidden) {
    $('npT').value = S.nowPlaying?.track.title || '';
    $('npA').value = S.nowPlaying?.track.artist || '';
    $('npT').focus();
  }
};
$('npForm').addEventListener('submit', e => { e.preventDefault(); saveNowPlaying($('npT').value, $('npA').value); });
$('npClear').onclick = () => saveNowPlaying('', '');
async function saveNowPlaying(title, artist) {
  try {
    await api(`${BASE}/dj/now-playing`, { method: 'POST', body: { title, artist } });
    $('npForm').hidden = true;
  } catch (e) { toast(e.message, { error: true }); }
}

// ------------------------------------------------------------- settings

const toggles = { sRequests: 'requestsOpen', sVoting: 'votingOpen', sExplicit: 'allowExplicit', sNames: 'showNames' };

function renderSettings() {
  const s = S.settings;
  if (document.activeElement !== $('sName')) $('sName').value = s.partyName;
  for (const [id, key] of Object.entries(toggles)) $(id).checked = s[key];
  document.querySelectorAll('.stepper').forEach(st => { st.querySelector('output').textContent = s[st.dataset.key]; });

  const sp = S.spotify;
  $('spotifyText').textContent = sp.connected
    ? `Connected${sp.user ? ` as ${sp.user.name}` : ''}${sp.user?.product && sp.user.product !== 'premium' ? ' — queueing needs Premium' : ''}`
    : 'Show what’s playing, let guests search, and queue with one tap';
  const action = $('spotifyAction');
  const want = sp.connected ? 'disconnect' : 'connect';
  if (action.dataset.mode !== want) {
    action.dataset.mode = want;
    action.replaceChildren(want === 'connect'
      ? h('button', { class: 'btn btn-sm btn-primary', onclick: openSpotifySetup }, 'Connect')
      : h('button', { class: 'btn btn-sm', onclick: disconnectSpotify }, 'Disconnect'));
  }
}

async function patch(body) {
  try { await api(`${BASE}/dj/settings`, { method: 'PATCH', body }); return true; }
  catch (e) { toast(e.message, { error: true }); return false; }
}

for (const [id, key] of Object.entries(toggles)) $(id).addEventListener('change', e => patch({ [key]: e.target.checked }));

let nameTimer;
$('sName').addEventListener('input', () => {
  editing = true;
  clearTimeout(nameTimer);
  nameTimer = setTimeout(async () => { await patch({ partyName: $('sName').value }); editing = false; }, 500);
});

document.querySelectorAll('.stepper').forEach(st => {
  st.addEventListener('click', e => {
    const b = e.target.closest('button[data-d]');
    if (!b) return;
    const out = st.querySelector('output');
    const v = Math.max(+st.dataset.min, Math.min(+st.dataset.max, (+out.textContent || 0) + +b.dataset.d));
    out.textContent = v;
    patch({ [st.dataset.key]: v });
  });
});

$('showPin').onclick = e => {
  const b = e.currentTarget;
  b.textContent = b.textContent === 'Show' ? S.pin : 'Show';
};

// ------------------------------------------------------------- spotify

function openSpotifySetup() {
  $('redirectUri').textContent = S.spotify.redirectUri;
  if (!$('clientId').value) $('clientId').value = S.spotify.clientId || '';
  // Locally, Spotify can only redirect back to 127.0.0.1 on this computer.
  const loopback = S.spotify.redirectUri.startsWith('http://127.0.0.1');
  $('loopbackNote').hidden = !(loopback && location.hostname !== '127.0.0.1');
  openSheet('spotifySheet');
}

$('copyRedirect').onclick = () => copy(S.spotify.redirectUri, 'Redirect URI copied');

$('spotifyForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.submitter; btn?.classList.add('loading');
  try {
    const { url } = await api(`${BASE}/dj/spotify/start`, { method: 'POST', body: { clientId: $('clientId').value.trim() } });
    location.href = url;
  } catch (err) {
    toast(err.message, { error: true, ms: 4000 });
    btn?.classList.remove('loading');
  }
});

async function disconnectSpotify() {
  if (!confirm('Disconnect Spotify? Guests will switch to typing song names.')) return;
  await api(`${BASE}/dj/spotify/disconnect`, { method: 'POST' }).catch(e => toast(e.message, { error: true }));
}

// ------------------------------------------------------------- danger zone

$('clearHistory').onclick = async () => {
  await api(`${BASE}/dj/clear`, { method: 'POST', body: { scope: 'history' } });
  toast('History cleared');
};
$('clearAll').onclick = async () => {
  if (!confirm('Remove every request, including queued songs?')) return;
  await api(`${BASE}/dj/clear`, { method: 'POST', body: { scope: 'all' } });
  toast('All requests removed');
};
$('logout').onclick = async () => {
  await api(`${BASE}/dj/logout`, { method: 'POST' });
  location.reload();
};
$('endParty').onclick = async () => {
  if (!confirm('End this party for everyone? This deletes all requests and can’t be undone.')) return;
  await api(`${BASE}/dj/end`, { method: 'POST' }).catch(e => toast(e.message, { error: true }));
  location.replace('/');
};

// ------------------------------------------------------------- share

async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); }
  catch { toast('Copy failed — select and copy manually', { error: true }); }
}
$('copyUrl').onclick = () => copy($('guestUrl').value, 'Link copied');
$('printQr').onclick = () => {
  const card = $('qrCard').cloneNode(true);
  card.removeAttribute('id');
  card.style.boxShadow = 'none';
  card.style.maxWidth = '520px';
  $('printArea').replaceChildren(card);
  window.print();
};
