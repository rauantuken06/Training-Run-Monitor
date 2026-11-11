import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '../app/router';

/** Render the real route table at `initialPath` using an in-memory router. */
export function renderRoute(initialPath = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  const user = userEvent.setup();
  return { user, router, ...render(<RouterProvider router={router} />) };
}
