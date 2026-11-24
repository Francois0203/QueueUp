import { icons, h, api, toast, connect, renderList, setArt, subline, roomCode, rollTo, enableRipples, haptic } from './shared.js';

const $ = id => document.getElementById(id);
const CODE = roomCode();
const BASE = `/api/r/${CODE}`;
const KEY_STORE = 'qu_spotify_client_id';
let S = null;
let editing = false;      // don't clobber inputs while the DJ is typing
let seenPending = null;   // request ids already shown, to spot new arrivals
let unseen = 0;           // new requests while the DJ is on another tab

for (const id of ['logo', 'loginLogo']) $(id).innerHTML = icons.logo;
$('pendingIcon').innerHTML = icons.note;
$('wizIcon0').innerHTML = icons.key;
$('extIcon').innerHTML = icons.external;
document.querySelectorAll('[data-i]').forEach(el => { el.innerHTML = icons[el.dataset.i]; el.style.display = 'inline-flex'; });
document.querySelectorAll('[data-close]').forEach(b => { b.innerHTML = icons.x; b.onclick = closeSheets; });
enableRipples();

// ------------------------------------------------------------- auth

async function boot(attempt = 0) {
  try {
    const { dj, partyName } = await api(`${BASE}/dj/me`);
    if (dj) return start();
    $('loginTitle').textContent = partyName;
    showLogin();
  } catch (e) {
    if (e.status === 404) return location.replace('/'); // party doesn't exist (anymore)
    // Flaky venue Wi-Fi: keep trying instead of throwing the DJ out.
    if (attempt === 0) toast('Connecting…', { ms: 1800 });
    setTimeout(() => boot(attempt + 1), Math.min(1000 * 2 ** attempt, 10000));
  }
}
boot();

function showLogin() {
  $('login').hidden = false;
  $('app').hidden = true;
  setTimeout(() => $('pin').focus(), 100);
}

