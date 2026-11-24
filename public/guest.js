import {
  icons, h, api, toast, connect, renderList, artEl, setArt, fmtTime, subline, progressOf, roomCode,
  rollTo, burst, haptic, enableRipples, spotifyUrl, spotifyLogo,
} from './shared.js';

const $ = id => document.getElementById(id);
const BASE = `/api/r/${roomCode()}`;
let S = null;            // latest server state
let clockOffset = 0;
let heroTrackId;         // undefined until first render, so the empty state draws too
let freshId = null;      // request this guest just made, highlighted when it appears
const pendingVotes = new Map(); // request id -> optimistic voted state

$('logo').innerHTML = icons.logo;
$('sheetClose').innerHTML = icons.x;
$('searchIcon').innerHTML = icons.search;
$('fabIcon').innerHTML = icons.plus;
$('emptyIcon').innerHTML = icons.note;
$('searchAttr').append(spotifyLogo());
enableRipples();

// ------------------------------------------------------------- realtime

connect(BASE, state => {
  S = state;
  clockOffset = state.serverTime - Date.now();
  render();
}, online => {
  $('live').classList.toggle('offline', !online);
  if (!online) $('liveText').textContent = 'Reconnecting';
}, () => {
  closeSheet();
  document.querySelector('main').hidden = true;
  document.querySelector('.fab-wrap').hidden = true;
  $('aura').classList.remove('playing');
  $('endedLogo').innerHTML = icons.logo;
  $('ended').hidden = false;
});

function render() {
  const s = S.settings;
  document.title = `${s.partyName} · QueueUp`;
  $('partyName').textContent = s.partyName;
  const live = $('liveText');
  if (S.listeners > 1) {
    if (!live.querySelector('.n')) live.replaceChildren(h('span', { class: 'n' }), ' here');
    rollTo(live.querySelector('.n'), S.listeners);
  } else live.textContent = 'Live';

  renderHero();

  const queued = S.requests.filter(r => r.status === 'queued');
  const pending = S.requests.filter(r => r.status === 'pending');

  $('upNextWrap').hidden = queued.length === 0;
  renderList($('upNext'), queued, r => r.id, buildQueuedRow, updateQueuedRow);

  renderList($('requests'), pending, r => r.id, buildRequestRow, updateRequestRow);
  $('empty').hidden = pending.length > 0;
  rollTo($('reqCount'), pending.length || '');

  const fab = $('fab');
  fab.classList.toggle('closed', !s.requestsOpen);
  $('fabText').textContent = s.requestsOpen ? 'Request a song' : 'Requests are paused';
  $('fabIcon').style.display = s.requestsOpen ? 'inline-flex' : 'none';

  const manual = !S.spotify.connected;
  $('searchMode').hidden = manual;
  $('results').hidden = manual;
  $('resultsEmpty').hidden = manual || $('results').children.length > 0;
  $('searchAttr').hidden = manual;
  $('manualForm').hidden = !manual;
}

// ------------------------------------------------------------- now playing

function renderHero() {
  const np = S.nowPlaying;
  const hero = $('hero');
  const id = np?.track?.id || null;
  hero.classList.toggle('hero-empty', !np);
  hero.classList.toggle('paused', Boolean(np && !np.isPlaying));
  hero.classList.toggle('playing', Boolean(np?.isPlaying));
  $('aura').classList.toggle('playing', Boolean(np?.isPlaying));

  if (id !== heroTrackId) {
    const first = heroTrackId === undefined;
    heroTrackId = id;
    const art = $('heroArt');
    const link = spotifyUrl(np?.track);
    // Artwork is shown exactly as Spotify provides it, linked back to Spotify.
    const inner = np?.track.art ? h('img', { src: np.track.art, alt: `${np.track.title} artwork` }) : h('div', { class: 'placeholder', html: icons.note });
    art.replaceChildren(link ? h('a', { href: link, target: '_blank', rel: 'noopener', 'aria-label': 'Open in Spotify', style: 'display:block;width:100%;height:100%' }, inner) : inner);
    if (!first) { art.classList.remove('swap'); void art.offsetWidth; art.classList.add('swap'); }

    $('heroTitle').textContent = np ? np.track.title : 'Waiting for the next track';
    $('heroArtist').textContent = np ? (np.track.artist || '') : "The DJ hasn't started yet";
    $('heroLink').replaceChildren(link
      ? h('a', { class: 'spotify-link', href: link, target: '_blank', rel: 'noopener' }, spotifyLogo(), h('span', {}, 'Open in Spotify'))
      : '');
    const t = $('heroText');
    t.classList.remove('fade-swap'); void t.offsetWidth; t.classList.add('fade-swap');
  }
  $('heroLabel').textContent = np && !np.isPlaying ? 'Paused' : 'Now playing';
  $('progress').hidden = !(np && np.track.durationMs);
  tick();
}

