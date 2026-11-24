import { AnimatedNumber } from '../AnimatedNumber';
import styles from './LiveIndicator.module.css';

/** Pulsing "live" dot with how many people have joined the party. */
export function LiveIndicator({ online, count }: { online: boolean; count: number }) {
  return (
    <span className={`${styles.live} ${online ? '' : styles.offline}`}>
      <span className={styles.dot} />
      {!online ? 'Reconnecting' : count > 1 ? <><AnimatedNumber value={count} />&nbsp;joined</> : 'Live'}
    </span>
  );
}
