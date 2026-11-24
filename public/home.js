import { h, api, toast, enableRipples, haptic } from './shared.js';

const $ = id => document.getElementById(id);
enableRipples();

// Parties this browser hosted, so the DJ can get back to them.
const loadMine = () => { try { return JSON.parse(localStorage.getItem('qu_parties') || '[]'); } catch { return []; } };
const saveMine = list => { try { localStorage.setItem('qu_parties', JSON.stringify(list.slice(0, 8))); } catch {} };

const code = $('code');
code.addEventListener('input', () => {
  code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  if (code.value.length === 5) haptic(5);
});

$('joinForm').addEventListener('submit', async e => {
  e.preventDefault();
  const c = code.value.trim();
  if (c.length !== 5) return shake(e.target, 'Party codes are 5 characters.');
  const btn = e.submitter; btn?.classList.add('loading');
  try {
    await api(`/api/rooms/${c}`);
    location.href = `/p/${c}`;
  } catch (err) {
    shake(e.target, err.message);
    btn?.classList.remove('loading');
  }
});

$('startForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!$('acceptTerms').checked) return shake($('consent'), 'Please accept the Terms to host a party.');
  const btn = e.submitter; btn?.classList.add('loading');
  try {
    const name = $('partyName').value.trim();
    const { code: c } = await api('/api/rooms', { method: 'POST', body: { partyName: name, acceptTerms: true } });
    saveMine([{ code: c, name: name || 'Tonight' }, ...loadMine().filter(p => p.code !== c)]);
    haptic([10, 40, 16]);
    location.href = `/dj/${c}?welcome=1`;
  } catch (err) {
    toast(err.message, { error: true });
    btn?.classList.remove('loading');
  }
});

function shake(el, msg) {
  el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
  haptic([20, 40, 20]);
  toast(msg, { error: true });
}

// Show hosted parties that still exist.
(async () => {
  const mine = loadMine();
  if (!mine.length) return;
  const alive = (await Promise.all(mine.map(p => api(`/api/rooms/${p.code}`).then(r => ({ ...p, name: r.partyName })).catch(e => e.status === 404 ? null : p)))).filter(Boolean);
  saveMine(alive);
  if (!alive.length) return;
  $('mineList').replaceChildren(...alive.map((p, i) =>
    h('li', {}, h('a', { class: 'row party-link enter', href: `/dj/${p.code}`, style: `animation-delay:${0.8 + i * 0.06}s` },
      h('div', { class: 'meta' }, h('div', { class: 'title' }, p.name), h('div', { class: 'sub' }, h('span', {}, `Code ${p.code}`))),
      h('span', { class: 'tag' }, 'Open console →')))));
  $('mine').hidden = false;
})();
