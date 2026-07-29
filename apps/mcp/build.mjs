import { rm } from 'node:fs/promises'
import { build } from 'esbuild'

const shared = {
  bundle: true,
  external: [
    '@modelcontextprotocol/sdk/*',
    'zod',
  ],
  format: 'esm',
  logLevel: 'info',
  outdir: 'dist',
  platform: 'node',
  sourcemap: true,
  target: 'node24',
}

await rm('dist', { force: true, recursive: true })

await build({
  ...shared,
  entryPoints: {
    index: 'src/index.ts',
  },
})

await build({
  ...shared,
  banner: {
    js: '#!/usr/bin/env node',
  },
  entryPoints: {
    stdio: 'src/stdio.ts',
  },
})
