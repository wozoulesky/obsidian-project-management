import { defineConfig, devices } from '@playwright/test'

const realJourneysOnly = process.argv.some(
  (argument) => argument === '--project=real-browser-journeys',
)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    channel: 'chromium',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: [
        'projects-actors-settings.spec.ts',
        'quick-submit-real.spec.ts',
      ],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'compact',
      testIgnore: [
        'projects-actors-settings.spec.ts',
        'quick-submit-real.spec.ts',
      ],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1024, height: 768 },
      },
    },
    {
      name: 'real-browser-journeys',
      testMatch: [
        'projects-actors-settings.spec.ts',
        'quick-submit-real.spec.ts',
      ],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: realJourneysOnly ? undefined : {
    command: 'node ../scripts/e2e-server.mjs',
    env: {
      VITE_E2E_FIXTURES: 'true',
    },
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
