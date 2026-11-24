import type { ReactNode } from 'react';
import { AnimatedNumber } from '../AnimatedNumber';
import styles from './Layout.module.css';

/** Centered page column. */
export function Page({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <main className={`${styles.page} ${wide ? styles.wide : ''}`}>{children}</main>;
}

export function TopBar({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return <header className={styles.topbar}><div className={styles.brand}>{left}</div>{right}</header>;
}

/** Small uppercase heading for a list, with an animated count. */
export function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className={styles.section}>
      <span>{title}</span>
      {!!count && <AnimatedNumber value={count} />}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`${styles.card} ${className}`}>{children}</div>;
}

/** One row in a settings card: text on the left, a control on the right. */
export function SettingRow({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.setting}>
      <div className={styles.settingText}><b>{title}</b>{description && <span>{description}</span>}</div>
      {children}
    </div>
  );
}
