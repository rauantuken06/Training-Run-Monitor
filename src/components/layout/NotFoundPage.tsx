import { Link } from 'react-router';
import { paths } from '../../app/paths';

export function NotFoundPage() {
  return (
    <section aria-labelledby="not-found-heading" className="space-y-4">
      <h1 id="not-found-heading" className="text-2xl font-semibold">
        Page not found
      </h1>
      <p className="text-slate-600 dark:text-slate-400">The page you requested does not exist.</p>
      <Link
        to={paths.runs}
        className="inline-block rounded-md font-medium text-sky-700 underline dark:text-sky-400"
      >
        Back to training runs
      </Link>
    </section>
  );
}
