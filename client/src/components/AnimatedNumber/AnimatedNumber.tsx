import { AnimatePresence, motion } from 'motion/react';
import { useRef } from 'react';
import { spring } from '../../lib';
import styles from './AnimatedNumber.module.css';

/** A number that rolls up (or down) when it changes. */
export function AnimatedNumber({ value, className = '' }: { value: number | string; className?: string }) {
  const prev = useRef(value);
  const dir = Number(value) >= Number(prev.current) ? 1 : -1;
  if (prev.current !== value) prev.current = value;

  return (
    <span className={`${styles.wrap} ${className}`}>
      <AnimatePresence initial={false} mode="popLayout" custom={dir}>
        <motion.span
          key={String(value)}
          className={styles.digit}
          custom={dir}
          variants={{
            enter: (d: number) => ({ y: `${d * 90}%`, opacity: 0 }),
            center: { y: '0%', opacity: 1 },
            exit: (d: number) => ({ y: `${d * -90}%`, opacity: 0 }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={spring.snappy}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
