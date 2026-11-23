import { icons, h, api, toast, connect, renderList, artEl, setArt, fmtTime, subline, progressOf } from './shared.js';

const $ = id => document.getElementById(id);
let S = null;            // latest server state
let clockOffset = 0;
let heroTrackId = null;
const pendingVotes = new Map(); // request id -> optimistic voted state

$('logo').innerHTML = icons.logo;
$('sheetClose').innerHTML = icons.x;
$('searchIcon').innerHTML = icons.search;
$('fabIcon').innerHTML = icons.plus;
$('fabIcon').style.display = 'inline-flex';

// ------------------------------------------------------------- realtime

connect(state => {
  S = state;
  clockOffset = state.serverTime - Date.now();
  render();
}, online => {
  $('live').classList.toggle('offline', !online);
  if (!online) $('liveText').textContent = 'Reconnecting';
});

function render() {
  const s = S.settings;
  document.title = `${s.partyName} · QueueUp`;
  $('partyName').textContent = s.partyName;
  $('liveText').textContent = S.listeners > 1 ? `${S.listeners} here` : 'Live';

  renderHero();

  const queued = S.requests.filter(r => r.status === 'queued');
  const pending = S.requests.filter(r => r.status === 'pending');

  $('upNextWrap').hidden = queued.length === 0;
  renderList($('upNext'), queued, r => r.id, buildQueuedRow, updateQueuedRow);

  renderList($('requests'), pending, r => r.id, buildRequestRow, updateRequestRow);
  $('empty').hidden = pending.length > 0;
  $('reqCount').textContent = pending.length ? pending.length : '';

  const fab = $('fab');
  fab.classList.toggle('closed', !s.requestsOpen);
  $('fabText').textContent = s.requestsOpen ? 'Request a song' : 'Requests are paused';
  $('fabIcon').style.display = s.requestsOpen ? 'inline-flex' : 'none';

  const manual = !S.spotify.connected;
  $('searchMode').hidden = manual;
  $('results').hidden = manual;
  $('resultsEmpty').hidden = manual || $('results').children.length > 0;
  $('manualForm').hidden = !manual;
}

// ------------------------------------------------------------- now playing

