import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PORT) || 5173;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    serviceWorkers: 'block',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
  },
});
