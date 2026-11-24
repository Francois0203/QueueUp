import type { NowPlaying, Track } from '../types';

export function fmtTime(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Interpolates now-playing progress between server pushes. */
export function progressOf(np: NowPlaying | null, clockOffset: number) {
  if (!np) return 0;
  const now = Date.now() + clockOffset;
  const p = np.isPlaying ? np.progressMs + (now - np.updatedAt) : np.progressMs;
  return np.track.durationMs ? Math.min(p, np.track.durationMs) : p;
}

/** Spotify requires metadata and artwork to link back to Spotify. */
export const spotifyUrl = (track?: Track | null) =>
  track?.uri?.startsWith('spotify:track:') ? `https://open.spotify.com/track/${track.id}` : '';

export const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** Pulls a 32-char Spotify Client ID out of anything pasted (ID, dashboard URL…). */
export const extractClientId = (text: string) => (String(text).match(/[a-f0-9]{32}/i) || [''])[0].toLowerCase();
