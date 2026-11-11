import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Optional: use an installed browser instead of Playwright's bundled build,
 * e.g. `PW_CHANNEL=chrome` or `PW_CHANNEL=msedge` when browser downloads are blocked.
 */
const channel = process.env.PW_CHANNEL;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], ...(channel ? { channel } : {}) } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], ...(channel ? { channel } : {}) } },
  ],
  webServer: {
    // Runs against the production build so e2e covers what gets deployed.
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