function tick() {
  const np = S?.nowPlaying;
  if (!np || !np.track.durationMs) return;
  const p = progressOf(np, clockOffset);
  $('progressFill').style.width = `${(p / np.track.durationMs) * 100}%`;
  $('tNow').textContent = fmtTime(p);
  $('tTotal').textContent = fmtTime(np.track.durationMs);
}
setInterval(tick, 1000);

// ------------------------------------------------------------- rows

function buildQueuedRow(r) {
  return h('li', { class: 'row queued' },
    artEl(r.track),
    h('div', { class: 'meta' }, h('div', { class: 'title' }), h('div', { class: 'sub' })),
    h('span', { class: 'tag' }, 'Queued'));
}
function updateQueuedRow(el, r) {
  setArt(el.querySelector('.art'), r.track);
  el.querySelector('.title').textContent = r.track.title;
  el.querySelector('.sub').replaceChildren(...subline(r.track, r.mine ? 'your pick' : r.by ? `for ${r.by}` : ''));
}

function buildRequestRow(r) {
  const btn = h('button', { class: 'vote', 'aria-label': 'Vote', onclick: () => vote(r.id, btn) },
    h('span', { html: icons.up }), h('span', { class: 'n' }));
  const li = h('li', { class: 'row' + (r.id === freshId ? ' fresh' : '') },
    artEl(r.track),
    h('div', { class: 'meta' }, h('div', { class: 'title' }), h('div', { class: 'sub' })),
    h('button', { class: 'withdraw', title: 'Withdraw request', 'aria-label': 'Withdraw your request', html: icons.x, onclick: () => withdraw(r.id, li) }),
    btn);
  if (r.id === freshId) freshId = null;
  return li;
}
function updateRequestRow(el, r) {
  const voted = pendingVotes.has(r.id) ? pendingVotes.get(r.id) : r.voted;
  const count = r.votes + (pendingVotes.has(r.id) ? (voted ? 1 : 0) - (r.voted ? 1 : 0) : 0);
  setArt(el.querySelector('.art'), r.track);
  el.classList.toggle('mine', r.mine);
  el.querySelector('.withdraw').hidden = !r.mine;
  el.querySelector('.title').textContent = r.track.title;
  const extra = r.mine ? 'your pick' : (r.by ? `from ${r.by}` : '');
  el.querySelector('.sub').replaceChildren(...subline(r.track, extra));
  const btn = el.querySelector('.vote');
  btn.classList.toggle('on', voted);
  btn.disabled = !S.settings.votingOpen;
  btn.setAttribute('aria-pressed', String(voted));
  btn.setAttribute('aria-label', `${voted ? 'Remove vote' : 'Vote'} (${count} votes)`);
  rollTo(btn.querySelector('.n'), count);
}

async function vote(id, btn) {
  const r = S.requests.find(x => x.id === id);
  if (!r) return;
  const current = pendingVotes.has(id) ? pendingVotes.get(id) : r.voted;
  pendingVotes.set(id, !current);
  btn.classList.remove('bump'); void btn.offsetWidth; btn.classList.add('bump');
  if (!current) { burst(btn); haptic([6, 30, 10]); } else haptic(6);
  render();
  try {
    await api(`${BASE}/requests/${id}/vote`, { method: 'POST' });
  } catch (e) {
    pendingVotes.delete(id);
    render();
    toast(e.message, { error: true });
  } finally {
    pendingVotes.delete(id);
  }
}

async function withdraw(id, li) {
  li.style.opacity = '.5';
  try {
    await api(`${BASE}/requests/${id}`, { method: 'DELETE' });
    toast('Request withdrawn');
  } catch (e) {
    li.style.opacity = '';
    toast(e.message, { error: true });
  }
}

// ------------------------------------------------------------- request sheet

const nameInput = $('guestName');
try { nameInput.value = localStorage.getItem('qu_name') || ''; } catch {}
nameInput.addEventListener('input', () => { try { localStorage.setItem('qu_name', nameInput.value.trim()); } catch {} });

function openSheet() {
  if (!S?.settings.requestsOpen) return toast('The DJ has paused requests for now.', { error: true });
  $('sheet').querySelector('.success')?.remove();
  $('sheet').classList.add('open');
  $('scrim').classList.add('open');
  $('sheet').setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  haptic(5);
  setTimeout(() => (S.spotify.connected ? $('q') : $('mTitle')).focus({ preventScroll: true }), 380);
}
function closeSheet() {
  $('sheet').classList.remove('open');
  $('scrim').classList.remove('open');
  $('sheet').setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  document.activeElement?.blur();
}
$('fab').onclick = openSheet;
$('scrim').onclick = closeSheet;
$('sheetClose').onclick = closeSheet;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

