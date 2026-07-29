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
  const bearerRequired = !isLoopbackBindingHost(options.bindingHost)
  let closed = false

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
    const sessionId = session.transport.sessionId
    if (
      sessionId !== undefined
      && sessions.get(sessionId) === session
    ) {
      sessions.delete(sessionId)
    }
    await session.server.close()
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
    session = { server, transport }
    server.server.onclose = () => {
      const sessionId = transport.sessionId
      if (
        sessionId !== undefined
        && sessions.get(sessionId) === session
      ) {
        sessions.delete(sessionId)
      }
    }
    await server.connect(
      transport as Parameters<typeof server.connect>[0],
    )
    return session
  }

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
          session = await createSession()
          await session.transport.handleRequest(
            request,
            response,
            parsedBody,
          )
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

        await session.transport.handleRequest(
          request,
          response,
          method === 'POST' ? parsedBody : undefined,
        )
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
      const active = [...sessions.values()]
      sessions.clear()
      await Promise.allSettled(
        active.map(async (session) => {
          await session.server.close()
        }),
      )
    },
  }
}
