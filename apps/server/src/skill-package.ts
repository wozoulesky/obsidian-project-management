import {
  lstatSync,
  readFileSync,
  realpathSync,
} from 'node:fs'
import {
  dirname,
  isAbsolute,
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
const includedFiles = [
  'SKILL.md',
  'agents/openai.yaml',
  'references/claude-code-config.md',
  'references/codex-config.md',
  'references/kimi-code-config.md',
  'references/tool-reference.md',
  'scripts/verify-connection.mjs',
] as const
const knownExampleRoots = [
  'E:/project_manage',
  'E:/another/project_manage',
] as const

function compareEntryNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function normalizedPath(path: string): string {
  return path.replaceAll('\\', '/').split(sep).join('/')
}

function normalizedProjectRoot(root: string): string {
  return /^[A-Za-z]:[\\/]/
    .test(root)
    ? normalizedPath(root).replace(/\/+$/, '')
    : normalizedPath(resolve(root))
}

function pathsFor(root: string): {
  database: string
  mcpEntry: string
  projectRoot: string
} {
  const projectRoot = normalizedProjectRoot(root)
  return {
    projectRoot,
    mcpEntry: `${projectRoot}/apps/mcp/dist/stdio.js`,
    database: `${projectRoot}/data/project_manage.db`,
  }
}

function powershellLiteral(value: string): string {
  if (/[\r\n\u0000]/.test(value)) {
    throw new Error('PowerShell configuration path is invalid')
  }
  return `'${value.replaceAll("'", "''")}'`
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
      `args = [${JSON.stringify(paths.mcpEntry)}]`,
      `env = { PROJECT_OS_DB = ${JSON.stringify(paths.database)} }`,
    ].join('\n')
  }
  if (client === 'claude-code') {
    return 'claude mcp add --transport stdio '
      + `--env ${powershellLiteral(`PROJECT_OS_DB=${paths.database}`)} `
      + 'project-os -- node '
      + powershellLiteral(paths.mcpEntry)
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

function configReference(
  client: SkillConfigClient,
  projectRoot: string,
): string {
  const titles: Record<SkillConfigClient, string> = {
    codex: 'Codex',
    'claude-code': 'Claude Code',
    'kimi-code': 'Kimi Code',
  }
  const formats: Record<SkillConfigClient, string> = {
    codex: 'toml',
    'claude-code': 'powershell',
    'kimi-code': 'json',
  }
  const destinations: Record<SkillConfigClient, string> = {
    codex: 'Add this entry to the Codex MCP configuration.',
    'claude-code':
      'Run this single PowerShell command to register the stdio server.',
    'kimi-code':
      'Save this as `.kimi-code/mcp.json` in the client project.',
  }
  return [
    `# ${titles[client]} configuration`,
    '',
    'Build Project OS first. This generated copy points to the Project OS',
    'runtime that exported the Skill and contains no bearer token or secret.',
    '',
    destinations[client],
    '',
    `\`\`\`${formats[client]}`,
    createSkillConfigSnippet(client, projectRoot),
    '```',
    '',
    'Restart the client after changing its MCP configuration.',
    '',
  ].join('\n')
}

function substituteRuntimePaths(
  content: string,
  projectRoot: string,
): string {
  const paths = pathsFor(projectRoot)
  let output = content
  for (const exampleRoot of knownExampleRoots) {
    output = output.replaceAll(exampleRoot, paths.projectRoot)
  }
  return output
    .replaceAll('{{PROJECT_OS_ROOT}}', paths.projectRoot)
    .replaceAll('{{PROJECT_OS_MCP_ENTRY}}', paths.mcpEntry)
    .replaceAll('{{PROJECT_OS_DB}}', paths.database)
}

function packagedContent(
  relativePath: typeof includedFiles[number],
  runtimeProjectRoot: string,
  source: string,
): string {
  if (relativePath === 'references/codex-config.md') {
    return configReference('codex', runtimeProjectRoot)
  }
  if (relativePath === 'references/claude-code-config.md') {
    return configReference('claude-code', runtimeProjectRoot)
  }
  if (relativePath === 'references/kimi-code-config.md') {
    return configReference('kimi-code', runtimeProjectRoot)
  }
  if (relativePath === 'scripts/verify-connection.mjs') {
    const declaration =
      "const packagedProjectRoot = '{{PROJECT_OS_ROOT}}'"
    const replacement = `const packagedProjectRoot = ${
      JSON.stringify(pathsFor(runtimeProjectRoot).projectRoot)
    }`
    if (!source.includes(declaration)) {
      throw new Error('Skill verifier runtime placeholder is missing')
    }
    return source.replace(declaration, replacement)
  }
  return substituteRuntimePaths(source, runtimeProjectRoot)
}

export function validateSkillPackageEntry(
  entryName: string,
  content: Uint8Array,
): void {
  if (
    !entryName.startsWith('project-os/')
    || entryName.includes('\\')
    || entryName.split('/').some((segment) => (
      segment === ''
      || segment === '.'
      || segment === '..'
    ))
    || /(?:^|\/)(?:\.env(?:\.|$)|node_modules|debug[^/]*)/i.test(entryName)
    || /\.(?:tmp|temp|log)$/i.test(entryName)
  ) {
    throw new Error('Skill package entry path is invalid or unsafe')
  }

  const text = new TextDecoder('utf-8', { fatal: true }).decode(content)
  if (
    /{{[A-Z0-9_]+}}/.test(text)
    || /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(text)
    || /\bpos_[A-Za-z0-9_-]+_[A-Za-z0-9_-]+\b/.test(text)
    || /\bBearer\s+(?:eyJ|pos_|[A-Za-z0-9_-]{24,}\.)/i.test(text)
    || /\b(?:token|secret|api[_-]?key|password)\s*[:=]\s*["']?[A-Za-z0-9._~-]{12,}/i
      .test(text)
    || /(?:\/tmp\/|\/var\/tmp\/|AppData\/Local\/Temp\/)/i.test(
      normalizedPath(text),
    )
  ) {
    throw new Error('Skill package entry contains unsafe content')
  }
}

export function createProjectOsSkillArchive(
  sourceProjectRoot = sourceRoot,
  runtimeProjectRoot = sourceProjectRoot,
): Uint8Array {
  const integrationRoot = resolve(
    sourceProjectRoot,
    'integrations/project-os',
  )
  const integrationStat = lstatSync(integrationRoot)
  if (
    integrationStat.isSymbolicLink()
    || !integrationStat.isDirectory()
  ) {
    throw new Error('Skill package source path is invalid or unsafe')
  }
  const realIntegrationRoot = realpathSync(integrationRoot)
  const entries: Record<string, Uint8Array> = {}
  for (const relativePath of [...includedFiles].sort(compareEntryNames)) {
    let file = integrationRoot
    const segments = relativePath.split('/')
    for (const [index, segment] of segments.entries()) {
      file = resolve(file, segment)
      const stat = lstatSync(file)
      const final = index === segments.length - 1
      if (
        stat.isSymbolicLink()
        || (final ? !stat.isFile() : !stat.isDirectory())
      ) {
        throw new Error('Skill package source path is invalid or unsafe')
      }
    }
    const realFile = realpathSync(file)
    const realRelative = relative(realIntegrationRoot, realFile)
    if (
      realRelative === ''
      || isAbsolute(realRelative)
      || realRelative === '..'
      || realRelative.startsWith(`..${sep}`)
    ) {
      throw new Error('Skill package source path is invalid or unsafe')
    }
    const entryName = `project-os/${relativePath}`
    const content = strToU8(packagedContent(
      relativePath,
      runtimeProjectRoot,
      readFileSync(file, 'utf8'),
    ))
    validateSkillPackageEntry(entryName, content)
    entries[entryName] = content
  }

  return zipSync(entries, {
    level: 9,
    mtime: new Date(1980, 0, 1, 0, 0, 0, 0),
  })
}
