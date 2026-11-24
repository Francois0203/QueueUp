import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { spring } from '../../lib';
import styles from './Chip.module.css';

interface Props { active?: boolean; children: ReactNode; onClick?: () => void; title?: string }

/** Small status pill with a dot that lights up when active. */
export function Chip({ active, children, onClick, title }: Props) {
  const content = <><span className={`${styles.dot} ${active ? styles.on : ''}`} /><span className={styles.label}>{children}</span></>;
  if (!onClick) return <span className={styles.chip} title={title}>{content}</span>;
  return (
    <motion.button type="button" className={`${styles.chip} ${styles.clickable}`} title={title} onClick={onClick}
      whileTap={{ scale: 0.94 }} transition={spring.snappy}>
      {content}
    </motion.button>
  );
}
