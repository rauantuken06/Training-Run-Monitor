import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderRoute } from '../test/renderRoute';

describe('routing', () => {
  it('loads the runs list page at /', () => {
    renderRoute('/');
    expect(screen.getByRole('heading', { level: 1, name: 'Training runs' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Runs' })).toHaveAttribute('aria-current', 'page');
  });

  it('loads the run details page at /runs/:runId', () => {
    renderRoute('/runs/run-07');
    expect(screen.getByRole('heading', { level: 1, name: 'plateau-lr-too-low' })).toBeInTheDocument();
  });

  it('decodes URL-encoded run IDs (an unknown one shows the run 404)', () => {
    renderRoute('/runs/my%20run');
    expect(screen.getByRole('heading', { level: 1, name: 'Run not found' })).toBeInTheDocument();
    expect(screen.getByText('my run')).toBeInTheDocument();
  });

  it('navigates from the list to details and back', async () => {
    const { user, router } = renderRoute('/');

    await user.click(screen.getByRole('link', { name: 'baseline-350m-lr3e-4' }));
    expect(router.state.location.pathname).toBe('/runs/run-01');
    expect(screen.getByRole('heading', { level: 1, name: 'baseline-350m-lr3e-4' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: /All runs/ }));
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByRole('heading', { level: 1, name: 'Training runs' })).toBeInTheDocument();
  });

  it('navigates home via the header link', async () => {
    const { user, router } = renderRoute('/runs/run-01');
    await user.click(screen.getByRole('link', { name: 'Training Run Monitor' }));
    expect(router.state.location.pathname).toBe('/');
  });

  it('shows a not-found page for unknown routes', () => {
    renderRoute('/does-not-exist');
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
  });
});
