import { Link } from 'react-router';
import { paths } from '../../../app/paths';

/**
 * Placeholder. The real list (20 runs, sorting, filtering) arrives in a later task.
 * The single link below exists only to exercise routing; it is not run data.
 */
export function RunsListPage() {
  return (
    <section aria-labelledby="runs-heading" className="space-y-4">
      <h1 id="runs-heading" className="text-2xl font-semibold">
        Training runs
      </h1>
      <p className="text-slate-600 dark:text-slate-400">
        No runs loaded yet. Run data will be added in a later task.
      </p>
      <Link
        to={paths.runDetails('example')}
        className="inline-block rounded-md font-medium text-sky-700 underline dark:text-sky-400"
      >
        Open example run details (routing demo)
      </Link>
    </section>
  );
}
