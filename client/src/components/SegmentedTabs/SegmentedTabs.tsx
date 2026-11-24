import { AnimatePresence, motion } from 'motion/react';
import { useId } from 'react';
import { haptics, spring } from '../../lib';
import styles from './SegmentedTabs.module.css';

interface Tab<T extends string> { id: T; label: string; badge?: number }
interface Props<T extends string> { tabs: Tab<T>[]; value: T; onChange: (v: T) => void }

/** Tabs with a pill that glides to the active tab. */
export function SegmentedTabs<T extends string>({ tabs, value, onChange }: Props<T>) {
  const pillId = useId(); // unique per instance so two tab bars never share a pill
  return (
    <div className={styles.tabs} role="tablist">
      {tabs.map(t => (
        <button key={t.id} type="button" role="tab" aria-selected={t.id === value}
          className={`${styles.tab} ${t.id === value ? styles.active : ''}`}
          onClick={() => { if (t.id !== value) { haptics.select(); onChange(t.id); } }}>
          {t.id === value && <motion.span layoutId={pillId} className={styles.pill} transition={spring.smooth} />}
          <span className={styles.label}>
            {t.label}
            <AnimatePresence>
              {!!t.badge && (
                <motion.span key="badge" className={styles.badge}
                  initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={spring.pop}>
                  {t.badge}
                </motion.span>
              )}
            </AnimatePresence>
          </span>
        </button>
      ))}
    </div>
  );
}
