import { motion } from 'motion/react';
import { haptics, spring } from '../../lib';
import styles from './Switch.module.css';

interface Props { checked: boolean; onChange: (v: boolean) => void; label: string }

export function Switch({ checked, onChange, label }: Props) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label}
      className={`${styles.track} ${checked ? styles.on : ''}`}
      onClick={() => { haptics.select(); onChange(!checked); }}>
      <motion.span className={styles.knob} layout transition={spring.snappy} whileTap={{ scale: 0.85 }} />
    </button>
  );
}
