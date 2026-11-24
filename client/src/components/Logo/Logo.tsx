import { motion } from 'motion/react';
import { Icon } from '../Icon';
import { spring } from '../../lib';
import styles from './Logo.module.css';

interface Props {
  size?: number;
  /** Equalizer bars instead of the note glyph. */
  animated?: boolean;
  /** Pop in on mount. */
  entrance?: boolean;
}

export function Logo({ size = 28, animated = false, entrance = false }: Props) {
  return (
    <motion.div
      className={styles.mark}
      style={{ width: size, height: size, borderRadius: size * 0.3 }}
      initial={entrance ? { scale: 0.5, rotate: -14, opacity: 0 } : false}
      animate={{ scale: 1, rotate: 0, opacity: 1 }}
      transition={spring.pop}
      aria-hidden="true"
    >
      {animated
        ? <span className={styles.bars} style={{ height: size * 0.4 }}><i /><i /><i /><i /></span>
        : <Icon name="note" size={size * 0.56} strokeWidth={2.6} />}
    </motion.div>
  );
}
