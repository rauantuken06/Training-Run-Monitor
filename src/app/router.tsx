import { createBrowserRouter, type RouteObject } from 'react-router';
import { AppLayout } from '../components/layout/AppLayout';
import { NotFoundPage } from '../components/layout/NotFoundPage';
import { RunDetailsPage } from '../features/runs/pages/RunDetailsPage';
import { RunsListPage } from '../features/runs/pages/RunsListPage';

/** Route table, shared by the browser router and in-memory test routers. */
export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <RunsListPage /> },
      { path: 'runs/:runId', element: <RunDetailsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
