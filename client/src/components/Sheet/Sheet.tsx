import { AnimatePresence, motion, useDragControls, type PanInfo } from 'motion/react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from '../Button';
import { spring } from '../../lib';
import styles from './Sheet.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Content pinned under the scrolling body. */
  footer?: ReactNode;
  /** Shrink to fit content instead of a tall panel. */
  fit?: boolean;
  /** Extra layer shown on top of the content (e.g. a success state). */
  overlay?: ReactNode;
  header?: ReactNode;
}

/** Bottom sheet: springs up, drag down (or tap outside, or Esc) to dismiss. */
export function Sheet({ open, onClose, title, children, footer, fit, overlay, header }: Props) {
  const titleId = useId();
  const drag = useDragControls();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    addEventListener('keydown', onKey);
    const last = document.activeElement as HTMLElement | null;
    return () => {
      document.body.style.overflow = prev;
      removeEventListener('keydown', onKey);
      last?.focus?.({ preventScroll: true });
    };
  }, [open, onClose]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 600) onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <div className={styles.root} key="sheet">
          <motion.div className={styles.scrim} onClick={onClose}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} />
          <motion.div
            ref={panel}
            role="dialog" aria-modal="true" aria-labelledby={titleId}
            className={`${styles.panel} ${fit ? styles.fit : ''}`}
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={spring.surface}
            drag="y" dragControls={drag} dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0.05, bottom: 0.7 }}
            onDragEnd={onDragEnd}
          >
            <div className={styles.handle} onPointerDown={e => drag.start(e)}>
              <span className={styles.grip} />
              <div className={styles.head}>
                <h2 id={titleId}>{title}</h2>
                <Button size="icon" icon="x" aria-label="Close" onClick={onClose} />
              </div>
            </div>
            {header}
            <div className={styles.body}>{children}</div>
            {footer && <div className={styles.footer}>{footer}</div>}
            <AnimatePresence>{overlay}</AnimatePresence>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
