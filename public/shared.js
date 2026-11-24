// Shared client helpers for guest and DJ views.

export const icons = {
  logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  queue: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 6h12M4 12h12M4 18h7M19 15v6M16 18h6"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
  block: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>',
  external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/></svg>',
};

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v; // only ever used with our static icon strings
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw Object.assign(new Error('You seem to be offline. Check your connection.'), { status: 0 });
  }
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

let toastHost;
export function toast(msg, { error = false, ms = 2600 } = {}) {
  if (!toastHost) { toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(toastHost); }
  const t = h('div', { class: 'toast' + (error ? ' error' : '') }, h('span', { html: error ? icons.alert : icons.check, style: 'display:inline-flex' }), h('span', {}, msg));
  toastHost.append(t);
  while (toastHost.children.length > 3) toastHost.firstChild.remove();
  setTimeout(() => { t.classList.add('out'); t.addEventListener('animationend', () => t.remove(), { once: true }); }, ms);
}

export const haptic = pattern => { try { navigator.vibrate?.(pattern); } catch {} };
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Animated number change: the old value rolls out, the new one rolls in. */
export function rollTo(el, value) {
  const next = String(value);
  const prev = el.dataset.v;
  if (prev === next) return;
  el.dataset.v = next;
  if (prev == null || reducedMotion()) { el.textContent = next; return; }
  el.classList.add('roll');
  el.classList.toggle('down', Number(next) < Number(prev));
  const out = h('span', { class: 'r-out', 'aria-hidden': 'true' }, prev);
  const inn = h('span', { class: 'r-in' }, next);
  el.replaceChildren(out, inn);
  inn.addEventListener('animationend', () => { if (el.dataset.v === next) el.replaceChildren(next); }, { once: true });
}

/** Little particle explosion from the centre of an element. */
export function burst(el, n = 10) {
  if (reducedMotion()) return;
  const b = h('span', { class: 'burst', 'aria-hidden': 'true' });
  for (let i = 0; i < n; i++) {
    const p = h('i');
    p.style.setProperty('--a', `${(360 / n) * i + Math.random() * 20}deg`);
    p.style.setProperty('--d', `${26 + Math.random() * 18}px`);
    b.append(p);
  }
  el.append(b);
  setTimeout(() => b.remove(), 800);
}

/** Material-style ripple on buttons. */
export function enableRipples(root = document) {
  root.addEventListener('pointerdown', e => {
    const btn = e.target.closest('.btn, .vote');
    if (!btn || reducedMotion()) return;
    const r = btn.getBoundingClientRect();
    const size = Math.max(r.width, r.height);
    const dot = h('span', { class: 'ripple' });
    Object.assign(dot.style, { width: `${size}px`, height: `${size}px`, left: `${e.clientX - r.left - size / 2}px`, top: `${e.clientY - r.top - size / 2}px` });
    btn.append(dot);
    setTimeout(() => dot.remove(), 650);
  });
}

/** Server-sent events with automatic reconnect. */
export function connect(base, onState, onStatus = () => {}, onEnded = () => {}) {
  let es, retry = 0, ended = false;
  const open = () => {
    if (ended) return;
    es = new EventSource(`${base}/events`);
    es.addEventListener('state', e => { retry = 0; onStatus(true); onState(JSON.parse(e.data)); });
    es.addEventListener('ended', () => { ended = true; es.close(); onEnded(); });
    es.onerror = async () => {
      es.close();
      if (ended) return;
      onStatus(false);
      // Distinguish "server unreachable" from "party no longer exists".
      try {
        const r = await fetch(`${base}/state`, { credentials: 'same-origin' });
        if (r.status === 404) { ended = true; return onEnded(); }
      } catch {}
      setTimeout(open, Math.min(1000 * 2 ** retry++, 15000));
    };
  };
  open();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && es.readyState === EventSource.CLOSED) open();
  });
}

/**
 * Keyed list reconciliation with FLIP animations: rows glide to their new positions,
 * new rows fade in, removed rows fade out, rows that climb get a brief highlight.
 */
