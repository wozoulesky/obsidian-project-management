#!/usr/bin/env node

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
)
const arguments_ = process.argv.slice(2)
assert(
  arguments_.length === 0
  || (arguments_.length === 1 && arguments_[0] === '--self-test'),
  'Usage: node scripts/check-docs.mjs [--self-test]',
)
const selfTestRequested = arguments_[0] === '--self-test'
const generatedMcpDistEntry = resolve(
  repositoryRoot,
  'apps/mcp/dist/stdio.js',
)
const fileExists = (absolutePath) => (
  selfTestRequested && resolve(absolutePath) === generatedMcpDistEntry
    ? false
    : existsSync(absolutePath)
)
const requiredDocuments = [
  'README.md',
  'README_EN.md',
  'web/README.md',
  'docs/agent-setup.md',
  'docs/data-and-backups.md',
  'docs/release-checklist.md',
]
const operationalReferences = [
  'integrations/project-os/SKILL.md',
  'integrations/project-os/references/claude-code-config.md',
  'integrations/project-os/references/codex-config.md',
  'integrations/project-os/references/kimi-code-config.md',
  'integrations/project-os/references/tool-reference.md',
]
const trackedRuntimeFiles = [
  'apps/mcp/build.mjs',
  'apps/mcp/package.json',
  'apps/mcp/src/stdio.ts',
  'integrations/project-os/SKILL.md',
  'integrations/project-os/scripts/verify-connection.mjs',
  'scripts/smoke-clients.mjs',
]
const rootPackage = JSON.parse(
  readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'),
)

function read(relativePath) {
  const absolutePath = resolve(repositoryRoot, relativePath)
  assert(fileExists(absolutePath), `Document is missing: ${relativePath}`)
  return readFileSync(absolutePath, 'utf8')
}

function localLinkTargets(markdown) {
  return [...markdown.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g)]
    .map((match) => match[1].trim().replace(/^<|>$/g, ''))
    .filter((target) => (
      target !== ''
      && !target.startsWith('#')
      && !/^[a-z]+:/i.test(target)
    ))
    .map((target) => decodeURIComponent(target.split('#')[0]))
}

function assertReferencesExist(relativePath, markdown) {
  for (const target of localLinkTargets(markdown)) {
    const absoluteTarget = resolve(
      dirname(resolve(repositoryRoot, relativePath)),
      target,
    )
    assert(
      fileExists(absoluteTarget),
      `${relativePath} references a missing file: ${target}`,
    )
  }
}

function assertRootScriptsExist(markdown, relativePath) {
  const commands = [
    ...markdown.matchAll(/\bnpm run ([a-z0-9:_-]+)/gi),
  ].map((match) => match[1])
  for (const command of commands) {
    assert(
      command in rootPackage.scripts,
      `${relativePath} documents missing root script: npm run ${command}`,
    )
  }
  for (const command of [...markdown.matchAll(/\bnpm start\b/g)]) {
    assert(
      'start' in rootPackage.scripts,
      `${relativePath} documents npm start but no root start script exists`,
    )
    assert(command[0] === 'npm start')
  }
  if (/\bnpm test\b/.test(markdown)) {
    assert(
      'test' in rootPackage.scripts,
      `${relativePath} documents npm test but no root test script exists`,
    )
  }
  for (const match of markdown.matchAll(
    /\bnode\s+([A-Za-z0-9_./-]+\.mjs)\b/g,
  )) {
    const commandPath = match[1]
    assert(
      fileExists(resolve(repositoryRoot, commandPath)),
      `${relativePath} documents a missing Node CLI: ${commandPath}`,
    )
  }
}

function assertTrackedRuntimeFiles(runtimeFileExists = fileExists) {
  for (const runtimeFile of trackedRuntimeFiles) {
    assert(
      runtimeFileExists(resolve(repositoryRoot, runtimeFile)),
      `Missing tracked runtime source: ${runtimeFile}`,
    )
  }
}

const documents = new Map(
  requiredDocuments.map((path) => [path, read(path)]),
)
for (const [path, markdown] of documents) {
  assertReferencesExist(path, markdown)
  assertRootScriptsExist(markdown, path)
}

const referenceDocuments = new Map(
  operationalReferences.map((path) => [path, read(path)]),
)
for (const [path, markdown] of referenceDocuments) {
  assertReferencesExist(path, markdown)
}
const combined = [
  ...documents.values(),
  ...referenceDocuments.values(),
].join('\n')
const agentSetup = documents.get('docs/agent-setup.md')
for (const client of ['Codex', 'Claude Code', 'Kimi Code']) {
  assert(agentSetup.includes(client), `Agent setup is missing ${client}`)
}
for (const transport of ['stdio', 'Streamable HTTP']) {
  assert(
    agentSetup.includes(transport),
    `Agent setup is missing ${transport}`,
  )
}
for (const phrase of [
  'Streamable HTTP',
  'stdio',
  '27 tools',
  'data/project_manage.db',
  'apps/mcp/dist/stdio.js',
  'web/dist/',
  'PROJECT_OS_DATABASE_PATH',
  'PROJECT_OS_BACKUP_ROOT',
  'PROJECT_OS_HOST',
  'PROJECT_OS_PORT',
  'PROJECT_OS_ALLOWED_HOSTS',
  'PROJECT_OS_ALLOWED_ORIGINS',
]) {
  assert(combined.includes(phrase), `Documentation is missing: ${phrase}`)
}

