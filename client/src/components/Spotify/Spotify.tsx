import { useState } from 'react';
import type { Track } from '../../types';
import { spotifyUrl } from '../../lib';
import { Icon } from '../Icon';
import styles from './Spotify.module.css';

/**
 * The official Spotify logo, if the operator placed it at /brand/spotify-logo.svg
 * (download from developer.spotify.com/design; never redraw trademarks).
 * Falls back to the word "Spotify".
 */
export function SpotifyLogo({ height = 16 }: { height?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <b className={styles.word}>Spotify</b>;
  return <img src="/brand/spotify-logo.svg" alt="Spotify" style={{ height, width: 'auto' }} onError={() => setFailed(true)} />;
}

/** "Open in Spotify" pill: the link-back Spotify requires next to its metadata. */
export function OpenInSpotify({ track }: { track: Track }) {
  const href = spotifyUrl(track);
  if (!href) return null;
  return (
    <a className={styles.open} href={href} target="_blank" rel="noopener noreferrer">
      <SpotifyLogo /> <span>Open in Spotify</span> <Icon name="external" size={12} />
    </a>
  );
}

/** "Search powered by Spotify" footer for result lists. */
export function SpotifyAttribution({ label = 'Search powered by' }: { label?: string }) {
  return (
    <a className={styles.attr} href="https://open.spotify.com" target="_blank" rel="noopener noreferrer">
      <span>{label}</span> <SpotifyLogo height={18} />
    </a>
  );
}
