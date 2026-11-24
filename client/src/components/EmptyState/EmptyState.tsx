import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../Icon';
import { rise, spring } from '../../lib';
import styles from './EmptyState.module.css';

export function EmptyState({ icon = 'note', title, children }: { icon?: IconName; title: string; children?: ReactNode }) {
  return (
    <motion.div className={styles.empty} {...rise} transition={spring.smooth}>
      <div className={styles.icon}><Icon name={icon} size={24} /></div>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </motion.div>
  );
}
