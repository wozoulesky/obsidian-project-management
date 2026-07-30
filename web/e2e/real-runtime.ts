import { test as base, expect } from '@playwright/test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  basename,
  join,
  resolve,
  sep,
} from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import {
  createServer as createViteServer,
  type ViteDevServer,
} from 'vite'

import { startServer } from '../../apps/server/src/index'

type RealRuntime = {
  apiURL: string
  baseURL: string
  seed: {
    agentId: string
    agentName: string
    ownerId: string
    ownerName: string
    taskTitle: string
  }
}

const webRoot = fileURLToPath(new URL('../', import.meta.url))

function assertTemporaryRuntimePath(path: string): void {
  const temporaryRoot = resolve(tmpdir())
  const resolvedPath = resolve(path)
  if (
    !resolvedPath.startsWith(`${temporaryRoot}${sep}`)
    || !basename(resolvedPath).startsWith('project-os-playwright-')
  ) {
    throw new Error(`Refusing to clean unverified E2E directory: ${resolvedPath}`)
  }
}

export const test = base.extend<
  Record<string, never>,
  { runtime: RealRuntime }
>({
  runtime: [
    async ({ browserName }, provide) => {
      if (browserName !== 'chromium') {
        throw new Error('Real Project OS journeys require Chromium')
      }
      const temporaryDirectory = await mkdtemp(
        join(tmpdir(), 'project-os-playwright-'),
      )
      assertTemporaryRuntimePath(temporaryDirectory)
      const backupRoot = join(temporaryDirectory, 'backups')
      await mkdir(backupRoot, { recursive: true })

      let api: Awaited<ReturnType<typeof startServer>> | undefined
      let vite: ViteDevServer | undefined
      try {
        api = await startServer({
          host: '127.0.0.1',
          port: 0,
          databasePath: join(temporaryDirectory, 'journeys.sqlite'),
          backupRoot,
        })
        const address = api.server.address() as AddressInfo
        const apiURL = `http://127.0.0.1:${address.port}`
        const actorId = api.context.localActorId
        const owner = api.context.services.actors.createHuman(
          {
            name: 'Lin',
            role: 'owner',
            capabilities: ['planning'],
          },
          actorId,
          'web',
        )
        const agent = api.context.services.actors.registerAgent(
          {
            name: 'dev-agent',
            role: 'dev-agent',
            client: 'codex',
            capabilities: ['task.write'],
          },
          actorId,
          'mcp',
        )
        api.context.services.projects.create(
          {
            name: 'Lin Portfolio',
            description: '用于验证负责人筛选的项目',
            ownerId: owner.id,
            startDate: '2026-07-20',
            dueDate: '2026-08-30',
          },
          actorId,
          'web',
        )
        api.context.services.projects.addMember(
          'project_default',
          agent.id,
          actorId,
          'web',
        )
        const taskTitle = 'MCP 权限校验'
        api.context.services.tasks.create(
          {
            projectId: 'project_default',
            title: taskTitle,
            description: '验证快速提交写入真实 SQLite',
            assigneeId: agent.id,
            startDate: '2026-07-24',
            dueDate: '2026-08-28',
            priority: 'P0',
          },
          actorId,
          'web',
        )

        vite = await createViteServer({
          cacheDir: join(temporaryDirectory, 'vite-cache'),
          configFile: join(webRoot, 'vite.config.ts'),
          root: webRoot,
          logLevel: 'silent',
          define: {
            'import.meta.env.VITE_PROJECT_OS_SERVER_URL': JSON.stringify(apiURL),
          },
          server: {
            host: '127.0.0.1',
            port: 0,
            strictPort: false,
            proxy: {
              '/api': apiURL,
            },
          },
        })
        await vite.listen()
        const baseURL = vite.resolvedUrls?.local[0]
        if (baseURL === undefined) {
          throw new Error('Vite did not expose a local E2E URL')
        }
        await provide({
          apiURL,
          baseURL,
          seed: {
            agentId: agent.id,
            agentName: agent.name,
            ownerId: owner.id,
            ownerName: owner.name,
            taskTitle,
          },
        })
      } finally {
        try {
          await vite?.close()
        } finally {
          try {
            await api?.close()
          } finally {
            assertTemporaryRuntimePath(temporaryDirectory)
            await rm(temporaryDirectory, { recursive: true, force: true })
          }
        }
      }
    },
    { scope: 'worker' },
  ],
})

export { expect }
