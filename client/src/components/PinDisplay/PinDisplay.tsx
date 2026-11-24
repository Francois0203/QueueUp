import { motion } from 'motion/react';
import { spring } from '../../lib';
import styles from './PinDisplay.module.css';

/** Big, easy-to-read PIN where each digit pops in. */
export function PinDisplay({ pin }: { pin: string }) {
  return (
    <div className={styles.pin} aria-label={`PIN ${pin.split('').join(' ')}`}>
      {pin.split('').map((d, i) => (
        <motion.span key={i} aria-hidden="true" initial={{ opacity: 0, y: 14, scale: 0.7 }} animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ ...spring.pop, delay: 0.15 + i * 0.06 }}>
          {d}
        </motion.span>
      ))}
    </div>
  );
}
