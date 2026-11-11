import { useState } from 'react';
import { RouterProvider } from 'react-router';
import { createAppRouter } from './router';

export function App() {
  // Created once per mounted App (lazy initializer), not at module load.
  const [router] = useState(createAppRouter);
  return <RouterProvider router={router} />;
}
