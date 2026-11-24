import { motion } from 'motion/react';
import { useState } from 'react';
import type { Track } from '../../types';
import { spotifyUrl } from '../../lib';
import { Icon } from '../Icon';
import styles from './Artwork.module.css';

interface Props {
  track?: Track | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * Album artwork, shown exactly as Spotify provides it (no blur, overlay, crop or motion;
 * only a fade-in while loading) and linked back to the track on Spotify.
 */
export function Artwork({ track, size = 'sm', className = '' }: Props) {
  const [loaded, setLoaded] = useState(false);
  const src = track?.art;
  const href = spotifyUrl(track);
  const img = src
    ? <motion.img src={src} alt={`${track!.title} artwork`} loading="lazy" decoding="async"
        initial={{ opacity: 0 }} animate={{ opacity: loaded ? 1 : 0 }} transition={{ duration: 0.4 }} onLoad={() => setLoaded(true)} />
    : <Icon name="note" size={size === 'lg' ? 64 : 20} strokeWidth={1.6} />;

  return (
    <div className={`${styles.art} ${styles[size]} ${className}`}>
      {href
        ? <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`Open ${track!.title} in Spotify`} onClick={e => e.stopPropagation()}>{img}</a>
        : img}
    </div>
  );
}
