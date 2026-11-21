import { defineConfig, devices } from '@playwright/test';
import { createHash } from 'node:crypto';

// Parallel worktrees share one sandbox and each runs its own dev server.
// Derive a stable per-worktree port so they never collide on 5173; PORT wins.
const worktreePort = () => {
  const digest = createHash('md5').update(process.cwd()).digest();
  return 40000 + (digest.readUInt16BE(0) % 20000);
};

const port = Number(process.env.PORT) || worktreePort();

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
