import { icons, h, api, toast, connect, renderList, artEl, setArt, subline } from './shared.js';

const $ = id => document.getElementById(id);
let S = null;
let editing = false; // don't clobber inputs while the DJ is typing

$('logo').innerHTML = icons.logo;
$('loginLogo').innerHTML = icons.logo;

// ------------------------------------------------------------- auth

(async () => {
  const { dj } = await api('/api/dj/me');
  dj ? start() : showLogin();
})();

function showLogin() {
  $('login').hidden = false;
  $('app').hidden = true;
  setTimeout(() => $('pin').focus(), 100);
}

$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await api('/api/dj/login', { method: 'POST', body: { pin: $('pin').value.trim() } });
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
  connect(state => { S = state; render(); }, online => {
    if (!online) $('chipGuests').lastChild.textContent = 'Reconnecting';
  });
  const msg = new URLSearchParams(location.search).get('spotify');
  if (msg) {
    const text = {
      connected: 'Spotify connected',
      denied: 'Spotify access was declined',
      error: 'Could not connect Spotify — check the server log',
      'not-configured': 'Add your Spotify keys to .env first',
    }[msg];
    if (text) toast(text, { error: msg !== 'connected' });
    history.replaceState(null, '', '/dj');
  }
}

// ------------------------------------------------------------- tabs

const tabs = [...document.querySelectorAll('#tabs button')];
tabs.forEach(b => b.addEventListener('click', () => {
  tabs.forEach(t => t.classList.toggle('on', t === b));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('on', p.id === `panel-${b.dataset.tab}`));
  moveThumb();
  if (b.dataset.tab === 'share') refreshQr();
}));
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

  // now playing
  const np = S.nowPlaying;
  setArt($('npArt'), np?.track);
  $('npLabel').textContent = np ? (np.isPlaying ? 'Now playing' : 'Paused') : 'Now playing';
  $('npTitle').textContent = np ? np.track.title : 'Nothing playing';
  $('npArtist').textContent = np ? np.track.artist : (S.spotify.connected ? 'Start playback in Spotify' : 'Set it manually');
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
  const extra = [r.by && `from ${r.by}`, !r.track.uri && 'typed in'].filter(Boolean).join(' · ');
  el.querySelector('.sub').replaceChildren(...subline(r.track, extra));

  // Rebuild actions only when the relevant inputs change.
  const sig = `${r.status}|${r.votes}|${S.spotify.connected}`;
  const actions = el.querySelector('.actions');
  if (actions.dataset.sig === sig) return;
  actions.dataset.sig = sig;

  const votes = h('div', { class: 'votes-count' }, r.votes, h('small', {}, r.votes === 1 ? 'VOTE' : 'VOTES'));
  const btn = (label, icon, cls, action, title) =>
    h('button', { class: `btn btn-sm ${cls}`, title: title || label, onclick: e => act(r.id, action, e.currentTarget) },
      icon ? h('span', { html: icon, style: 'display:inline-flex' }) : null, h('span', { class: 'lbl' }, label));

  if (r.status === 'pending') {
    actions.replaceChildren(
      votes,
      h('button', { class: 'btn btn-icon btn-ghost', title: 'Dismiss', 'aria-label': 'Dismiss', html: icons.x, onclick: e => act(r.id, 'dismiss', e.currentTarget) }),
      btn('Queue', icons.queue, 'btn-primary', 'queue', S.spotify.connected && r.track.uri ? 'Add to your Spotify queue' : 'Mark as queued'));
  } else if (r.status === 'queued') {
    actions.replaceChildren(
      S.spotify.connected && r.track.uri ? h('span', { class: 'tag' }, 'In Spotify queue') : btn('Playing', icons.play, '', 'playing', 'Mark as now playing'),
      h('button', { class: 'btn btn-icon btn-ghost', title: 'Back to requests', 'aria-label': 'Back to requests', html: icons.undo, onclick: e => act(r.id, 'restore', e.currentTarget) }));
  } else {
    actions.replaceChildren(h('span', { class: 'tag', style: 'color:var(--faint)' }, 'Played'));
  }
}

