import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { seedDatabase } from '@project-os/core'
import { createApp } from './app.js'
import type { ProjectOsApp } from './app.js'
import { loadConfig } from './config.js'
import type { ServerConfig } from './config.js'
import {
  createAppContext,
  defaultSeedDocument,
} from './context.js'

async function listen(
  server: Server,
  config: ServerConfig,
): Promise<void> {
  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (error: Error) => {
      rejectListen(error)
    }
    server.once('error', onError)
    server.listen(config.port, config.host, () => {
      server.off('error', onError)
      resolveListen()
    })
  })
}

export async function startServer(config: ServerConfig) {
  const context = createAppContext(config)
  let app: ProjectOsApp | undefined
  let server: Server | undefined

  try {
    seedDatabase(context.database, defaultSeedDocument)
    app = createApp({
      context,
      ...(config.allowedHosts === undefined
        ? {}
        : { allowedHosts: config.allowedHosts }),
      ...(config.allowedOrigins === undefined
        ? {}
        : { allowedOrigins: config.allowedOrigins }),
      mcpBindingHost: config.host,
    })
    server = createServer(app)
    await listen(server, config)
  } catch (error) {
    await app?.mcp.close().catch(() => undefined)
    if (server?.listening === true) {
      await new Promise<void>((resolveClose) => {
        server!.close(() => resolveClose())
      })
    }
    context.close()
    throw error
  }

  let closing: Promise<void> | undefined
  const close = () => {
    closing ??= (async () => {
      let closeError: unknown
      try {
        await app!.mcp.close()
      } catch (error) {
        closeError = error
      }
      await new Promise<void>((resolveClose) => {
        server!.close((error) => {
          closeError ??= error
          resolveClose()
        })
      })
      try {
        context.close()
      } catch (error) {
        closeError ??= error
      }
      if (closeError !== undefined) {
        throw closeError
      }
    })()
    return closing
  }

  return { app, server, context, close }
}

async function main(): Promise<void> {
  const config = loadConfig()
  const runtime = await startServer(config)
  const onSignal = () => {
    void runtime.close().catch(() => {
      process.exitCode = 1
    })
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  runtime.server.once('close', () => {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  })
}

const entrypoint = process.argv[1]
if (
  entrypoint !== undefined
  && pathToFileURL(resolve(entrypoint)).href === import.meta.url
) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error
      ? error.message
      : 'Server startup failed'
    console.error(message)
    process.exitCode = 1
  })
}
