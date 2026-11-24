import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'motion/react';
import { useEffect } from 'react';
import styles from './Aura.module.css';

/**
 * Ambient background: two soft gradient orbs that drift on their own and lean gently
 * toward the pointer. Pure gradients, never derived from album art (Spotify rules).
 */
export function Aura({ intense = false }: { intense?: boolean }) {
  const reduce = useReducedMotion();
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 40, damping: 20 });
  const sy = useSpring(py, { stiffness: 40, damping: 20 });
  const ax = useTransform(sx, [-1, 1], [-40, 40]);
  const ay = useTransform(sy, [-1, 1], [-30, 30]);
  const bx = useTransform(sx, [-1, 1], [30, -30]);
  const by = useTransform(sy, [-1, 1], [24, -24]);

  useEffect(() => {
    if (reduce || !matchMedia('(pointer: fine)').matches) return;
    const onMove = (e: PointerEvent) => {
      px.set((e.clientX / innerWidth) * 2 - 1);
      py.set((e.clientY / innerHeight) * 2 - 1);
    };
    addEventListener('pointermove', onMove, { passive: true });
    return () => removeEventListener('pointermove', onMove);
  }, [reduce, px, py]);

  return (
    <div className={styles.aura} aria-hidden="true">
      <motion.div className={styles.orb} style={{ x: ax, y: ay }} animate={{ opacity: intense ? 1 : 0.55 }} transition={{ duration: 1.6 }}>
        <div className={`${styles.blob} ${styles.a}`} />
      </motion.div>
      <motion.div className={styles.orb} style={{ x: bx, y: by }} animate={{ opacity: intense ? 1 : 0.5 }} transition={{ duration: 1.6 }}>
        <div className={`${styles.blob} ${styles.b}`} />
      </motion.div>
      <div className={styles.grain} />
    </div>
  );
}