$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.submitter; btn?.classList.add('loading');
  try {
    await api(`${BASE}/dj/login`, { method: 'POST', body: { pin: $('pin').value.trim() } });
    $('login').hidden = true;
    start();
  } catch (err) {
    const card = $('loginForm');
    card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
    haptic([20, 40, 20]);
    $('pin').value = '';
    toast(err.message, { error: true });
  } finally { btn?.classList.remove('loading'); }
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
      error: 'Spotify login failed. Check the Client ID and that the Redirect URI matches exactly.',
      signin: 'Finish connecting Spotify in a browser where you’re signed in as this party’s DJ.',
    }[msg];
    if (text) toast(text, { error: msg !== 'connected', ms: msg === 'connected' ? 2600 : 6000 });
    if (msg === 'connected') haptic([10, 40, 16]);
    if (msg === 'error') openSpotifySetup(2);
  }
  if (params.has('welcome')) {
    $('welcomePin').replaceChildren(...[...S.pin].map((d, i) => h('span', { style: `animation-delay:${0.15 + i * 0.06}s` }, d)));
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
$('welcomeSpotify').onclick = () => openSpotifySetup();
$('chipSpotify').onclick = () => { if (!S?.spotify.connected) openSpotifySetup(); else selectTab('settings'); };

// ------------------------------------------------------------- tabs

const tabs = [...document.querySelectorAll('#tabs button')];
tabs.forEach(b => b.addEventListener('click', () => selectTab(b.dataset.tab)));
function selectTab(name) {
  tabs.forEach(t => t.classList.toggle('on', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('on', p.id === `panel-${name}`));
  moveThumb();
  if (name === 'share') $('qr').src = `${BASE}/dj/qr.svg`;
  if (name === 'requests') { unseen = 0; renderBadge(); }
}
function currentTab() { return tabs.find(t => t.classList.contains('on'))?.dataset.tab; }
function moveThumb() {
  const on = tabs.find(t => t.classList.contains('on'));
  const thumb = $('segThumb');
  thumb.style.width = `${on.offsetWidth}px`;
  thumb.style.transform = `translateX(${on.offsetLeft - 4}px)`;
}
addEventListener('resize', moveThumb);
function renderBadge() {
  $('newBadge').replaceChildren(unseen ? h('span', { class: 'badge' }, unseen) : '');
}

// ------------------------------------------------------------- render

function render() {
  const s = S.settings;
  document.title = `${s.partyName} · DJ · QueueUp`;
  $('partyName').textContent = s.partyName;
  $('qrTitle').textContent = s.partyName;
  const g = $('chipGuests').lastChild;
  if (!g.querySelector?.('.n')) g.replaceChildren(h('span', { class: 'n' }), h('span', { class: 'l' }));
  rollTo(g.querySelector('.n'), S.listeners);
  g.querySelector('.l').textContent = S.listeners === 1 ? ' guest' : ' guests';
  $('chipGuests').classList.toggle('ok', S.listeners > 0);
  $('chipSpotify').classList.toggle('ok', S.spotify.connected);
  $('chipSpotify').lastChild.textContent = S.spotify.connected ? 'Spotify' : 'Connect Spotify';

  const np = S.nowPlaying;
  $('aura').classList.toggle('playing', Boolean(np?.isPlaying));
  setArt($('npArt'), np?.track);
  $('npLabel').textContent = np ? (np.isPlaying ? 'Now playing' : 'Paused') : 'Now playing';
  $('npTitle').textContent = np ? np.track.title : 'Nothing playing';
  $('npArtist').textContent = np ? np.track.artist : (S.spotify.connected ? 'Start playback in Spotify' : 'Set it manually, or connect Spotify');
  $('npEdit').hidden = S.spotify.connected;

  const by = st => S.requests.filter(r => r.status === st);
  const queued = by('queued'), pending = by('pending');
  const played = by('played').sort((a, b) => b.playedAt - a.playedAt).slice(0, 15);

  // New-request detection: highlight new rows, count them when the DJ is elsewhere.
  const ids = new Set(pending.map(r => r.id));
  const fresh = seenPending ? pending.filter(r => !seenPending.has(r.id)).map(r => r.id) : [];
  seenPending = ids;
  if (fresh.length) {
    haptic(8);
    if (currentTab() !== 'requests') { unseen += fresh.length; renderBadge(); }
  }

  $('queuedWrap').hidden = !queued.length;
  rollTo($('queuedCount'), queued.length || '');
  renderList($('queued'), queued, r => r.id, buildRow, updateRow);

  rollTo($('pendingCount'), pending.length || '');
  $('pendingEmpty').hidden = pending.length > 0;
  renderList($('pending'), pending, r => r.id, r => { const el = buildRow(r); if (fresh.includes(r.id)) el.classList.add('fresh'); return el; }, updateRow);

  $('playedWrap').hidden = !played.length;
  rollTo($('playedCount'), played.length || '');
  renderList($('played'), played, r => r.id, buildRow, updateRow);

  $('guestUrl').value = S.guestUrl;
  $('openGuest').href = S.guestUrl;
  $('codeText').textContent = S.code;
  $('blockedRow').hidden = !S.blockedCount;
  $('blockedText').textContent = `${S.blockedCount} guest${S.blockedCount === 1 ? '' : 's'} can't request or vote`;

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

  const sig = `${r.status}|${S.spotify.connected}`;
  const actions = el.querySelector('.actions');
  if (actions.dataset.sig !== sig) {
    actions.dataset.sig = sig;
    const btn = (label, icon, cls, action, title) =>
      h('button', { class: `btn btn-sm ${cls}`, title: title || label, 'aria-label': title || label, onclick: e => act(r.id, action, e.currentTarget) },
        icon ? h('span', { html: icon, style: 'display:inline-flex' }) : null, h('span', { class: 'lbl' }, label));
    const iconBtn = (icon, title, action) => h('button', { class: 'btn btn-icon btn-ghost', title, 'aria-label': title, html: icon, onclick: e => act(r.id, action, e.currentTarget) });
    const toSpotify = S.spotify.connected && r.track.uri;

    if (r.status === 'pending') {
      actions.replaceChildren(
        h('div', { class: 'votes-count' }, h('span', { class: 'n' }), h('small', {})),
        iconBtn(icons.block, 'Block this guest', 'block'),
        iconBtn(icons.x, 'Dismiss', 'dismiss'),
        btn('Queue', icons.queue, 'btn-primary', 'queue', toSpotify ? 'Add to your Spotify queue' : 'Mark as queued'));
    } else if (r.status === 'queued') {
      actions.replaceChildren(
        toSpotify ? h('span', { class: 'tag' }, 'In Spotify queue') : btn('Playing', icons.play, '', 'playing', 'Mark as now playing'),
        iconBtn(icons.undo, 'Back to requests', 'restore'));
    } else {
      actions.replaceChildren(h('span', { class: 'tag', style: 'color:var(--faint)' }, 'Played'));
    }
  }
  const vc = actions.querySelector('.votes-count');
  if (vc) {
    rollTo(vc.querySelector('.n'), r.votes);
    vc.querySelector('small').textContent = r.votes === 1 ? 'VOTE' : 'VOTES';
  }
}

async function act(id, action, button) {
  if (action === 'block' && !confirm('Block this guest? Their open requests are removed and they can’t request or vote at this party anymore.')) return;
  button?.classList.add('loading');
  try {
    await api(`${BASE}/dj/requests/${id}/${action}`, { method: 'POST' });
    if (action === 'queue') { toast(S.spotify.connected ? 'Added to Spotify queue' : 'Queued'); haptic([8, 30, 12]); }
    if (action === 'block') toast('Guest blocked');
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
      ? h('button', { class: 'btn btn-sm btn-primary', onclick: () => openSpotifySetup() }, 'Connect')
      : h('button', { class: 'btn btn-sm', onclick: disconnectSpotify }, 'Disconnect'));
  }
}

async function patch(body) {
  try { await api(`${BASE}/dj/settings`, { method: 'PATCH', body }); return true; }
  catch (e) { toast(e.message, { error: true }); return false; }
}

for (const [id, key] of Object.entries(toggles)) $(id).addEventListener('change', e => { haptic(5); patch({ [key]: e.target.checked }); });

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
    rollTo(out, v);
    haptic(4);
    patch({ [st.dataset.key]: v });
  });
});

