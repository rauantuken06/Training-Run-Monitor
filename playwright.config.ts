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
  // Firefox: 2 workers. With 4, axe scans (3.5–6 s each in Playwright's Firefox, measured in
  // Task 09) and chart loads competed for CPU and timed out (6–7 of 41 tests, reproduced twice).
  ...(process.env.PW_BROWSER === 'firefox' ? { workers: 2 } : {}),
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  // PW_BROWSER=firefox runs the suite in desktop Firefox (Playwright's Firefox build;
  // Firefox has no mobile-emulation project). Default: Chromium desktop + mobile.
  projects:
    process.env.PW_BROWSER === 'firefox'
      ? [{ name: 'firefox', use: { ...devices['Desktop Firefox'] } }]
      : [
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
