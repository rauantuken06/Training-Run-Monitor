import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '../app/router';
import { analyzeRunCached, RunDataContext, type RunData } from '../features/runs/data/runDataContext';
import { runRepository } from '../features/data/repository/runRepository';

/**
 * Render the real route table at `initialPath` using an in-memory router.
 * `data` overrides the repository and/or the analysis function (defaults: the real ones).
 */
export function renderRoute(initialPath = '/', data: Partial<RunData> = {}) {
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  const user = userEvent.setup();
  const value: RunData = { repository: runRepository, analyze: analyzeRunCached, ...data };
  const ui = (
    <RunDataContext.Provider value={value}>
      <RouterProvider router={router} />
    </RunDataContext.Provider>
  );
  const result = render(ui);
  return { user, router, ui, ...result };
}
