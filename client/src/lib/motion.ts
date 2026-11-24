import type { Transition } from 'motion/react';

/** Shared motion language, so the whole app moves the same way. */
export const spring = {
  /** Snappy UI feedback: buttons, toggles, counters. */
  snappy: { type: 'spring', bounce: 0.3, visualDuration: 0.25 } as Transition,
  /** Default for elements moving around: list items, cards. */
  smooth: { type: 'spring', bounce: 0.15, visualDuration: 0.4 } as Transition,
  /** Large surfaces: sheets, pages. No overshoot. */
  surface: { type: 'spring', bounce: 0, visualDuration: 0.45 } as Transition,
  /** Playful pops: badges, success marks. */
  pop: { type: 'spring', bounce: 0.5, visualDuration: 0.35 } as Transition,
};

export const ease = {
  out: [0.16, 1, 0.3, 1] as const,
};

/** Quick, light swap for big containers (tab panels): no blur, which is costly on large areas. */
export const panel = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.12 } },
};

/** Fade + rise + un-blur, used for content that appears. */
export const rise = {
  initial: { opacity: 0, y: 12, filter: 'blur(6px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: -8, filter: 'blur(4px)' },
};
