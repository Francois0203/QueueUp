import type { ReactNode } from 'react';
import styles from './Footer.module.css';

/** Legal links + Spotify disclaimer, on every page. */
export function Footer({ children }: { children?: ReactNode }) {
  return (
    <footer className={styles.foot}>
      {children && <p>{children}</p>}
      <p><a href="/terms" target="_blank">Terms</a> · <a href="/privacy" target="_blank">Privacy</a></p>
      <p>QueueUp is not affiliated with Spotify.</p>
    </footer>
  );
}
