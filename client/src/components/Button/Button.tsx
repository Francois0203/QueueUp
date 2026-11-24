import { motion, AnimatePresence, type HTMLMotionProps } from 'motion/react';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../Icon';
import { spring } from '../../lib';
import styles from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'lg' | 'md' | 'sm' | 'icon';

interface BaseProps {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  loading?: boolean;
  block?: boolean;
  children?: ReactNode;
  className?: string;
}

type ButtonProps = BaseProps & Omit<HTMLMotionProps<'button'>, 'children'> & { href?: undefined };
type LinkProps = BaseProps & Omit<HTMLMotionProps<'a'>, 'children'> & { href: string };

export function Button(props: ButtonProps | LinkProps) {
  const { variant = 'secondary', size = 'md', icon, loading, block, children, className = '', ...rest } = props;
  const cls = [styles.btn, styles[variant], styles[size], block && styles.block, loading && styles.loading, className].filter(Boolean).join(' ');
  const content = (
    <>
      <AnimatePresence initial={false}>
        {loading && (
          <motion.span key="spin" className={styles.spinner} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} />
        )}
      </AnimatePresence>
      <span className={styles.label}>
        {icon && <Icon name={icon} size={size === 'sm' || size === 'icon' ? 16 : 18} />}
        {children}
      </span>
    </>
  );
  const motionProps = {
    className: cls,
    whileHover: { y: -1 },
    whileTap: { scale: 0.95, y: 0 },
    transition: spring.snappy,
  };

  if ('href' in rest && rest.href !== undefined) {
    return <motion.a {...motionProps} {...(rest as HTMLMotionProps<'a'>)}>{content}</motion.a>;
  }
  return (
    <motion.button type="button" {...motionProps} {...(rest as HTMLMotionProps<'button'>)} disabled={(rest as HTMLMotionProps<'button'>).disabled || loading} aria-busy={loading || undefined}>
      {content}
    </motion.button>
  );
}