function renderHero() {
  const np = S.nowPlaying;
  const hero = $('hero');
  const id = np?.track?.id || null;
  hero.classList.toggle('hero-empty', !np);
  hero.classList.toggle('paused', Boolean(np && !np.isPlaying));

  if (id !== heroTrackId) {
    heroTrackId = id;
    const art = $('heroArt');
    if (np?.track.art) {
      const img = h('img', { src: np.track.art, alt: '' });
      img.style.opacity = '0';
      img.onload = () => { img.style.opacity = '1'; };
      art.replaceChildren(img);
    } else {
      art.replaceChildren(h('div', { class: 'placeholder', html: icons.note }));
    }
    const amb = $('ambient');
    if (np?.track.art) { amb.querySelector('img').src = np.track.art; amb.classList.add('on'); }
    else amb.classList.remove('on');

    $('heroTitle').textContent = np ? np.track.title : 'Waiting for the next track';
    $('heroArtist').textContent = np ? (np.track.artist || '') : "The DJ hasn't started yet";
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
  el.querySelector('.sub').replaceChildren(...subline(r.track, r.by ? `for ${r.by}` : ''));
}

function buildRequestRow(r) {
  const btn = h('button', { class: 'vote', 'aria-label': 'Vote', onclick: () => vote(r.id, btn) },
    h('span', { html: icons.up }), h('span', { class: 'n' }));
  return h('li', { class: 'row' },
    artEl(r.track),
    h('div', { class: 'meta' }, h('div', { class: 'title' }), h('div', { class: 'sub' })),
    btn);
}
function updateRequestRow(el, r) {
  const voted = pendingVotes.has(r.id) ? pendingVotes.get(r.id) : r.voted;
  const count = r.votes + (pendingVotes.has(r.id) ? (voted ? 1 : 0) - (r.voted ? 1 : 0) : 0);
  setArt(el.querySelector('.art'), r.track);
  el.classList.toggle('mine', r.mine);
  el.querySelector('.title').textContent = r.track.title;
  const extra = r.mine ? 'your pick' : (r.by ? `from ${r.by}` : '');
  el.querySelector('.sub').replaceChildren(...subline(r.track, extra));
  const btn = el.querySelector('.vote');
  btn.classList.toggle('on', voted);
  btn.disabled = !S.settings.votingOpen;
  btn.setAttribute('aria-pressed', String(voted));
  btn.setAttribute('aria-label', `${voted ? 'Remove vote' : 'Vote'} (${count} votes)`);
  btn.querySelector('.n').textContent = count;
}

async function vote(id, btn) {
  const r = S.requests.find(x => x.id === id);
  if (!r) return;
  const current = pendingVotes.has(id) ? pendingVotes.get(id) : r.voted;
  pendingVotes.set(id, !current);
  btn.classList.remove('bump'); void btn.offsetWidth; btn.classList.add('bump');
  if (navigator.vibrate) navigator.vibrate(8);
  render();
  try {
    await api(`/api/requests/${id}/vote`, { method: 'POST' });
  } catch (e) {
    pendingVotes.delete(id);
    render();
    toast(e.message, { error: true });
  } finally {
    pendingVotes.delete(id);
  }
}

// ------------------------------------------------------------- request sheet

const nameInput = $('guestName');
try { nameInput.value = localStorage.getItem('qu_name') || ''; } catch {}
nameInput.addEventListener('input', () => { try { localStorage.setItem('qu_name', nameInput.value.trim()); } catch {} });

function openSheet() {
  if (!S?.settings.requestsOpen) return toast('The DJ has paused requests for now.');
  $('sheet').classList.add('open');
  $('scrim').classList.add('open');
  $('sheet').setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  setTimeout(() => (S.spotify.connected ? $('q') : $('mTitle')).focus({ preventScroll: true }), 350);
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
  searchTimer = setTimeout(runSearch, 260);
});

async function runSearch() {
  const q = $('q').value.trim();
  const seq = ++searchSeq;
  const list = $('results');
  if (!q) { list.replaceChildren(); $('resultsEmpty').hidden = false; return; }
  $('resultsEmpty').hidden = true;
  if (!list.children.length) list.replaceChildren(h('div', { class: 'spinner' }));
  try {
    const { results } = await api(`/api/search?q=${encodeURIComponent(q)}`);
    if (seq !== searchSeq) return;
    if (!results.length) {
      list.replaceChildren(h('div', { class: 'empty' }, h('strong', {}, 'No matches'), 'Try a different spelling.'));
      return;
    }
    const taken = new Map(S.requests.map(r => [r.track.id, r.status]));
    list.replaceChildren(...results.map((t, i) => {
      const status = taken.get(t.id);
      const extra = status === 'queued' ? 'already queued' : status === 'pending' ? 'requested · tap to vote' : '';
      const li = h('li', { class: 'row result enter', style: `animation-delay:${i * 25}ms` },
        artEl(t),
        h('div', { class: 'meta' }, h('div', { class: 'title' }, t.title), h('div', { class: 'sub' }, ...subline(t, extra))),
        h('span', { class: 'add', html: icons.plus }));
      li.onclick = () => submit({ track: t }, li);
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
  try {
    const res = await api('/api/requests', { method: 'POST', body: { ...payload, name: nameInput.value } });
    if (row) { row.classList.add('done'); row.querySelector('.add').innerHTML = icons.check; }
    if (navigator.vibrate) navigator.vibrate([10, 40, 10]);
    toast(res.merged ? (res.status === 'queued' ? 'Already queued — good taste' : 'Already requested — added your vote') : 'Request sent');
    setTimeout(closeSheet, row ? 550 : 200);
    return true;
  } catch (e) {
    toast(e.message, { error: true });
    return false;
  } finally {
    button?.classList.remove('loading');
  }
}
