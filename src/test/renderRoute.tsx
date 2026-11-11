import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '../app/router';
import { analyzeRunCached, RunDataContext, type RunData } from '../features/runs/data/runDataContext';
import { runRepository } from '../features/data/repository/runRepository';
// The run page lazy-loads its charts (Task 08 code splitting). Importing the chunk here
// mirrors the page's own preload and evaluates the large ECharts module graph once,
// outside individual tests' time budgets. Charts still appear asynchronously (Suspense),
// so tests that need them use `findBy…`.
import '../features/charts/components/RunCharts';

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
