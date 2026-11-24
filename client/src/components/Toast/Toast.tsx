import { AnimatePresence, motion } from 'motion/react';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../Icon';
import { spring } from '../../lib';
import styles from './Toast.module.css';

interface ToastItem { id: number; message: string; error: boolean }
type Show = (message: string, opts?: { error?: boolean; ms?: number }) => void;

const ToastContext = createContext<Show>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const show = useCallback<Show>((message, { error = false, ms = 2600 } = {}) => {
    const id = ++seq.current;
    setItems(list => [...list.slice(-2), { id, message, error }]);
    setTimeout(() => setItems(list => list.filter(t => t.id !== id)), ms);
  }, []);

  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.stack} role="status" aria-live="polite">
        <AnimatePresence mode="popLayout">
          {items.map(t => (
            <motion.div key={t.id} layout className={`${styles.toast} ${t.error ? styles.error : ''}`}
              initial={{ opacity: 0, y: -24, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.95, transition: { duration: 0.2 } }}
              transition={spring.pop}>
              <Icon name={t.error ? 'alert' : 'check'} size={16} strokeWidth={2.6} />
              <span>{t.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
