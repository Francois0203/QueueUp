import { useEffect, useRef } from 'react';
import { call } from '../lib';
import type { NowPlaying } from '../types';

type Options = { connected: boolean; np: NowPlaying | null; listeners: number; dj?: boolean };

/**
 * Keeps "now playing" live by asking the server to check Spotify. Every open page helps, but the
 * server only checks Spotify once per party every few seconds, so more guests doesn't mean more
 * Spotify calls. Guests space their nudges out by party size, and everyone nudges quickly right
 * when the current song should end, so the next song shows up within a few seconds.
 */
export function useNowPlayingSync(code: string, { connected, np, listeners, dj = false }: Options) {
  const npRef = useRef(np);
  npRef.current = np;
  const sizeRef = useRef(listeners);
  sizeRef.current = listeners;

  useEffect(() => {
    if (!connected) return;
    let nextAt = 0;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      const cur = npRef.current;
      const endsAt = cur?.isPlaying && cur.track.durationMs > 0 ? cur.updatedAt + cur.track.durationMs - cur.progressMs : 0;
      // Just after a song should have ended: check often until the next one shows up.
      const songJustEnded = endsAt > 0 && now >= endsAt && now - endsAt < 30_000;
      if (now < nextAt && !(songJustEnded && nextAt - now > 3000)) return;
      const base = dj ? 5000 : Math.min(60_000, Math.max(8000, sizeRef.current * 3000));
      const gap = songJustEnded ? 3000 : base;
      nextAt = now + gap * (0.8 + Math.random() * 0.4); // jitter so guests don't all call at once
      call('poll', { code }).catch(() => {});
    };
    tick();
    const t = setInterval(tick, 1000);
    const onVisible = () => { if (document.visibilityState === 'visible') { nextAt = 0; tick(); } };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [connected, code, dj]);
}
