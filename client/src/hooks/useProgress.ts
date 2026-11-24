import { useEffect, useState } from 'react';
import type { NowPlaying } from '../types';
import { progressOf } from '../lib';

/** Current playback position, ticking every second between server updates. */
export function useProgress(np: NowPlaying | null, clockOffset: number) {
  const [ms, setMs] = useState(() => progressOf(np, clockOffset));
  useEffect(() => {
    setMs(progressOf(np, clockOffset));
    if (!np?.isPlaying) return;
    const t = setInterval(() => setMs(progressOf(np, clockOffset)), 1000);
    return () => clearInterval(t);
  }, [np, clockOffset]);
  return ms;
}
