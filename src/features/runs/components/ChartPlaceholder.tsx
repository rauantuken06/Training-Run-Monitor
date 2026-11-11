/**
 * Reserved, stable area for a metric chart. Draws nothing chart-like on purpose:
 * charts are not implemented yet, and an illustrative curve would look like data.
 */
export function ChartPlaceholder({ id, title }: { id: string; title: string }) {
  const headingId = `${id}-heading`;
  return (
    <section aria-labelledby={headingId} className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h3 id={headingId} className="text-sm font-semibold">
        {title} chart
      </h3>
      <div className="mt-3 flex h-48 items-center justify-center rounded-md border border-dashed border-slate-300 px-4 text-center text-sm text-slate-600 sm:h-56 dark:border-slate-700 dark:text-slate-400">
        Chart not implemented yet. Values are summarized above.
      </div>
    </section>
  );
}
