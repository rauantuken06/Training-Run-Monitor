import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App', () => {
  it('renders the application shell', () => {
    window.history.replaceState(null, '', '/');
    render(<App />);

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Training Run Monitor' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});