export function renderList(ul, items, key, build, update) {
  const before = new Map();
  for (const el of ul.children) if (!el.classList.contains('leave')) before.set(el.dataset.key, el.getBoundingClientRect().top);

  const existing = new Map([...ul.children].filter(el => !el.classList.contains('leave')).map(el => [el.dataset.key, el]));
  const keep = new Set();
  const ordered = items.map(item => {
    const k = key(item);
    keep.add(k);
    let el = existing.get(k);
    if (!el) { el = build(item); el.dataset.key = k; el.classList.add('enter'); el.addEventListener('animationend', () => el.classList.remove('enter', 'fresh'), { once: true }); }
    update(el, item);
    return el;
  });

  for (const [k, el] of existing) {
    if (!keep.has(k)) {
      el.classList.add('leave');
      el.addEventListener('animationend', () => el.remove(), { once: true });
    }
  }

  let cursor = ul.firstChild;
  for (const el of ordered) {
    while (cursor && cursor.classList?.contains('leave')) cursor = cursor.nextSibling;
    if (el !== cursor) ul.insertBefore(el, cursor);
    else cursor = cursor.nextSibling;
  }

  if (reducedMotion()) return;
  for (const el of ordered) {
    const prev = before.get(el.dataset.key);
    if (prev == null) continue;
    const dy = prev - el.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) continue;
    el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 560, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    if (dy > 0) { // moved up the list
      el.classList.remove('rise'); void el.offsetWidth; el.classList.add('rise');
      el.addEventListener('animationend', () => el.classList.remove('rise'), { once: true });
    }
  }
}

/** Room code from /p/CODE or /dj/CODE. */
export function roomCode() {
  const m = location.pathname.match(/\/(?:p|dj)\/([A-Za-z0-9]{5})/);
  return m ? m[1].toUpperCase() : '';
}

// ---------------------------------------------------------------- Spotify attribution

/** Spotify requires metadata and artwork to link back to Spotify. */
export const spotifyUrl = track => track?.uri?.startsWith('spotify:track:') ? `https://open.spotify.com/track/${track.id}` : '';

/**
 * Official Spotify logo, if the operator placed it at /brand/spotify-logo.svg
 * (download it from developer.spotify.com/design — we don't redraw trademarks).
 * Falls back to the word "Spotify".
 */
export function spotifyLogo(cls = '') {
  const img = h('img', { src: '/brand/spotify-logo.svg', alt: 'Spotify', class: cls });
  img.addEventListener('error', () => img.replaceWith(h('b', {}, 'Spotify')), { once: true });
  return img;
}

export function artEl(track, cls = 'art') {
  const box = h('div', { class: cls });
  setArt(box, track);
  return box;
}

/** Renders artwork. Spotify artwork is wrapped in a link to the track on Spotify. */
export function setArt(box, track) {
  const src = track?.art || '';
  const link = spotifyUrl(track);
  if (box.dataset.src === src && box.dataset.link === link && box.firstChild) return;
  box.dataset.src = src;
  box.dataset.link = link;
  const img = src ? h('img', { src, alt: '', loading: 'lazy', decoding: 'async' }) : h('span', { html: icons.note });
  if (link) {
    box.replaceChildren(h('a', {
      href: link, target: '_blank', rel: 'noopener', title: 'Open in Spotify', 'aria-label': `Open ${track.title} in Spotify`,
      style: 'display:block;width:100%;height:100%', onclick: e => e.stopPropagation(),
    }, img));
  } else {
    box.replaceChildren(img);
  }
}

export function fmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function subline(track, extra) {
  const parts = [];
  if (track.explicit) parts.push(h('span', { class: 'explicit', title: 'Explicit' }, 'E'));
  parts.push(h('span', {}, track.artist || 'Unknown artist'));
  if (extra) parts.push(h('span', { class: 'dot' }, '·'), h('span', {}, extra));
  return parts;
}

/** Interpolates now-playing progress between server pushes. */
export function progressOf(np, clockOffset) {
  if (!np) return 0;
  const now = Date.now() + clockOffset;
  const p = np.isPlaying ? np.progressMs + (now - np.updatedAt) : np.progressMs;
  return np.track.durationMs ? Math.min(p, np.track.durationMs) : p;
}
