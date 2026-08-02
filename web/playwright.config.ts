import { defineConfig, devices } from '@playwright/test'

function collectSelectedProjects(argv: string[]): string[] {
  const selectedProjects: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!
    if (argument.startsWith('--project=')) {
      const project = argument.slice('--project='.length)
      if (project !== '') selectedProjects.push(project)
      continue
    }
    if (argument !== '--project') continue
    const project = argv[index + 1]
    if (project === undefined || project.startsWith('-')) continue
    selectedProjects.push(project)
    index += 1
  }
  return selectedProjects
}

const selectedProjects = collectSelectedProjects(process.argv.slice(2))
const realJourneysOnly = selectedProjects.length > 0
  && selectedProjects.every((project) => project === 'real-browser-journeys')

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
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
        'failure-recovery.spec.ts',
        'projects-actors-settings.spec.ts',
        'project-deletion-real.spec.ts',
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
        'failure-recovery.spec.ts',
        'projects-actors-settings.spec.ts',
        'project-deletion-real.spec.ts',
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
        'failure-recovery.spec.ts',
        'projects-actors-settings.spec.ts',
        'project-deletion-real.spec.ts',
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
