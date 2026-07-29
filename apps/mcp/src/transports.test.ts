import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest'

const createdDirectories: string[] = []

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function stringEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).flatMap(([key, value]) => (
      value === undefined ? [] : [[key, value]]
    )),
  )
}

describe('stdio MCP transport', () => {
  it('builds a production distribution without test files', () => {
    const distribution = resolve('dist')

    expect(existsSync(resolve(distribution, 'stdio.js'))).toBe(true)
    expect(existsSync(resolve(distribution, 'index.js'))).toBe(true)
    expect(
      readdirSync(distribution, { recursive: true })
        .map(String)
        .filter((file) => /\.test\.[cm]?js$/.test(file)),
    ).toEqual([])
  })

  it('spawns the built executable, lists tools and keeps stdout protocol-clean', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'project-os-mcp-stdio-'))
    createdDirectories.push(directory)
    const databasePath = join(directory, 'stdio.db')
    const errors: Error[] = []
    let stderr = ''
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve('dist/stdio.js')],
      cwd: resolve('.'),
      env: {
        ...stringEnvironment(),
        PROJECT_OS_DB: databasePath,
      },
      stderr: 'pipe',
    })
    transport.onerror = (error) => {
      errors.push(error)
    }
    transport.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    const client = new Client({
      name: 'project-os-stdio-test',
      version: '0.0.0',
    })

    try {
      await client.connect(transport)
      const tools = await client.listTools()
      const registered = await client.callTool({
        name: 'agent_register',
        arguments: {
          name: 'stdio-agent',
          role: 'dev-agent',
          client: 'codex',
        },
      })

      expect(tools.tools.length).toBeGreaterThan(20)
      expect(registered.structuredContent).toMatchObject({
        name: 'stdio-agent',
        client: 'codex',
      })
      expect(errors).toEqual([])
      expect(stderr).not.toMatch(/stdout|protocol error/i)
    } finally {
      await client.close()
    }
  }, 15_000)
})
