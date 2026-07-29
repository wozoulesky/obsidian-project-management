import { randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  basename,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'

const directoryPrefix = 'project-os-test-'
const markerName = '.project-os-test-environment'
const labelPattern = /^[a-z0-9](?:[a-z0-9-]{0,39}[a-z0-9])?$/

function assertSafeChild(root, target, expectedPrefix) {
  const pathFromRoot = relative(root, target)
  if (
    pathFromRoot.length === 0
    || isAbsolute(pathFromRoot)
    || pathFromRoot === '..'
    || pathFromRoot.startsWith(`..${sep}`)
    || !basename(target).startsWith(expectedPrefix)
  ) {
    throw new Error('Refusing to clean an unverified test directory')
  }
}

/**
 * Creates an isolated Project OS test directory and returns a cleanup closure
 * that can delete only that exact, marker-verified directory.
 *
 * @param {string} label
 */
export async function createTestEnvironment(label) {
  if (!labelPattern.test(label)) {
    throw new TypeError('Test environment label is invalid')
  }

  const temporaryRoot = await realpath(tmpdir())
  const expectedPrefix = `${directoryPrefix}${label}-`
  const directory = await mkdtemp(join(temporaryRoot, expectedPrefix))
  const issuedDirectory = resolve(directory)
  assertSafeChild(temporaryRoot, issuedDirectory, expectedPrefix)

  const marker = randomUUID()
  const markerPath = join(issuedDirectory, markerName)
  const backupRoot = join(issuedDirectory, 'backups')
  await mkdir(backupRoot)
  await writeFile(markerPath, marker, {
    encoding: 'utf8',
    flag: 'wx',
  })

  let cleaned = false
  let cleanupPromise

  async function performCleanup() {
    if (cleaned) {
      return
    }

    assertSafeChild(temporaryRoot, issuedDirectory, expectedPrefix)
    let targetStats
    try {
      targetStats = await lstat(issuedDirectory)
    } catch (error) {
      if (error?.code === 'ENOENT') {
        cleaned = true
        return
      }
      throw error
    }
    if (!targetStats.isDirectory() || targetStats.isSymbolicLink()) {
      throw new Error('Refusing to clean a replaced test directory')
    }

    const currentDirectory = await realpath(issuedDirectory)
    assertSafeChild(temporaryRoot, currentDirectory, expectedPrefix)
    if (currentDirectory !== issuedDirectory) {
      throw new Error('Refusing to clean a relocated test directory')
    }
    const currentMarker = await readFile(markerPath, 'utf8')
    if (currentMarker !== marker) {
      throw new Error('Refusing to clean an unverified test directory')
    }

    await rm(issuedDirectory, { recursive: true, force: false })
    cleaned = true
  }

  return Object.freeze({
    directory: issuedDirectory,
    databasePath: join(issuedDirectory, 'project-os.db'),
    backupRoot,
    cleanup() {
      cleanupPromise ??= performCleanup().catch((error) => {
        cleanupPromise = undefined
        throw error
      })
      return cleanupPromise
    },
  })
}
