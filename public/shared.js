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
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastHost;
export function toast(msg, { error = false, ms = 2600 } = {}) {
  if (!toastHost) { toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(toastHost); }
  const t = h('div', { class: 'toast' + (error ? ' error' : '') }, msg);
  toastHost.append(t);
  setTimeout(() => { t.classList.add('out'); t.addEventListener('animationend', () => t.remove(), { once: true }); }, ms);
}

/** Server-sent events with automatic reconnect. */
export function connect(onState, onStatus = () => {}) {
  let es, retry = 0;
  const open = () => {
    es = new EventSource('/api/events');
    es.addEventListener('state', e => { retry = 0; onStatus(true); onState(JSON.parse(e.data)); });
    es.onerror = () => {
      onStatus(false);
      es.close();
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
 * new rows fade in, removed rows fade out.
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
    if (!el) { el = build(item); el.dataset.key = k; el.classList.add('enter'); el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true }); }
    update(el, item);
    return el;
  });

  for (const [k, el] of existing) {
    if (!keep.has(k)) {
      el.classList.add('leave');
      el.addEventListener('animationend', () => el.remove(), { once: true });
    }
  }

  // Place in order (leaving rows stay where they are until they finish).
  let cursor = ul.firstChild;
  for (const el of ordered) {
    while (cursor && cursor.classList?.contains('leave')) cursor = cursor.nextSibling;
    if (el !== cursor) ul.insertBefore(el, cursor);
    else cursor = cursor.nextSibling;
  }

  // FLIP
  for (const el of ordered) {
    const prev = before.get(el.dataset.key);
    if (prev == null) continue;
    const dy = prev - el.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) continue;
    el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 520, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  }
}

export function artEl(track, cls = 'art') {
  const box = h('div', { class: cls });
  setArt(box, track);
  return box;
}

export function setArt(box, track) {
  const src = track?.art || '';
  if (box.dataset.src === src && box.firstChild) return;
  box.dataset.src = src;
  box.replaceChildren(src ? h('img', { src, alt: '', loading: 'lazy', decoding: 'async' }) : h('span', { html: icons.note }));
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
