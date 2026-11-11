import { useState, type SyntheticEvent } from 'react';
import type { Viewport } from '../../data/downsampling/downsample';
import { formatCount } from '../../runs/format';
import { isFullViewport, panViewport, zoomViewport, type StepExtent } from '../model/viewport';

const buttonClass =
  'rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800';
const inputClass =
  'w-28 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';

/** Keyboard-operable zoom, pan and reset for the shared chart viewport. */
export function ChartControls({
  viewport,
  extent,
  onChange,
}: {
  viewport: Viewport;
  extent: StepExtent;
  onChange: (vp: Viewport) => void;
}) {
  const full = isFullViewport(viewport, extent);
  const span = viewport.maxStep - viewport.minStep;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);

  const applyRange = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const a = Number(from.replace(/,/g, ''));
    const b = Number(to.replace(/,/g, ''));
    if (from.trim() === '' || to.trim() === '' || !Number.isFinite(a) || !Number.isFinite(b)) {
      setError('Enter two step numbers.');
      return;
    }
    if (a >= b) {
      setError('"From" must be smaller than "To".');
      return;
    }
    setError(null);
    onChange({ minStep: a, maxStep: b });
  };

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Chart zoom">
        <button type="button" className={buttonClass} disabled={span <= 1} onClick={() => { onChange(zoomViewport(viewport, 0.5, extent)); }}>
          Zoom in
        </button>
        <button type="button" className={buttonClass} disabled={full} onClick={() => { onChange(zoomViewport(viewport, 2, extent)); }}>
          Zoom out
        </button>
        <button type="button" className={buttonClass} disabled={viewport.minStep <= extent.min} onClick={() => { onChange(panViewport(viewport, -0.25, extent)); }}>
          ← Pan left
        </button>
        <button type="button" className={buttonClass} disabled={viewport.maxStep >= extent.max} onClick={() => { onChange(panViewport(viewport, 0.25, extent)); }}>
          Pan right →
        </button>
        <button type="button" className={buttonClass} disabled={full} onClick={() => { onChange({ minStep: extent.min, maxStep: extent.max }); }}>
          Reset zoom
        </button>
        <p role="status" aria-live="polite" className="text-sm text-slate-700 dark:text-slate-300">
          Showing steps {formatCount(viewport.minStep)}–{formatCount(viewport.maxStep)}
          {full ? ' (full run)' : ` of ${formatCount(extent.min)}–${formatCount(extent.max)}`}
        </p>
      </div>
      <form className="flex flex-wrap items-end gap-2" onSubmit={applyRange} aria-label="Zoom to a step range">
        <label className="text-sm text-slate-700 dark:text-slate-300">
          From step
          <input className={`${inputClass} ml-1`} inputMode="numeric" value={from} onChange={(e) => { setFrom(e.target.value); }} />
        </label>
        <label className="text-sm text-slate-700 dark:text-slate-300">
          To step
          <input className={`${inputClass} ml-1`} inputMode="numeric" value={to} onChange={(e) => { setTo(e.target.value); }} />
        </label>
        <button type="submit" className={buttonClass}>
          Apply range
        </button>
        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
