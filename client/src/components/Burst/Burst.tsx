import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { useMemo } from 'react';
import styles from './Burst.module.css';

const COLORS = ['var(--accent)', 'rgb(var(--violet-rgb))', '#fff'];

/**
 * A small confetti pop from the centre of its parent. Fires each time `trigger` changes
 * (pass a counter). The parent needs `position: relative`.
 */
export function Burst({ trigger, count = 12, distance = 38 }: { trigger: number; count?: number; distance?: number }) {
  const reduce = useReducedMotion();
  const particles = useMemo(() => Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const d = distance * (0.7 + Math.random() * 0.6);
    return { x: Math.cos(angle) * d, y: Math.sin(angle) * d, size: 3 + Math.random() * 4, color: COLORS[i % COLORS.length] };
  }), [trigger, count, distance]); // new random spread per trigger

  if (reduce) return null;
  return (
    <span className={styles.burst} aria-hidden="true">
      <AnimatePresence>
        {trigger > 0 && particles.map((p, i) => (
          <motion.i
            key={`${trigger}-${i}`}
            className={styles.p}
            style={{ width: p.size, height: p.size, background: p.color, marginLeft: -p.size / 2, marginTop: -p.size / 2 }}
            initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
            animate={{ x: p.x, y: p.y, scale: 0.2, opacity: 0 }}
            transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
          />
        ))}
      </AnimatePresence>
    </span>
  );
}
