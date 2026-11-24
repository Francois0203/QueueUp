import { motion } from 'motion/react';
import { useEffect } from 'react';
import { Aura, Logo } from '../../components';
import { call, go, ApiError, rise, spring } from '../../lib';
import styles from './SpotifyCallback.module.css';

const LOCAL_ORIGIN = 'http://localhost:3000';

/**
 * Spotify redirects every DJ here (one Redirect URI for all DJs and environments).
 * state = PARTY.nonce.origin — "l" means the login started on localhost, so hand it back there.
 */
export function SpotifyCallbackPage() {
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const state = params.get('state') || '';
    const [party, , origin] = state.split('.');

    if (origin === 'l' && location.origin !== LOCAL_ORIGIN) {
      location.replace(`${LOCAL_ORIGIN}/auth/spotify/callback${location.search}`);
      return;
    }
    if (!/^[A-Z0-9]{5}$/.test(party || '')) { go('/'); return; }

    call('spotifyComplete', { code: party, state, authCode: params.get('code') || '', error: params.get('error') || '' })
      .then(() => go(`/dj/${party}?spotify=connected`))
      .catch((e: ApiError) => {
        const reason = e.code === 'permission-denied' ? 'signin' : e.code === 'cancelled' ? 'denied' : 'error';
        go(`/dj/${party}?spotify=${reason}`);
      });
  }, []);

  return (
    <>
      <Aura intense />
      <main className={styles.center}>
        <motion.div className={styles.card} {...rise} transition={spring.smooth}>
          <Logo size={52} animated entrance />
          <h1>Connecting Spotify…</h1>
          <p>One moment.</p>
        </motion.div>
      </main>
    </>
  );
}
