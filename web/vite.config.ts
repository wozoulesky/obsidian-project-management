import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

const mockBundleMarkers = [
  'Task not found:',
  'project-os-skill',
] as const

function productionMockGuard(mode: string): Plugin {
  return {
    name: 'project-os-production-mock-guard',
    generateBundle(_options, bundle) {
      if (mode === 'e2e') return
      const source = Object.values(bundle)
        .flatMap((item) => item.type === 'chunk' ? [item.code] : [])
        .join('\n')
      const marker = mockBundleMarkers.find((value) => source.includes(value))
      if (marker !== undefined) {
        this.error(
          `Production Web bundle contains E2E fixture marker: ${marker}`,
        )
      }
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), productionMockGuard(mode)],
  resolve: {
    alias: {
      '#app-runtime': fileURLToPath(new URL(
        mode === 'e2e' && process.env.VITE_E2E_FIXTURES === 'true'
          ? './src/app/app-runtime.e2e.ts'
          : './src/app/app-runtime.ts',
        import.meta.url,
      )),
      '#repository-default': fileURLToPath(new URL(
        mode === 'test'
        || (
          mode === 'e2e'
          && process.env.VITE_E2E_FIXTURES === 'true'
        )
          ? './src/data/repository-default.fixture.ts'
          : './src/data/repository-default.ts',
        import.meta.url,
      )),
    },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:4310',
    },
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'charts-renderer-core',
              test: /node_modules[\\/]zrender[\\/]/,
              includeDependenciesRecursively: false,
              priority: 20,
            },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/app/test-utils.tsx'],
    css: true,
  },
}))