$('showPin').onclick = e => {
  const b = e.currentTarget;
  b.textContent = b.textContent === 'Show' ? S.pin : 'Show';
};
$('unblockAll').onclick = async () => {
  await api(`${BASE}/dj/unblock-all`, { method: 'POST' }).catch(e => toast(e.message, { error: true }));
  toast('Everyone unblocked');
};

// ------------------------------------------------------------- Spotify setup wizard

const getSavedKey = () => { try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; } };
const extractId = text => (String(text).match(/[a-f0-9]{32}/i) || [''])[0].toLowerCase();
let step = 0;

function goStep(n) {
  const back = n < step;
  step = n;
  document.querySelectorAll('.wiz-step').forEach(s => {
    const on = Number(s.dataset.step) === n;
    s.classList.toggle('on', on);
    s.classList.toggle('back', on && back);
  });
  $('wizBar').style.width = `${((n + 1) / 3) * 100}%`;
  $('spotifySheet').querySelector('.sheet-body').scrollTop = 0;
  if (n === 2) setTimeout(() => $('clientId').focus(), 350);
}
document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => goStep(Number(b.dataset.go))));

function openSpotifySetup(startAt = 0) {
  $('redirectUri').textContent = S.spotify.redirectUri;
  const saved = getSavedKey();
  if (!$('clientId').value) { $('clientId').value = S.spotify.clientId || saved || ''; validateId(); }
  // Returning DJ: one tap, no setup.
  $('savedKey').replaceChildren(saved ? h('div', { class: 'saved-key' },
    h('div', { class: 'wiz-icon', style: 'margin:0;width:44px;height:44px;border-radius:14px', html: icons.key }),
    h('div', { class: 'meta' }, h('div', { class: 'title' }, 'Your saved Spotify key'), h('small', {}, `···· ${saved.slice(-4)} · on this device`)),
    h('button', { class: 'btn btn-sm btn-primary', onclick: e => startLogin(saved, e.currentTarget) }, 'Connect')) : '');
  const loopback = S.spotify.redirectUri.startsWith('http://127.0.0.1');
  $('loopbackNote').hidden = !(loopback && location.hostname !== '127.0.0.1');
  goStep(startAt);
  openSheet('spotifySheet');
}

