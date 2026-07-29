import { describe, expect, it } from 'vitest'

import { loadWebRuntimeConfig } from './runtime-config'

describe('web runtime config', () => {
  it('keeps the MCP endpoint on the API server when Vite serves port 5173', () => {
    const config = loadWebRuntimeConfig({})
    const viteDevOrigin = 'http://127.0.0.1:5173'

    expect(config.mcpUrl).toBe('http://127.0.0.1:4310/mcp')
    expect(config.mcpUrl).not.toBe(`${viteDevOrigin}/mcp`)
  })

  it('normalizes a validated loopback server origin', () => {
    expect(loadWebRuntimeConfig({
      VITE_PROJECT_OS_SERVER_URL: 'http://localhost:4400/',
    })).toEqual({
      serverOrigin: 'http://localhost:4400',
      mcpUrl: 'http://localhost:4400/mcp',
    })
  })

  it.each([
    'https://example.com:4310',
    'http://127.0.0.1:4310/base',
    'http://user:secret@127.0.0.1:4310',
    'not-a-url',
  ])('rejects unsafe server URL %s', (serverUrl) => {
    expect(() => loadWebRuntimeConfig({
      VITE_PROJECT_OS_SERVER_URL: serverUrl,
    })).toThrow('Invalid web runtime configuration')
  })
})
