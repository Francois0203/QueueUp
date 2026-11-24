import { AnimatePresence, motion, useMotionValue, useTransform, type PanInfo } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import type { Track } from '../../types';
import { haptics, spring } from '../../lib';
import { Artwork } from '../Artwork';
import { Icon, type IconName } from '../Icon';
import styles from './SongRow.module.css';

export interface SwipeAction { label: string; icon: IconName; onTrigger: () => void; tone?: 'accent' | 'danger' }

interface Props {
  track: Track;
  /** Extra text after the artist, e.g. "from Ana". */
  detail?: string;
  /** Position in its list; when it improves, the row glows as it climbs. */
  rank?: number;
  variant?: 'default' | 'queued' | 'played' | 'result';
  mine?: boolean;
  /** Highlight once on mount (e.g. the request this guest just made). */
  fresh?: boolean;
  onClick?: () => void;
  /** Entrance delay in seconds, for staggered lists. */
  delay?: number;
  /** Swipe the row right / left to trigger these (touch and mouse). */
  swipeRight?: SwipeAction;
  swipeLeft?: SwipeAction;
  /** Content revealed under the row (e.g. secondary actions). */
  expanded?: ReactNode;
  children?: ReactNode;
  ref?: Ref<HTMLLIElement>;
}

const THRESHOLD = 96;

/**
 * One song in any list. Animates in, out, and to its new position when the list reorders.
 * Optional swipe actions reveal a coloured label underneath as you drag.
 */
export function SongRow({ track, detail, rank, variant = 'default', mine, fresh, onClick, delay = 0, swipeRight, swipeLeft, expanded, children, ref }: Props) {
  const prevRank = useRef(rank);
  const [rising, setRising] = useState(false);
  const x = useMotionValue(0);
  const armed = useRef<'left' | 'right' | null>(null);
  const rightOpacity = useTransform(x, [0, THRESHOLD], [0, 1]);
  const leftOpacity = useTransform(x, [-THRESHOLD, 0], [1, 0]);
  const rightScale = useTransform(x, [0, THRESHOLD], [0.6, 1]);
  const leftScale = useTransform(x, [-THRESHOLD, 0], [1, 0.6]);
  const canSwipe = Boolean(swipeLeft || swipeRight);

  useEffect(() => {
    if (rank !== undefined && prevRank.current !== undefined && rank < prevRank.current) {
      setRising(true);
      const t = setTimeout(() => setRising(false), 1100);
      prevRank.current = rank;
      return () => clearTimeout(t);
    }
    prevRank.current = rank;
  }, [rank]);

  // A little tick when a swipe passes the point of no return.
  useEffect(() => x.on('change', v => {
    const zone = v > THRESHOLD ? 'right' : v < -THRESHOLD ? 'left' : null;
    if (zone !== armed.current) { if (zone) haptics.select(); armed.current = zone; }
  }), [x]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x > THRESHOLD && swipeRight) swipeRight.onTrigger();
    else if (info.offset.x < -THRESHOLD && swipeLeft) swipeLeft.onTrigger();
  };

  const cls = [styles.row, styles[variant], mine && styles.mine, fresh && styles.fresh, rising && styles.rising, onClick && styles.clickable]
    .filter(Boolean).join(' ');

  return (
    <motion.li
      ref={ref}
      layout="position"
      className={styles.item}
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: variant === 'played' ? 0.5 : 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.2 } }}
      transition={{ ...spring.smooth, delay }}
      style={{ zIndex: rising ? 2 : 1 }}
    >
      {canSwipe && (
        <div className={styles.under} aria-hidden="true">
          {swipeRight && <motion.span className={`${styles.reveal} ${styles.revealRight} ${styles[swipeRight.tone ?? 'accent']}`} style={{ opacity: rightOpacity, scale: rightScale }}><Icon name={swipeRight.icon} />{swipeRight.label}</motion.span>}
          {swipeLeft && <motion.span className={`${styles.reveal} ${styles.revealLeft} ${styles[swipeLeft.tone ?? 'danger']}`} style={{ opacity: leftOpacity, scale: leftScale }}>{swipeLeft.label}<Icon name={swipeLeft.icon} /></motion.span>}
        </div>
      )}
      <motion.div
        className={cls}
        style={{ x }}
        drag={canSwipe ? 'x' : false}
        dragDirectionLock
        dragSnapToOrigin
        dragElastic={{ left: swipeLeft ? 0.6 : 0.05, right: swipeRight ? 0.6 : 0.05 }}
        dragTransition={{ bounceStiffness: 500, bounceDamping: 30 }}
        onDragEnd={onDragEnd}
        // onTap (not onClick): doesn't fire after a swipe, and works with Enter/Space when focused.
        onTap={onClick ? e => { if (!(e.target as Element).closest?.('button, a, input')) onClick(); } : undefined}
        tabIndex={onClick ? 0 : undefined}
        role={onClick ? 'button' : undefined}
        whileTap={onClick ? { scale: 0.985 } : undefined}
      >
        <div className={styles.main}>
          <Artwork track={track} />
          <div className={styles.meta}>
            <div className={styles.title}>{track.title}</div>
            <div className={styles.sub}>
              {track.explicit && <span className={styles.explicit} title="Explicit">E</span>}
              <span className={styles.artist}>{track.artist || 'Unknown artist'}</span>
              {detail && <><span className={styles.dot}>·</span><span className={styles.detail}>{detail}</span></>}
            </div>
          </div>
          {children && <div className={styles.actions} onClick={e => e.stopPropagation()}>{children}</div>}
        </div>
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div key="more" className={styles.more} onClick={e => e.stopPropagation()}
              initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring.smooth}>
              <div className={styles.moreInner}>{expanded}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.li>
  );
}
