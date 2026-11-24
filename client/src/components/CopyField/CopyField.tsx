import { AnimatePresence, motion } from 'motion/react';
import { useCopy } from '../../hooks';
import { spring } from '../../lib';
import { Icon } from '../Icon';
import styles from './CopyField.module.css';

interface Props {
  label: string;
  value: string;
  /** Highlight + show the full value (wrap instead of truncate). */
  important?: boolean;
  onFail?: () => void;
}

/** A labelled value with a one-tap copy button that morphs into "Copied". */
export function CopyField({ label, value, important, onFail }: Props) {
  const { copy, copied } = useCopy();
  const done = copied === value;
  return (
    <div className={`${styles.field} ${important ? styles.important : ''}`}>
      <div className={styles.text}>
        <small>{label}</small>
        <code>{value}</code>
      </div>
      <motion.button type="button" className={`${styles.btn} ${done ? styles.done : ''}`} layout transition={spring.snappy}
        whileTap={{ scale: 0.92 }} onClick={async () => { if (!(await copy(value))) onFail?.(); }} aria-label={`Copy ${label}`}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={done ? 'done' : 'copy'} className={styles.btnInner}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={spring.snappy}>
            <Icon name={done ? 'check' : 'copy'} size={14} strokeWidth={2.4} />{done ? 'Copied' : 'Copy'}
          </motion.span>
        </AnimatePresence>
      </motion.button>
    </div>
  );
}
