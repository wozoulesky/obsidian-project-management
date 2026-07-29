import {
  lstatSync,
  readdirSync,
  readFileSync,
} from 'node:fs'
import {
  dirname,
  relative,
  resolve,
  sep,
} from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  strToU8,
  zipSync,
} from 'fflate'

export const skillConfigClients = [
  'codex',
  'claude-code',
  'kimi-code',
] as const

export type SkillConfigClient = typeof skillConfigClients[number]

const sourceRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
)
const includedRoots = [
  'SKILL.md',
  'agents',
  'references',
  'scripts',
] as const
const knownExampleRoots = [
  'E:/project_manage',
  'E:/another/project_manage',
] as const

function compareEntryNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function normalizedPath(path: string): string {
  return path.split(sep).join('/')
}

function pathsFor(root: string): {
  database: string
  mcpEntry: string
  projectRoot: string
} {
  const projectRoot = normalizedPath(resolve(root))
  return {
    projectRoot,
    mcpEntry: `${projectRoot}/apps/mcp/dist/stdio.js`,
    database: `${projectRoot}/data/project_manage.db`,
  }
}

export function createSkillConfigSnippet(
  client: SkillConfigClient,
  projectRoot = sourceRoot,
): string {
  const paths = pathsFor(projectRoot)
  if (client === 'codex') {
    return [
      '[mcp_servers.project-os]',
      'command = "node"',
      `args = ["${paths.mcpEntry}"]`,
      `env = { PROJECT_OS_DB = "${paths.database}" }`,
    ].join('\n')
  }
  if (client === 'claude-code') {
    return [
      'claude mcp add --transport stdio',
      `  --env PROJECT_OS_DB=${paths.database}`,
      `  project-os -- node ${paths.mcpEntry}`,
    ].join(' \\\n')
  }
  return JSON.stringify({
    mcpServers: {
      'project-os': {
        command: 'node',
        args: [paths.mcpEntry],
        env: {
          PROJECT_OS_DB: paths.database,
        },
      },
    },
  }, null, 2)
}

function collectFiles(
  integrationRoot: string,
  candidate: string,
): string[] {
  const resolvedRoot = resolve(integrationRoot)
  const resolvedCandidate = resolve(candidate)
  const withinRoot = (
    resolvedCandidate === resolvedRoot
    || resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)
  )
  if (!withinRoot) {
    throw new Error('Skill package entry escaped its source directory')
  }

  const stat = lstatSync(resolvedCandidate)
  if (stat.isSymbolicLink()) {
    throw new Error('Skill package cannot include symbolic links')
  }
  if (stat.isFile()) return [resolvedCandidate]
  if (!stat.isDirectory()) return []
  return readdirSync(resolvedCandidate, { withFileTypes: true })
    .sort((left, right) => compareEntryNames(left.name, right.name))
    .flatMap((entry) => collectFiles(
      resolvedRoot,
      resolve(resolvedCandidate, entry.name),
    ))
}

function substituteRuntimePaths(
  content: string,
  projectRoot: string,
): string {
  const paths = pathsFor(projectRoot)
  let output = content
    .replaceAll('{{PROJECT_OS_ROOT}}', paths.projectRoot)
    .replaceAll('{{PROJECT_OS_MCP_ENTRY}}', paths.mcpEntry)
    .replaceAll('{{PROJECT_OS_DB}}', paths.database)
  for (const exampleRoot of knownExampleRoots) {
    output = output.replaceAll(exampleRoot, paths.projectRoot)
  }
  return output
}

export function createProjectOsSkillArchive(
  projectRoot = sourceRoot,
): Uint8Array {
  const integrationRoot = resolve(projectRoot, 'integrations/project-os')
  const files = includedRoots
    .flatMap((entry) => collectFiles(
      integrationRoot,
      resolve(integrationRoot, entry),
    ))
    .sort((left, right) => (
      compareEntryNames(
        normalizedPath(relative(integrationRoot, left)),
        normalizedPath(relative(integrationRoot, right)),
      )
    ))

  const entries: Record<string, Uint8Array> = {}
  for (const file of files) {
    const entryName = `project-os/${
      normalizedPath(relative(integrationRoot, file))
    }`
    if (
      entryName.includes('..')
      || entryName.includes('\\')
      || !entryName.startsWith('project-os/')
    ) {
      throw new Error('Skill package entry name is invalid')
    }
    entries[entryName] = strToU8(substituteRuntimePaths(
      readFileSync(file, 'utf8'),
      projectRoot,
    ))
  }

  return zipSync(entries, {
    level: 9,
    mtime: new Date(1980, 0, 1, 0, 0, 0, 0),
  })
}

export function projectOsSkillRoot(): string {
  return sourceRoot
}
