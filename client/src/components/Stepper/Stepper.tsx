import { AnimatedNumber } from '../AnimatedNumber';
import { Button } from '../Button';
import { haptics } from '../../lib';
import styles from './Stepper.module.css';

interface Props { value: number; min?: number; max?: number; onChange: (v: number) => void; label: string }

export function Stepper({ value, min = 0, max = 99, onChange, label }: Props) {
  const set = (v: number) => { haptics.select(); onChange(Math.max(min, Math.min(max, v))); };
  return (
    <div className={styles.stepper} role="group" aria-label={label}>
      <Button size="icon" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => set(value - 1)}>−</Button>
      <output className={styles.value} aria-live="polite"><AnimatedNumber value={value} /></output>
      <Button size="icon" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => set(value + 1)}>+</Button>
    </div>
  );
}
