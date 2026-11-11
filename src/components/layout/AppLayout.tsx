import { Link, NavLink, Outlet } from 'react-router';
import { paths } from '../../app/paths';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  [
    'rounded-md px-3 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-white'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white',
  ].join(' ');

export function AppLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main-content"
        className="sr-only rounded-md bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to main content
      </a>

      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6 lg:px-8">
          <Link to={paths.runs} className="rounded-md text-lg font-semibold tracking-tight">
            Training Run Monitor
          </Link>
          <nav aria-label="Primary">
            <ul className="flex items-center gap-1">
              <li>
                <NavLink to={paths.runs} end className={navLinkClass}>
                  Runs
                </NavLink>
              </li>
            </ul>
          </nav>
        </div>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 focus:outline-none sm:px-6 lg:px-8"
      >
        <Outlet />
      </main>
    </div>
  );
}
