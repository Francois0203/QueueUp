import { MotionConfig } from 'motion/react';
import { ToastProvider } from './components';
import { HomePage, GuestPage, DjPage, NotFoundPage, SpotifyCallbackPage } from './pages';
import { matchRoute } from './lib';

export function App() {
  const route = matchRoute(window.location.pathname);
  return (
    // Honour the OS "reduce motion" setting everywhere: transforms off, fades kept.
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        {route.name === 'home' && <HomePage />}
        {route.name === 'guest' && <GuestPage code={route.code} />}
        {route.name === 'dj' && <DjPage code={route.code} />}
        {route.name === 'spotifyCallback' && <SpotifyCallbackPage />}
        {route.name === 'notFound' && <NotFoundPage />}
      </ToastProvider>
    </MotionConfig>
  );
}
