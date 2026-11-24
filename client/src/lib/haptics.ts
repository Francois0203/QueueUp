/** Tiny vibration patterns. Silently ignored where unsupported (e.g. iOS Safari). */
const vibrate = (pattern: number | number[]) => { try { navigator.vibrate?.(pattern); } catch { /* unsupported */ } };

export const haptics = {
  tap: () => vibrate(6),
  select: () => vibrate(4),
  success: () => vibrate([10, 40, 16]),
  error: () => vibrate([20, 40, 20]),
  vote: () => vibrate([6, 30, 10]),
};
