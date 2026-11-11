import type { RunScenario, RunStatus, TrainingRunMetadata } from '../../types/training';
import { STATUS_LABEL } from './labels';

/**
 * Search, filter and sort for the runs list. Works on metadata only: no run
 * points are loaded. The query round-trips through URL search params, so
 * filters survive reloads and back navigation.
 */

export type SortKey = 'id' | 'name' | 'status' | 'points';
export type SortDirection = 'asc' | 'desc';
export type StatusFilter = 'all' | RunStatus;

/** Scenario tags that describe data-quality anomalies (as opposed to curve behaviour). */
export const ANOMALY_SCENARIOS = [
  'nan_loss',
  'infinite_loss',
  'missing_values',
  'missing_steps',
  'duplicate_steps',
  'unsorted_steps',
] as const satisfies readonly RunScenario[];
export type AnomalyScenario = (typeof ANOMALY_SCENARIOS)[number];

/** `clean`: no declared anomaly; `any`: at least one; otherwise a specific anomaly. */
export type QualityFilter = 'all' | 'clean' | 'any' | AnomalyScenario;

export interface RunListQuery {
  readonly search: string;
  readonly status: StatusFilter;
  readonly quality: QualityFilter;
  readonly sort: SortKey;
  readonly direction: SortDirection;
}

export const DEFAULT_QUERY: RunListQuery = {
  search: '',
  status: 'all',
  quality: 'all',
  sort: 'id',
  direction: 'asc',
};

export const SORT_KEYS: readonly SortKey[] = ['id', 'name', 'status', 'points'];
export const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'running', 'completed', 'failed', 'stopped'];
export const QUALITY_FILTERS: readonly QualityFilter[] = ['all', 'clean', 'any', ...ANOMALY_SCENARIOS];

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Unknown or malformed params fall back to defaults; they never throw. */
export function parseQuery(params: URLSearchParams): RunListQuery {
  return {
    search: params.get('q') ?? DEFAULT_QUERY.search,
    status: oneOf(params.get('status'), STATUS_FILTERS, DEFAULT_QUERY.status),
    quality: oneOf(params.get('quality'), QUALITY_FILTERS, DEFAULT_QUERY.quality),
    sort: oneOf(params.get('sort'), SORT_KEYS, DEFAULT_QUERY.sort),
    direction: oneOf(params.get('dir'), ['asc', 'desc'] as const, DEFAULT_QUERY.direction),
  };
}

/** Only non-default values are written, so the default list has a clean URL. */
export function queryToParams(query: RunListQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.search !== DEFAULT_QUERY.search) params.set('q', query.search);
  if (query.status !== DEFAULT_QUERY.status) params.set('status', query.status);
  if (query.quality !== DEFAULT_QUERY.quality) params.set('quality', query.quality);
  if (query.sort !== DEFAULT_QUERY.sort) params.set('sort', query.sort);
  if (query.direction !== DEFAULT_QUERY.direction) params.set('dir', query.direction);
  return params;
}

export function hasActiveFilters(query: RunListQuery): boolean {
  return query.search.trim() !== '' || query.status !== 'all' || query.quality !== 'all';
}

/** Anomalies a run was declared to contain (from metadata; not detected). */
export function declaredAnomalies(run: TrainingRunMetadata): AnomalyScenario[] {
  return ANOMALY_SCENARIOS.filter((s) => run.scenarios.includes(s));
}

function matchesQuality(run: TrainingRunMetadata, quality: QualityFilter): boolean {
  if (quality === 'all') return true;
  const anomalies = declaredAnomalies(run);
  if (quality === 'clean') return anomalies.length === 0;
  if (quality === 'any') return anomalies.length > 0;
  return anomalies.includes(quality);
}

const nameCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function compare(a: TrainingRunMetadata, b: TrainingRunMetadata, key: SortKey): number {
  switch (key) {
    case 'id':
      return nameCollator.compare(a.id, b.id);
    case 'name':
      return nameCollator.compare(a.name, b.name);
    case 'status':
      return nameCollator.compare(STATUS_LABEL[a.status], STATUS_LABEL[b.status]);
    case 'points':
      return a.pointCount - b.pointCount;
  }
}

/**
 * Filter then sort. Search is a case-insensitive substring match on name or ID.
 * Ties always fall back to ascending ID, so the order is deterministic.
 */
export function applyQuery(
  runs: readonly TrainingRunMetadata[],
  query: RunListQuery,
): TrainingRunMetadata[] {
  const needle = query.search.trim().toLowerCase();
  const sign = query.direction === 'asc' ? 1 : -1;
  return runs
    .filter(
      (run) =>
        (needle === '' || run.name.toLowerCase().includes(needle) || run.id.toLowerCase().includes(needle)) &&
        (query.status === 'all' || run.status === query.status) &&
        matchesQuality(run, query.quality),
    )
    .sort((a, b) => sign * compare(a, b, query.sort) || nameCollator.compare(a.id, b.id));
}