assert(
  !/\b(?:Server-Sent Events?|SSE)\b/i.test(combined),
  'Legacy SSE transport must not appear in current configuration docs',
)
assert(
  !/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(combined),
  'Documentation contains a private key',
)
assert(
  !/\b(?:pos_|sk-)[A-Za-z0-9_-]{10,}\b/.test(combined),
  'Documentation contains a secret-looking token',
)
assert(
  !/\bBearer\s+[A-Za-z0-9._~-]{12,}\b/i.test(combined),
  'Documentation contains a secret-looking bearer value',
)
assert(
  !/\b(?!27\b)\d+\s+tools\b/i.test(combined),
  'Documentation contains an outdated MCP tool count',
)

const serverConfig = readFileSync(
  resolve(repositoryRoot, 'apps/server/src/config.ts'),
  'utf8',
)
for (const implementationDefault of [
  "'127.0.0.1'",
  "'4310'",
  "'data/project_manage.db'",
  "'data/backups'",
  "'actor_local_owner'",
]) {
  assert(
    serverConfig.includes(implementationDefault),
    `Server runtime default changed; update docs: ${implementationDefault}`,
  )
}
for (const environmentName of [
  'PROJECT_OS_HOST',
  'PROJECT_OS_PORT',
  'PROJECT_OS_DATABASE_PATH',
  'PROJECT_OS_BACKUP_ROOT',
  'PROJECT_OS_ALLOWED_HOSTS',
  'PROJECT_OS_ALLOWED_ORIGINS',
  'PROJECT_OS_LOCAL_ACTOR_ID',
]) {
  assert(
    serverConfig.includes(environmentName),
    `Documented server environment variable is not implemented: ${environmentName}`,
  )
}
const stdioSource = readFileSync(
  resolve(repositoryRoot, 'apps/mcp/src/stdio.ts'),
  'utf8',
)
for (const stdioSetting of [
  'PROJECT_OS_DB',
  'PROJECT_OS_DATABASE_PATH',
  'data/project_manage.db',
]) {
  assert(
    stdioSource.includes(stdioSetting),
    `Documented stdio setting is not implemented: ${stdioSetting}`,
  )
}
const mcpPackage = JSON.parse(readFileSync(
  resolve(repositoryRoot, 'apps/mcp/package.json'),
  'utf8',
))
assert.equal(
  mcpPackage.bin?.['project-os-mcp'],
  './dist/stdio.js',
  'Documented MCP dist entry does not match package bin',
)
assert.equal(
  mcpPackage.scripts?.start,
  'node dist/stdio.js',
  'MCP start script does not match the documented dist entry',
)
assert.match(
  mcpPackage.scripts?.build ?? '',
  /\bnode build\.mjs\b/,
  'MCP build script does not invoke build.mjs',
)
const mcpBuild = readFileSync(
  resolve(repositoryRoot, 'apps/mcp/build.mjs'),
  'utf8',
)
assert.match(
  mcpBuild,
  /outdir:\s*['"]dist['"]/,
  'MCP build does not generate the documented dist directory',
)
assert.match(
  mcpBuild,
  /stdio:\s*['"]src\/stdio\.ts['"]/,
  'MCP build does not generate dist/stdio.js from src/stdio.ts',
)
assertTrackedRuntimeFiles()

const verifier = readFileSync(
  resolve(
    repositoryRoot,
    'integrations/project-os/scripts/verify-connection.mjs',
  ),
  'utf8',
)
const approvedToolBlock = /const approvedTools = \[([\s\S]*?)\n\]/.exec(verifier)
assert(approvedToolBlock !== null, 'Verifier approved tool contract is missing')
const approvedToolCount = [
  ...approvedToolBlock[1].matchAll(/'([a-z_]+)'/g),
].length
assert.equal(approvedToolCount, 27, 'MCP approved tool contract count changed')
assert(
  combined.includes(`${approvedToolCount} tools`),
  'Documentation tool count does not match the verifier contract',
)

if (selfTestRequested) {
  assert.equal(
    fileExists(generatedMcpDistEntry),
    false,
    'Fresh-clone simulation must hide the generated MCP dist entry',
  )
  assertTrackedRuntimeFiles()
  process.stdout.write(
    'Documentation fresh-clone self-test PASS '
      + '(generated MCP dist entry absent)\n',
  )
}

process.stdout.write(
  `Documentation verification PASS (${requiredDocuments.length} documents)\n`,
)
