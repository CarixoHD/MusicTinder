import { createHash } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';

// Worktrees share this sandbox, so a fixed default port collides with another
// agent's dev server. PORT still wins; otherwise stay on a stable per-worktree
// port so parallel e2e runs never fight over 5173.
const port =
  Number(process.env.PORT) ||
  5200 + (Number.parseInt(createHash('sha1').update(process.cwd()).digest('hex').slice(0, 6), 16) % 27000);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    colorScheme: 'dark',
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
