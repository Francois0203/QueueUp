import { useCallback, useState } from 'react';
import { haptics } from '../lib';

/** Copy to clipboard with a short "copied" state for button feedback. */
export function useCopy(resetMs = 1400) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback(async (text: string, key = text) => {
    try {
      await navigator.clipboard.writeText(text);
      haptics.tap();
      setCopied(key);
      setTimeout(() => setCopied(c => (c === key ? null : c)), resetMs);
      return true;
    } catch {
      return false;
    }
  }, [resetMs]);
  return { copy, copied };
}
