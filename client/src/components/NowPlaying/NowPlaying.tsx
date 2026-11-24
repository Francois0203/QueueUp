import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import type { NowPlaying as NP } from '../../types';
import { useProgress } from '../../hooks';
import { fmtTime, rise, spring } from '../../lib';
import { Artwork } from '../Artwork';
import { OpenInSpotify } from '../Spotify';
import styles from './NowPlaying.module.css';

function Equalizer({ playing }: { playing: boolean }) {
  return <span className={`${styles.eq} ${playing ? styles.eqOn : ''}`} aria-hidden="true"><i /><i /><i /></span>;
}

/** Guest hero: big artwork, a glow that breathes behind it while music plays, live progress. */
export function NowPlayingHero({ np, clockOffset }: { np: NP | null; clockOffset: number }) {
  const ms = useProgress(np, clockOffset);
  const playing = Boolean(np?.isPlaying);
  const key = np?.track.id ?? 'none';
  const pct = np?.track.durationMs ? Math.min(100, (ms / np.track.durationMs) * 100) : 0;

  return (
    <section className={styles.hero} aria-live="polite">
      <div className={`${styles.stage} ${playing ? styles.playing : ''}`}>
        {/* The artwork tile only fades between tracks; the artwork itself is never altered. */}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={key} className={styles.artWrap}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.45 }}>
            <Artwork track={np?.track} size="lg" />
          </motion.div>
        </AnimatePresence>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={key} className={styles.text} {...rise} transition={spring.smooth}>
          <div className={styles.label}><Equalizer playing={playing} />{np ? (playing ? 'Now playing' : 'Paused') : 'Up soon'}</div>
          <h1 className={`${styles.title} ${np ? '' : styles.idle}`}>{np ? np.track.title : 'Waiting for the next track'}</h1>
          <div className={styles.artist}>{np ? np.track.artist : "The DJ hasn't started yet"}</div>
          {np && <div className={styles.link}><OpenInSpotify track={np.track} /></div>}
        </motion.div>
      </AnimatePresence>

      {np && np.track.durationMs > 0 && (
        <div className={styles.progress}>
          <span>{fmtTime(ms)}</span>
          <div className={styles.track}>
            <motion.div className={styles.fill} animate={{ width: `${pct}%` }} transition={{ duration: 1, ease: 'linear' }} />
          </div>
          <span>{fmtTime(np.track.durationMs)}</span>
        </div>
      )}
    </section>
  );
}

/** Compact version for the DJ console. */
export function NowPlayingMini({ np, hint, action }: { np: NP | null; hint: string; action?: ReactNode }) {
  const playing = Boolean(np?.isPlaying);
  return (
    <div className={styles.mini}>
      <Artwork track={np?.track} size="md" />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={np?.track.id ?? 'none'} className={styles.miniMeta} {...rise} transition={spring.smooth}>
          <div className={styles.miniLabel}><Equalizer playing={playing} />{np ? (playing ? 'Now playing' : 'Paused') : 'Now playing'}</div>
          <div className={styles.miniTitle}>{np ? np.track.title : 'Nothing playing'}</div>
          <div className={styles.miniSub}>{np ? np.track.artist : hint}</div>
        </motion.div>
      </AnimatePresence>
      {action}
    </div>
  );
}
