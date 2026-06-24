import { defineConfig, devices } from '@playwright/test';

// E2E durability test runs against the PRODUCTION build served by `vite preview`,
// in real headless Chromium (OPFS + workers behave as in production).
const PORT = 4173;

export default defineConfig({
  testDir: 'tests',
  testMatch: '**/*.e2e.spec.js',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    trace: 'retain-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000
  }
});
