import { describe, expect, it } from 'vitest';
import { createRunRepository } from '../data/repository/runRepository';
import { applyQuery, DEFAULT_QUERY, parseQuery, queryToParams, type RunListQuery } from './runListQuery';

const runs = createRunRepository().listRuns();
const ids = (q: Partial<RunListQuery>) => applyQuery(runs, { ...DEFAULT_QUERY, ...q }).map((r) => r.id);

describe('applyQuery on the real catalog metadata', () => {
  it('returns all 20 runs in ID order by default', () => {
    expect(ids({})).toEqual(Array.from({ length: 20 }, (_, i) => `run-${String(i + 1).padStart(2, '0')}`));
  });

  it('searches name and ID case-insensitively', () => {
    expect(ids({ search: 'NAN-LOSS' })).toEqual(['run-11', 'run-12']);
    expect(ids({ search: ' run-2 ' })).toEqual(['run-20']);
    expect(ids({ search: 'no such run' })).toEqual([]);
  });

  it('filters by status and declared data quality', () => {
    expect(ids({ status: 'failed' })).toEqual(['run-09', 'run-12', 'run-14', 'run-19']);
    expect(ids({ quality: 'duplicate_steps' })).toEqual(['run-15', 'run-19']);
    expect(ids({ quality: 'clean' })).toEqual(['run-01', 'run-02', 'run-03', 'run-04', 'run-05', 'run-06', 'run-07', 'run-08', 'run-09', 'run-10', 'run-20']);
    expect(ids({ quality: 'any' })).toHaveLength(9);
  });

  it('combines search, status and quality', () => {
    expect(ids({ status: 'failed', quality: 'nan_loss' })).toEqual(['run-12', 'run-19']);
    expect(ids({ status: 'failed', quality: 'nan_loss', search: 'corrupt' })).toEqual(['run-19']);
  });

  it('sorts numerically by point count, and ties fall back to ID', () => {
    expect(ids({ sort: 'points', direction: 'desc' }).slice(0, 4)).toEqual(['run-20', 'run-03', 'run-15', 'run-01']);
    expect(ids({ sort: 'points' }).slice(0, 3)).toEqual(['run-04', 'run-17', 'run-19']);
  });

  it('sorts by name and status label', () => {
    expect(ids({ sort: 'name' })[0]).toBe('run-01'); // baseline-350m-lr3e-4
    const byStatus = applyQuery(runs, { ...DEFAULT_QUERY, sort: 'status' }).map((r) => r.status);
    expect([...new Set(byStatus)]).toEqual(['completed', 'failed', 'running', 'stopped']);
  });
});

describe('URL round-trip', () => {
  it('round-trips a query and omits defaults', () => {
    const q: RunListQuery = { search: 'loss', status: 'failed', quality: 'nan_loss', sort: 'points', direction: 'desc' };
    expect(parseQuery(queryToParams(q))).toEqual(q);
    expect(queryToParams(DEFAULT_QUERY).toString()).toBe('');
  });

  it('ignores invalid parameters instead of throwing', () => {
    expect(parseQuery(new URLSearchParams('status=exploded&quality=nope&sort=x&dir=up'))).toEqual(DEFAULT_QUERY);
  });
});
