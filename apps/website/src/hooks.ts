import { useCallback, useState } from 'react';

/** Copy-to-clipboard hook — returns [copied, copy]. */
export function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const copy = useCallback((text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => {
        /* older browsers — silently no-op */
      },
    );
  }, []);
  return [copied, copy];
}
