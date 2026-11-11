import { screen } from '@testing-library/react';
import { renderRoute } from '../test/renderRoute';

describe('routing', () => {
  it('loads the runs list page at /', () => {
    renderRoute('/');
    expect(screen.getByRole('heading', { level: 1, name: 'Training runs' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Runs' })).toHaveAttribute('aria-current', 'page');
  });

  it('loads the run details page at /runs/:runId', () => {
    renderRoute('/runs/run-042');
    expect(screen.getByRole('heading', { level: 1, name: 'Run: run-042' })).toBeInTheDocument();
  });

  it('decodes URL-encoded run ids', () => {
    renderRoute('/runs/my%20run');
    expect(screen.getByRole('heading', { level: 1, name: 'Run: my run' })).toBeInTheDocument();
  });

  it('navigates from the list to details and back', async () => {
    const { user, router } = renderRoute('/');

    await user.click(screen.getByRole('link', { name: /example run details/i }));
    expect(router.state.location.pathname).toBe('/runs/example');
    expect(screen.getByRole('heading', { level: 1, name: 'Run: example' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: /all runs/i }));
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByRole('heading', { level: 1, name: 'Training runs' })).toBeInTheDocument();
  });

  it('navigates home via the header link', async () => {
    const { user, router } = renderRoute('/runs/example');
    await user.click(screen.getByRole('link', { name: 'Training Run Monitor' }));
    expect(router.state.location.pathname).toBe('/');
  });

  it('shows a not-found page for unknown routes', () => {
    renderRoute('/does-not-exist');
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
  });
});
