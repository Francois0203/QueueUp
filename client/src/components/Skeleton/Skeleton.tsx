import styles from './Skeleton.module.css';

/** Shimmering placeholder rows while results load. */
export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <ul className={styles.list} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className={styles.row} style={{ opacity: 1 - i * 0.16 }}>
          <div className={`${styles.block} ${styles.art}`} />
          <div className={styles.lines}>
            <div className={styles.block} style={{ width: `${62 - i * 5}%` }} />
            <div className={styles.block} style={{ width: `${36 + i * 4}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
