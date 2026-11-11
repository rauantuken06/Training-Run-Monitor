import { Link, useParams } from 'react-router';
import { paths } from '../../../app/paths';

/** Placeholder. Charts and run metadata arrive in later tasks. */
export function RunDetailsPage() {
  const { runId = '' } = useParams<{ runId: string }>();

  return (
    <section aria-labelledby="run-heading" className="space-y-4">
      <nav aria-label="Breadcrumb">
        <Link
          to={paths.runs}
          className="rounded-md text-sm font-medium text-sky-700 underline dark:text-sky-400"
        >
          ← All runs
        </Link>
      </nav>
      <h1 id="run-heading" className="text-2xl font-semibold break-all">
        Run: {runId}
      </h1>
      <p className="text-slate-600 dark:text-slate-400">Run details will be added in a later task.</p>
    </section>
  );
}
