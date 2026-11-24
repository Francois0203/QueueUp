import { motion } from 'motion/react';
import { useState } from 'react';
import { AnimatedNumber } from '../AnimatedNumber';
import { Burst } from '../Burst';
import { Icon } from '../Icon';
import { haptics, spring } from '../../lib';
import styles from './VoteButton.module.css';

interface Props {
  votes: number;
  voted: boolean;
  disabled?: boolean;
  onToggle: () => void;
}

export function VoteButton({ votes, voted, disabled, onToggle }: Props) {
  const [pops, setPops] = useState(0);
  return (
    <motion.button
      type="button"
      className={`${styles.vote} ${voted ? styles.on : ''}`}
      aria-pressed={voted}
      aria-label={`${voted ? 'Remove vote' : 'Vote'} (${votes} ${votes === 1 ? 'vote' : 'votes'})`}
      disabled={disabled}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.86 }}
      transition={spring.snappy}
      onClick={() => {
        if (!voted) { setPops(p => p + 1); haptics.vote(); } else haptics.tap();
        onToggle();
      }}
    >
      <motion.span animate={{ y: voted ? -2 : 0 }} transition={spring.pop} className={styles.arrow}>
        <Icon name="up" size={16} strokeWidth={2.6} />
      </motion.span>
      <AnimatedNumber value={votes} />
      <Burst trigger={pops} />
    </motion.button>
  );
}
