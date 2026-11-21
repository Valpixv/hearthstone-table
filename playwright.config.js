import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 5174);

// Headless Chromium replay tests. The app is served by `npm run dev:http` (plain http on
// localhost, still a secure context) so there is no self-signed certificate to accept.
export default defineConfig({
  testDir: 'tests/e2e',
  // Generous: software WebGL on a busy machine (or a 2-core CI runner) can be slow to boot.
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  // Each page is a full 3D browser. Several at once ran this PC out of memory (Windows refused new processes:
  // 0xC0000142, "Target crashed"), so locally they run one at a time. E2E_WORKERS=3 overrides.
  workers: Number(process.env.E2E_WORKERS) || (process.env.CI ? 2 : 1),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    // Small canvas: the tests assert on physics state, not pixels, and SwiftShader cost scales with it.
    viewport: { width: 480, height: 320 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Software WebGL so three.js renders on CI machines without a GPU.
        // E2E_GPU=1 uses the machine's own graphics card (much faster locally); CI keeps software WebGL.
        launchOptions: { args: process.env.E2E_GPU ? ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
      },
    },
  ],
  webServer: {
    command: `npx vite --mode http --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
