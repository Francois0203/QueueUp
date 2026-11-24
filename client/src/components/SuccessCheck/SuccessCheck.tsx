import { motion } from 'motion/react';
import { Burst } from '../Burst';
import { spring } from '../../lib';
import styles from './SuccessCheck.module.css';

/** Full-panel success moment: a ring and check draw themselves, then confetti. */
export function SuccessCheck({ title, text }: { title: string; text?: string }) {
  return (
    <motion.div className={styles.wrap} key="success"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
      <motion.div className={styles.mark} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={spring.pop}>
        <svg viewBox="0 0 88 88" aria-hidden="true">
          <motion.circle cx="44" cy="44" r="40" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }} />
          <motion.path d="M28 45l10.5 10.5L61 33" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35, delay: 0.35, ease: [0.16, 1, 0.3, 1] }} />
        </svg>
        <Burst trigger={1} count={18} distance={70} />
      </motion.div>
      <motion.b initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.smooth, delay: 0.25 }}>{title}</motion.b>
      {text && <motion.span initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.smooth, delay: 0.35 }}>{text}</motion.span>}
    </motion.div>
  );
}
