export type WebRuntimeConfig = {
  serverOrigin: string
  mcpUrl: string
}

type WebEnvironment = Record<string, string | boolean | undefined>

const defaultServerOrigin = 'http://127.0.0.1:4310'
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]'])

function invalidConfiguration(): Error {
  return new Error(
    'Invalid web runtime configuration: VITE_PROJECT_OS_SERVER_URL',
  )
}

export function loadWebRuntimeConfig(
  environment: WebEnvironment,
): WebRuntimeConfig {
  const configured = environment.VITE_PROJECT_OS_SERVER_URL
  const selected = typeof configured === 'string'
    ? configured
    : defaultServerOrigin
  let serverUrl: URL
  try {
    serverUrl = new URL(selected)
  } catch {
    throw invalidConfiguration()
  }
  if (
    serverUrl.protocol !== 'http:'
    || !loopbackHosts.has(serverUrl.hostname)
    || serverUrl.username !== ''
    || serverUrl.password !== ''
    || serverUrl.pathname !== '/'
    || serverUrl.search !== ''
    || serverUrl.hash !== ''
  ) {
    throw invalidConfiguration()
  }
  return {
    serverOrigin: serverUrl.origin,
    mcpUrl: new URL('/mcp', serverUrl.origin).href,
  }
}

export const webRuntimeConfig = loadWebRuntimeConfig(import.meta.env)
