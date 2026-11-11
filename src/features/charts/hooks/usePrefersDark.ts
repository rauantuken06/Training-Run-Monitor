import { useEffect, useState } from 'react';

const QUERY = '(prefers-color-scheme: dark)';

/** Follows the OS color scheme, like the rest of the UI (Tailwind `dark:` variants). */
export function usePrefersDark(): boolean {
  const [dark, setDark] = useState(() => typeof matchMedia === 'function' && matchMedia(QUERY).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(QUERY);
    const onChange = () => {
      setDark(mq.matches);
    };
    mq.addEventListener('change', onChange);
    return () => {
      mq.removeEventListener('change', onChange);
    };
  }, []);
  return dark;
}