async function act(id, action, button) {
  button?.classList.add('loading');
  try {
    await api(`/api/dj/requests/${id}/${action}`, { method: 'POST' });
    if (action === 'queue') toast(S.spotify.connected ? 'Added to Spotify queue' : 'Queued');
  } catch (e) {
    toast(e.message, { error: true, ms: 4000 });
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
$('npForm').addEventListener('submit', async e => {
  e.preventDefault();
  await saveNowPlaying($('npT').value, $('npA').value);
});
$('npClear').onclick = () => saveNowPlaying('', '');
async function saveNowPlaying(title, artist) {
  try {
    await api('/api/dj/now-playing', { method: 'POST', body: { title, artist } });
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
  $('spotifyText').textContent = !sp.configured
    ? 'Add your Spotify app keys to .env to enable search and queueing'
    : sp.connected ? `Connected${sp.user ? ` as ${sp.user.name}` : ''}${sp.user?.product && sp.user.product !== 'premium' ? ' — queueing needs Premium' : ''}`
    : 'Connect to show what’s playing, search songs and queue requests';
  const action = $('spotifyAction');
  const want = !sp.configured ? 'none' : sp.connected ? 'disconnect' : 'connect';
  if (action.dataset.mode !== want) {
    action.dataset.mode = want;
    action.replaceChildren(
      want === 'connect' ? h('button', { class: 'btn btn-sm btn-primary', onclick: connectSpotify }, 'Connect')
      : want === 'disconnect' ? h('button', { class: 'btn btn-sm', onclick: disconnectSpotify }, 'Disconnect')
      : '');
  }

  if (document.activeElement !== $('guestUrl')) $('guestUrl').value = S.publicUrl || '';
  $('openGuest').href = S.publicUrl || '/';
}

async function patch(body) {
  try { await api('/api/dj/settings', { method: 'PATCH', body }); return true; }
  catch (e) { toast(e.message, { error: true }); return false; }
}

for (const [id, key] of Object.entries(toggles)) {
  $(id).addEventListener('change', e => patch({ [key]: e.target.checked }));
}

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

function connectSpotify() {
  // Spotify only accepts the registered redirect URI (127.0.0.1 or https), so the
  // DJ must start the login from a browser that can reach it — usually this computer.
  location.href = '/auth/spotify/login';
}
async function disconnectSpotify() {
  if (!confirm('Disconnect Spotify? Guests will switch to typing song names.')) return;
  await api('/api/dj/spotify/disconnect', { method: 'POST' }).catch(e => toast(e.message, { error: true }));
}

$('clearHistory').onclick = async () => {
  await api('/api/dj/clear', { method: 'POST', body: { scope: 'history' } });
  toast('History cleared');
};
$('clearAll').onclick = async () => {
  if (!confirm('Remove every request, including queued songs?')) return;
  await api('/api/dj/clear', { method: 'POST', body: { scope: 'all' } });
  toast('All requests removed');
};
$('logout').onclick = async () => {
  await api('/api/dj/logout', { method: 'POST' });
  location.reload();
};

// ------------------------------------------------------------- share

function refreshQr() { $('qr').src = `/api/dj/qr.svg?t=${Date.now()}`; }

$('guestUrl').addEventListener('input', () => { $('saveUrl').hidden = false; });
$('saveUrl').onclick = async () => {
  if (await patch({ publicUrl: $('guestUrl').value.trim() })) {
    $('saveUrl').hidden = true;
    $('guestUrl').blur();
    setTimeout(refreshQr, 120);
    toast('Guest link updated');
  }
};
$('copyUrl').onclick = async () => {
  try { await navigator.clipboard.writeText($('guestUrl').value); toast('Link copied'); }
  catch { $('guestUrl').select(); }
};
$('printQr').onclick = () => {
  const area = $('printArea');
  const card = $('qrCard').cloneNode(true);
  card.removeAttribute('id');
  card.style.boxShadow = 'none';
  card.style.maxWidth = '520px';
  area.replaceChildren(card);
  window.print();
};
