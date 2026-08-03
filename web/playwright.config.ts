import { defineConfig, devices } from '@playwright/test'

const PROJECT_NAMES = {
  desktop: 'desktop',
  compact: 'compact',
  realJourneys: 'real-browser-journeys',
} as const

const allProjectNames = Object.values(PROJECT_NAMES)

function collectProjectPatterns(argv: string[]): {
  patterns: string[]
  valid: boolean
} {
  const projectPatterns: string[] = []
  let valid = true
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!
    if (argument.startsWith('--project=')) {
      const pattern = argument.slice('--project='.length)
      if (pattern === '') valid = false
      else projectPatterns.push(pattern)
      continue
    }
    if (argument !== '--project') continue
    let foundPattern = false
    while (
      argv[index + 1] !== undefined
      && !argv[index + 1]!.startsWith('-')
    ) {
      foundPattern = true
      projectPatterns.push(argv[index + 1]!)
      index += 1
    }
    if (!foundPattern) valid = false
  }
  return { patterns: projectPatterns, valid }
}

function matchesProjectPattern(projectName: string, pattern: string): boolean {
  const expression = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${expression}$`).test(projectName)
}

export function selectsOnlyRealJourneys(argv: string[]): boolean {
  const selection = collectProjectPatterns(argv)
  if (!selection.valid || selection.patterns.length === 0) return false
  const selectedProjects = new Set<string>()
  for (const pattern of selection.patterns) {
    const matches = allProjectNames.filter((projectName) =>
      matchesProjectPattern(projectName, pattern),
    )
    if (matches.length === 0) return false
    for (const projectName of matches) selectedProjects.add(projectName)
  }
  return selectedProjects.size === 1
    && selectedProjects.has(PROJECT_NAMES.realJourneys)
}

const realJourneysOnly = selectsOnlyRealJourneys(process.argv.slice(2))

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
      name: PROJECT_NAMES.desktop,
      testIgnore: [
        'failure-recovery.spec.ts',
        'projects-actors-settings.spec.ts',
        'project-deletion-real.spec.ts',
        'quick-submit-real.spec.ts',
        'task-multiview-real.spec.ts',
      ],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: PROJECT_NAMES.compact,
      testIgnore: [
        'failure-recovery.spec.ts',
        'projects-actors-settings.spec.ts',
        'project-deletion-real.spec.ts',
        'quick-submit-real.spec.ts',
        'task-multiview-real.spec.ts',
      ],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1024, height: 768 },
      },
    },
    {
      name: PROJECT_NAMES.realJourneys,
      testMatch: [
        'failure-recovery.spec.ts',
        'projects-actors-settings.spec.ts',
        'project-deletion-real.spec.ts',
        'quick-submit-real.spec.ts',
        'task-multiview-real.spec.ts',
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
