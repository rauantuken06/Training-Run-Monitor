import { useEffect } from 'react';

const APP_NAME = 'Training Run Monitor';

/** Sets `document.title` to "<title> · Training Run Monitor" while the component is mounted. */
export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;
    return () => {
      document.title = APP_NAME;
    };
  }, [title]);
}
