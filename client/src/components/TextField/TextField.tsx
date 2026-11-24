import type { InputHTMLAttributes, ReactNode, Ref } from 'react';
import { Icon, type IconName } from '../Icon';
import styles from './TextField.module.css';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  icon?: IconName;
  /** Element inside the field on the right (button, check mark…). */
  trailing?: ReactNode;
  variant?: 'default' | 'code' | 'pin' | 'mono' | 'subtle';
  valid?: boolean;
  ref?: Ref<HTMLInputElement>;
}

export function TextField({ label, icon, trailing, variant = 'default', valid, className = '', id, ref, ...rest }: Props) {
  const input = (
    <div className={`${styles.wrap} ${icon ? styles.hasIcon : ''} ${trailing ? styles.hasTrailing : ''}`}>
      {icon && <span className={styles.icon}><Icon name={icon} /></span>}
      <input ref={ref} id={id} className={`${styles.input} ${styles[variant]} ${valid ? styles.valid : ''} ${className}`} {...rest} />
      {trailing && <span className={styles.trailing}>{trailing}</span>}
    </div>
  );
  if (!label) return input;
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>{label}</label>
      {input}
    </div>
  );
}
