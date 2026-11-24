/** The app has a handful of page types; a full router library would be overkill. */
export type Route =
  | { name: 'home' }
  | { name: 'guest'; code: string }
  | { name: 'dj'; code: string }
  | { name: 'spotifyCallback' }
  | { name: 'notFound' };

export function matchRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  if (pathname === '/auth/spotify/callback') return { name: 'spotifyCallback' };
  const m = pathname.match(/^\/(p|dj)\/([A-Za-z0-9]{5})\/?$/);
  if (m) return { name: m[1] === 'p' ? 'guest' : 'dj', code: m[2].toUpperCase() };
  return { name: 'notFound' };
}

export const go = (path: string) => { window.location.href = path; };
