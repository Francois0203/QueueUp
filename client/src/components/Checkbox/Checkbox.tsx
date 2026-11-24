import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { haptics, spring } from '../../lib';
import styles from './Checkbox.module.css';

interface Props {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  invalid?: boolean;
  id?: string;
}

export function Checkbox({ checked, onChange, children, invalid, id }: Props) {
  return (
    <label className={`${styles.wrap} ${invalid ? styles.invalid : ''}`}>
      <input id={id} type="checkbox" className="sr-only" checked={checked}
        onChange={e => { haptics.select(); onChange(e.target.checked); }} />
      <motion.span className={`${styles.box} ${checked ? styles.on : ''}`} whileTap={{ scale: 0.85 }} transition={spring.snappy} aria-hidden="true">
        <svg viewBox="0 0 20 20">
          <motion.path d="M5 10.5l3.2 3.2L15 7" initial={false} animate={{ pathLength: checked ? 1 : 0 }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }} />
        </svg>
      </motion.span>
      <span className={styles.text}>{children}</span>
    </label>
  );
}
