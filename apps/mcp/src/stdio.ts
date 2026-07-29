import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { openDatabase } from '@project-os/core'
import { createProjectOsMcpServer } from './create-server.js'
import { createProjectOsMcpServices } from './services.js'

type Environment = Record<string, string | undefined>

function databasePath(environment: Environment): string {
  const selected = environment.PROJECT_OS_DB
    ?? environment.PROJECT_OS_DATABASE_PATH
    ?? 'data/project_manage.db'
  if (selected.trim().length === 0) {
    throw new Error('PROJECT_OS_DB must not be empty')
  }
  return resolve(selected)
}

export async function runStdioServer(
  environment: Environment = process.env,
): Promise<void> {
  const database = openDatabase(databasePath(environment))
  const server = createProjectOsMcpServer(
    createProjectOsMcpServices(database),
  )
  const transport = new StdioServerTransport()
  let closed = false
  let closing: Promise<void> | undefined

  const cleanupDatabase = () => {
    if (closed) {
      return
    }
    closed = true
    database.close()
  }
  const close = () => {
    closing ??= server.close().finally(cleanupDatabase)
    return closing
  }
  const onSignal = () => {
    void close().catch((error: unknown) => {
      const message = error instanceof Error
        ? error.message
        : 'Project OS MCP shutdown failed'
      process.stderr.write(`${message}\n`)
      process.exitCode = 1
    })
  }

  server.server.onclose = cleanupDatabase
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  process.stdin.once('end', onSignal)

  try {
    await server.connect(transport)
  } catch (error) {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    process.stdin.off('end', onSignal)
    cleanupDatabase()
    throw error
  }
}

async function main(): Promise<void> {
  await runStdioServer()
}

const entrypoint = process.argv[1]
if (
  entrypoint !== undefined
  && pathToFileURL(resolve(entrypoint)).href === import.meta.url
) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error
      ? error.message
      : 'Project OS MCP startup failed'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
