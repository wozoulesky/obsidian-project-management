import { randomUUID } from 'node:crypto'
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse,
} from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import {
  createProjectOsMcpServer,
} from './create-server.js'
import type {
  ProjectOsMcpServices,
} from './create-server.js'

type Session = {
  activeRequests: number
  closing?: Promise<void>
  lastActiveAt: number
  server: ReturnType<typeof createProjectOsMcpServer>
  transport: StreamableHTTPServerTransport
}

type HttpRequest = IncomingMessage & {
  body?: unknown
}

export type StreamableHttpHandlerOptions = {
  services: ProjectOsMcpServices
  bindingHost: string
  verifyBearer(token: string): boolean
  cleanupIntervalMs?: number
  maxSessions?: number
  sessionIdleTtlMs?: number
  onError?: (error: unknown) => void
}

export type StreamableHttpHandler = {
  handle(
    request: HttpRequest,
    response: ServerResponse,
    parsedBody?: unknown,
  ): Promise<void>
  close(): Promise<void>
  readonly sessionCount: number
}

function header(
  headers: IncomingHttpHeaders,
  name: string,
): string | undefined {
  const value = headers[name]
  return Array.isArray(value) ? undefined : value
}

export function isLoopbackBindingHost(host: string): boolean {
  const normalized = host.startsWith('[') && host.endsWith(']')
    ? host.slice(1, -1)
    : host
  return normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized.toLowerCase() === 'localhost'
}

function bearerToken(
  request: HttpRequest,
): string | undefined {
  const authorization = header(request.headers, 'authorization')
  if (authorization === undefined) {
    return undefined
  }
  const match = /^Bearer ([^\s]+)$/.exec(authorization)
  return match?.[1]
}

function jsonRpcError(
  response: ServerResponse,
  status: number,
  message: string,
): void {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify({
    jsonrpc: '2.0',
    error: {
      code: status === 401 ? -32001 : -32000,
      message,
    },
    id: null,
  }))
}