function validateId() {
  const input = $('clientId');
  const id = extractId(input.value);
  const wrap = input.parentElement;
  wrap.querySelector('.ok-mark')?.remove();
  input.classList.toggle('valid', Boolean(id));
  $('connectBtn').disabled = !id;
  $('pasteBtn').hidden = Boolean(id);
  if (id) wrap.append(h('span', { class: 'ok-mark', html: icons.check }));
  $('idHint').textContent = id
    ? (input.value.trim().toLowerCase() === id ? 'Looks good.' : `Found it: ${id.slice(0, 6)}…${id.slice(-4)}`)
    : (input.value.trim() ? 'That doesn’t contain a Client ID yet. It’s 32 letters and numbers.' : 'It’s 32 letters and numbers. You don’t need the client secret.');
  return id;
}
$('clientId').addEventListener('input', validateId);
$('pasteBtn').onclick = async () => {
  try {
    $('clientId').value = await navigator.clipboard.readText();
    if (validateId()) haptic([6, 30, 10]);
  } catch {
    $('clientId').focus();
    toast('Long-press the box and choose Paste', { ms: 3000 });
  }
};

async function startLogin(clientId, btn) {
  btn?.classList.add('loading');
  try {
    const { url } = await api(`${BASE}/dj/spotify/start`, { method: 'POST', body: { clientId } });
    location.href = url;
  } catch (err) {
    toast(err.message, { error: true, ms: 4000 });
    btn?.classList.remove('loading');
  }
}

$('spotifyForm').addEventListener('submit', e => {
  e.preventDefault();
  const id = validateId();
  if (!id) return;
  try {
    if ($('rememberKey').checked) localStorage.setItem(KEY_STORE, id);
    else localStorage.removeItem(KEY_STORE);
  } catch {}
  startLogin(id, e.submitter);
});

async function copy(text, msg, btn) {
  try {
    await navigator.clipboard.writeText(text);
    haptic(6);
    if (btn) {
      const old = btn.textContent;
      btn.classList.add('copied'); btn.textContent = 'Copied';
      setTimeout(() => { btn.classList.remove('copied'); btn.textContent = old; }, 1400);
    } else toast(msg);
  } catch { toast('Copy failed — select and copy manually', { error: true }); }
}
$('copyRedirect').onclick = e => copy(S.spotify.redirectUri, 'Redirect URI copied', e.currentTarget);
document.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => copy(b.dataset.copy, 'Copied', b)));

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
  if (!confirm('End this party for everyone? This deletes all its data and can’t be undone.')) return;
  await api(`${BASE}/dj/end`, { method: 'POST' }).catch(e => toast(e.message, { error: true }));
  location.replace('/');
};

// ------------------------------------------------------------- share

$('copyUrl').onclick = e => copy($('guestUrl').value, 'Link copied', e.currentTarget);
$('printQr').onclick = () => {
  const card = $('qrCard').cloneNode(true);
  card.removeAttribute('id');
  card.style.boxShadow = 'none';
  card.style.maxWidth = '520px';
  $('printArea').replaceChildren(card);
  window.print();
};
