/** localStorage that never throws (private mode, blocked storage). Per-device conveniences only. */
export const storage = {
  get(key: string, fallback = '') {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  },
  set(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
  },
  remove(key: string) {
    try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
  },
  getJson<T>(key: string, fallback: T): T {
    try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; }
  },
  setJson(key: string, value: unknown) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};

export const KEYS = {
  guestName: 'qu_name',
  parties: 'qu_parties',
  spotifyClientId: 'qu_spotify_client_id',
} as const;