export function createStreamableHttpHandler(
  options: StreamableHttpHandlerOptions,
): StreamableHttpHandler {
  const sessions = new Map<string, Session>()
  const allSessions = new Set<Session>()
  const bearerRequired = !isLoopbackBindingHost(options.bindingHost)
  const maxSessions = options.maxSessions ?? 100
  const sessionIdleTtlMs = options.sessionIdleTtlMs ?? 15 * 60_000
  const cleanupIntervalMs = options.cleanupIntervalMs
    ?? Math.min(60_000, sessionIdleTtlMs)
  if (!Number.isSafeInteger(maxSessions) || maxSessions < 1) {
    throw new RangeError('maxSessions must be a positive integer')
  }
  if (!Number.isSafeInteger(sessionIdleTtlMs) || sessionIdleTtlMs < 1) {
    throw new RangeError('sessionIdleTtlMs must be a positive integer')
  }
  if (!Number.isSafeInteger(cleanupIntervalMs) || cleanupIntervalMs < 1) {
    throw new RangeError('cleanupIntervalMs must be a positive integer')
  }
  let closed = false
  let cleanup: Promise<void> | undefined

  const authenticate = (
    request: HttpRequest,
    response: ServerResponse,
  ): boolean => {
    const authorization = header(request.headers, 'authorization')
    const token = bearerToken(request)
    if (
      (bearerRequired && token === undefined)
      || (authorization !== undefined && token === undefined)
      || (token !== undefined && !options.verifyBearer(token))
    ) {
      response.setHeader('WWW-Authenticate', 'Bearer')
      jsonRpcError(response, 401, 'Bearer authentication is required')
      return false
    }
    return true
  }

  const closeSession = async (session: Session): Promise<void> => {
    session.closing ??= (async () => {
      const sessionId = session.transport.sessionId
      if (
        sessionId !== undefined
        && sessions.get(sessionId) === session
      ) {
        sessions.delete(sessionId)
      }
      allSessions.delete(session)
      await session.server.close()
    })()
    await session.closing
  }

  const createSession = async (): Promise<Session> => {
    let session: Session
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized(sessionId) {
        sessions.set(sessionId, session)
      },
    })
    const server = createProjectOsMcpServer(options.services)
    session = {
      activeRequests: 0,
      lastActiveAt: Date.now(),
      server,
      transport,
    }
    allSessions.add(session)
    server.server.onclose = () => {
      const sessionId = transport.sessionId
      if (
        sessionId !== undefined
        && sessions.get(sessionId) === session
      ) {
        sessions.delete(sessionId)
      }
      allSessions.delete(session)
    }
    try {
      await server.connect(
        transport as Parameters<typeof server.connect>[0],
      )
    } catch (error) {
      allSessions.delete(session)
      throw error
    }
    return session
  }

  const sweepIdleSessions = async (): Promise<void> => {
    if (closed || cleanup !== undefined) {
      return cleanup
    }
    const cutoff = Date.now() - sessionIdleTtlMs
    const idle = [...sessions.values()].filter((session) =>
      session.activeRequests === 0
      && session.lastActiveAt <= cutoff)
    cleanup = Promise.allSettled(idle.map(closeSession))
      .then(() => undefined)
      .finally(() => {
        cleanup = undefined
      })
    return cleanup
  }
  const cleanupTimer = setInterval(() => {
    void sweepIdleSessions().catch(options.onError)
  }, cleanupIntervalMs)
  cleanupTimer.unref()

  return {
    get sessionCount() {
      return sessions.size
    },
    async handle(request, response, parsedBody = request.body) {
      if (closed) {
        jsonRpcError(response, 503, 'MCP transport is closed')
        return
      }
      if (!authenticate(request, response)) {
        return
      }

      const method = request.method ?? 'GET'
      if (method !== 'POST' && method !== 'GET' && method !== 'DELETE') {
        response.setHeader('Allow', 'POST, GET, DELETE')
        jsonRpcError(response, 405, 'Method not allowed')
        return
      }

      const sessionId = header(request.headers, 'mcp-session-id')
      let session = sessionId === undefined
        ? undefined
        : sessions.get(sessionId)

      try {
        if (
          method === 'POST'
          && session === undefined
          && sessionId === undefined
          && isInitializeRequest(parsedBody)
        ) {
          if (allSessions.size >= maxSessions) {
            jsonRpcError(response, 503, 'MCP session capacity reached')
            return
          }
          session = await createSession()
          session.activeRequests += 1
          try {
            await session.transport.handleRequest(
              request,
              response,
              parsedBody,
            )
          } finally {
            session.activeRequests -= 1
            session.lastActiveAt = Date.now()
          }
          if (session.transport.sessionId === undefined) {
            await closeSession(session)
          }
          return
        }

        if (session === undefined) {
          if (sessionId === undefined) {
            jsonRpcError(response, 400, 'MCP session ID is required')
          } else {
            jsonRpcError(response, 404, 'MCP session was not found')
          }
          return
        }

        session.lastActiveAt = Date.now()
        session.activeRequests += 1
        try {
          await session.transport.handleRequest(
            request,
            response,
            method === 'POST' ? parsedBody : undefined,
          )
        } finally {
          session.activeRequests -= 1
          session.lastActiveAt = Date.now()
        }
      } catch (error) {
        options.onError?.(error)
        if (session !== undefined && session.transport.sessionId === undefined) {
          await closeSession(session)
        }
        if (!response.headersSent) {
          jsonRpcError(response, 500, 'Internal MCP transport error')
        }
      }
    },
    async close() {
      if (closed) {
        return
      }
      closed = true
      clearInterval(cleanupTimer)
      await cleanup
      const active = [...allSessions]
      sessions.clear()
      await Promise.allSettled(
        active.map(async (session) => {
          await session.server.close()
        }),
      )
    },
  }
}