// swipe-down to close
(() => {
  const sheet = $('sheet');
  let startY = null, dy = 0;
  sheet.addEventListener('touchstart', e => {
    if ($('sheetBody').scrollTop > 0 && e.target.closest('.sheet-body')) return;
    startY = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  sheet.addEventListener('touchmove', e => {
    if (startY == null) return;
    dy = Math.max(0, e.touches[0].clientY - startY);
    if (dy > 0) { sheet.style.transition = 'none'; sheet.style.transform = `translateY(${dy}px)`; }
  }, { passive: true });
  sheet.addEventListener('touchend', () => {
    if (startY == null) return;
    sheet.style.transition = ''; sheet.style.transform = '';
    if (dy > 110) closeSheet();
    startY = null;
  });
})();

// search
let searchSeq = 0, searchTimer;
$('q').addEventListener('input', () => {
  clearTimeout(searchTimer);
  if ($('q').value.trim()) showSkeleton();
  searchTimer = setTimeout(runSearch, 260);
});

function showSkeleton() {
  const list = $('results');
  if (list.querySelector('.result')) return; // keep old results while typing
  $('resultsEmpty').hidden = true;
  list.replaceChildren(...[0, 1, 2, 3, 4].map(i => h('li', { class: 'row skeleton', style: `opacity:${1 - i * 0.16}` },
    h('div', { class: 'art' }),
    h('div', { class: 'meta' }, h('div', { class: 'sk-line', style: `width:${60 - i * 5}%` }), h('div', { class: 'sk-line', style: `width:${36 + i * 4}%` })))));
}

async function runSearch() {
  const q = $('q').value.trim();
  const seq = ++searchSeq;
  const list = $('results');
  if (!q) { list.replaceChildren(); $('resultsEmpty').hidden = false; return; }
  $('resultsEmpty').hidden = true;
  try {
    const { results } = await api(`${BASE}/search?q=${encodeURIComponent(q)}`);
    if (seq !== searchSeq) return;
    if (!results.length) {
      list.replaceChildren(h('div', { class: 'empty' }, h('strong', {}, 'No matches'), 'Try a different spelling.'));
      return;
    }
    const taken = new Map(S.requests.map(r => [r.track.id, r.status]));
    list.replaceChildren(...results.map((t, i) => {
      const status = taken.get(t.id);
      const extra = status === 'queued' ? 'already queued' : status === 'pending' ? 'requested · tap to vote' : '';
      const li = h('li', { class: 'row result enter', style: `animation-delay:${i * 30}ms` },
        artEl(t),
        h('div', { class: 'meta' }, h('div', { class: 'title' }, t.title), h('div', { class: 'sub' }, ...subline(t, extra))),
        h('span', { class: 'add', html: icons.plus }));
      li.onclick = () => submit({ trackId: t.id }, li);
      return li;
    }));
  } catch (e) {
    if (seq === searchSeq) list.replaceChildren(h('div', { class: 'empty' }, h('strong', {}, 'Search unavailable'), e.message));
  }
}

$('manualForm').addEventListener('submit', async e => {
  e.preventDefault();
  const ok = await submit({ title: $('mTitle').value, artist: $('mArtist').value }, null, e.submitter);
  if (ok) { $('mTitle').value = ''; $('mArtist').value = ''; }
});

async function submit(payload, row, button) {
  button?.classList.add('loading');
  if (row) row.classList.add('done');
  try {
    const res = await api(`${BASE}/requests`, { method: 'POST', body: { ...payload, name: nameInput.value } });
    if (row) row.querySelector('.add').innerHTML = icons.check;
    haptic([10, 40, 16]);
    freshId = res.id || null;
    celebrate(res.merged ? (res.status === 'queued' ? 'Already queued' : 'Vote added') : 'Request sent',
      res.merged ? (res.status === 'queued' ? 'Good taste — it’s coming up.' : 'Someone beat you to it. Your vote counts.') : 'Get the room to vote for it.');
    return true;
  } catch (e) {
    row?.classList.remove('done');
    toast(e.message, { error: true });
    return false;
  } finally {
    button?.classList.remove('loading');
  }
}

/** Full-sheet success moment, then close. */
function celebrate(title, text) {
  const sheet = $('sheet');
  sheet.querySelector('.success')?.remove();
  const s = h('div', { class: 'success' },
    h('span', { class: 'check-wrap', html: '<svg class="check-anim" viewBox="0 0 84 84"><circle cx="42" cy="42" r="40"/><path d="M27 43l10 10 20-21"/></svg>' }),
    h('b', {}, title), h('span', { class: 'success-text' }, text));
  sheet.append(s);
  burst(s.firstChild, 16);
  setTimeout(() => {
    closeSheet();
    $('q').value = '';
    $('results').replaceChildren();
    setTimeout(() => s.remove(), 600);
  }, 1400);
}
