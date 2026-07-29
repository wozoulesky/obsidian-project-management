import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  activitySourceSchema,
} from '@project-os/contracts'
import type { ActivitySource } from '@project-os/contracts'
import {
  recordActivity,
  withImmediateTransaction,
} from './activity-service.js'
import { DomainError } from './errors.js'

const hashVersion = 1
const scryptCost = 16_384
const scryptBlockSize = 8
const scryptParallelization = 1
const digestLength = 32
const selectorLength = 24
const secretLength = 43
const bearerPattern = new RegExp(
  `^pos_([A-Za-z0-9_-]{${selectorLength}})_`
    + `([A-Za-z0-9_-]{${secretLength}})$`,
)

type TokenRow = {
  id: string
  name: string
  token_hash: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
  version: number
}

export type AccessToken = {
  id: string
  name: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
  version: number
}

export type IssuedAccessToken = AccessToken & {
  token: string
}

export type TokenServiceOptions = {
  onScrypt?: () => void
  beforeVerifyFinalize?: (tokenId: string) => void
}

type ParsedDigest = {
  salt: Buffer
  digest: Buffer
}

function tokenInvalid(): DomainError {
  return new DomainError('TOKEN_INVALID', 'Access token input is invalid')
}

function validateName(name: unknown): string {
  if (
    typeof name !== 'string'
    || name.length === 0
    || name.length > 200
  ) {
    throw tokenInvalid()
  }
  return name
}

function mapToken(row: TokenRow): AccessToken {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    version: row.version,
  }
}

function deriveDigest(token: string, salt: Buffer): Buffer {
  return scryptSync(token, salt, digestLength, {
    N: scryptCost,
    r: scryptBlockSize,
    p: scryptParallelization,
    maxmem: 64 * 1024 * 1024,
  })
}

function serializeDigest(salt: Buffer, digest: Buffer): string {
  return [
    'scrypt',
    `v=${hashVersion}`,
    `N=${scryptCost}`,
    `r=${scryptBlockSize}`,
    `p=${scryptParallelization}`,
    salt.toString('base64url'),
    digest.toString('base64url'),
  ].join('$')
}

function parseDigest(serialized: string): ParsedDigest | null {
  const parts = serialized.split('$')
  if (
    parts.length !== 7
    || parts[0] !== 'scrypt'
    || parts[1] !== `v=${hashVersion}`
    || parts[2] !== `N=${scryptCost}`
    || parts[3] !== `r=${scryptBlockSize}`
    || parts[4] !== `p=${scryptParallelization}`
  ) {
    return null
  }

  try {
    const salt = Buffer.from(parts[5]!, 'base64url')
    const digest = Buffer.from(parts[6]!, 'base64url')
    if (salt.length !== 16 || digest.length !== digestLength) {
      return null
    }
    return { salt, digest }
  } catch {
    return null
  }
}

export class TokenService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly options: TokenServiceOptions = {},
  ) {}

  private derive(token: string, salt: Buffer): Buffer {
    this.options.onScrypt?.()
    return deriveDigest(token, salt)
  }

  issue(
    name: string,
    actorId?: string,
    source: ActivitySource = 'web',
  ): IssuedAccessToken {
    const validatedName = validateName(name)
    let validatedSource: ActivitySource
    try {
      validatedSource = activitySourceSchema.parse(source)
    } catch {
      throw tokenInvalid()
    }

    const selector = randomBytes(18).toString('base64url')
    const secret = randomBytes(32).toString('base64url')
    const token = `pos_${selector}_${secret}`
    const salt = randomBytes(16)
    const digest = this.derive(token, salt)
    const id = `token_${selector}`
    const createdAt = new Date().toISOString()

    let persisted: AccessToken
    try {
      persisted = withImmediateTransaction(this.database, () => {
        this.database.prepare(`
        INSERT INTO access_tokens (
          id, name, token_hash, created_at, last_used_at, revoked_at, version
        ) VALUES (?, ?, ?, ?, NULL, NULL, 1)
      `).run(
        id,
        validatedName,
        serializeDigest(salt, digest),
        createdAt,
      )

        if (actorId !== undefined) {
          recordActivity(this.database, {
            actorId,
            source: validatedSource,
            operation: 'token.issue',
            entityType: 'access_token',
            entityId: id,
            action: 'Issued an access token',
            details: { name: validatedName },
            createdAt,
          })
        }

        return {
          id,
          name: validatedName,
          createdAt,
          lastUsedAt: null,
          revokedAt: null,
          version: 1,
        }
      })
    } catch {
      throw new DomainError(
        'TOKEN_ISSUE_FAILED',
        'Access token could not be issued',
      )
    }

    return { ...persisted, token }
  }

  list(): AccessToken[] {
    const rows = this.database.prepare(`
      SELECT
        id, name, token_hash, created_at, last_used_at, revoked_at, version
      FROM access_tokens
      ORDER BY created_at DESC, id DESC
    `).all() as unknown as TokenRow[]
    return rows.map(mapToken)
  }

  verify(token: unknown): boolean {
    if (typeof token !== 'string') {
      return false
    }
    const match = bearerPattern.exec(token)
    if (match === null) {
      return false
    }
    const selector = match[1]!

    const row = this.database.prepare(`
      SELECT
        id, name, token_hash, created_at, last_used_at, revoked_at, version
      FROM access_tokens
      WHERE id = ?
    `).get(`token_${selector}`) as TokenRow | undefined
    if (row === undefined || row.revoked_at !== null) {
      return false
    }
    const parsed = parseDigest(row.token_hash)
    if (parsed === null) {
      return false
    }
    const candidate = this.derive(token, parsed.salt)
    if (!timingSafeEqual(candidate, parsed.digest)) {
      return false
    }

    this.options.beforeVerifyFinalize?.(row.id)
    const result = this.database.prepare(`
      UPDATE access_tokens
      SET last_used_at = ?
      WHERE id = ? AND revoked_at IS NULL
    `).run(new Date().toISOString(), row.id)
    return Number(result.changes) === 1
  }

  revoke(
    id: string,
    version: number,
    actorId?: string,
    source: ActivitySource = 'web',
  ): AccessToken {
    if (
      typeof id !== 'string'
      || id.length === 0
      || !Number.isInteger(version)
      || version < 1
    ) {
      throw tokenInvalid()
    }
    let validatedSource: ActivitySource
    try {
      validatedSource = activitySourceSchema.parse(source)
    } catch {
      throw tokenInvalid()
    }

    try {
      return withImmediateTransaction(this.database, () => {
        const row = this.database.prepare(`
        SELECT
          id, name, token_hash, created_at, last_used_at, revoked_at, version
        FROM access_tokens
        WHERE id = ?
      `).get(id) as TokenRow | undefined

        if (row === undefined) {
          throw new DomainError(
            'TOKEN_NOT_FOUND',
            'Access token does not exist',
            { tokenId: id },
          )
        }
        if (row.revoked_at !== null) {
          return mapToken(row)
        }
        if (row.version !== version) {
          throw new DomainError(
            'TOKEN_VERSION_CONFLICT',
            'Access token changed since it was read',
            {
              tokenId: id,
              expectedVersion: version,
              actualVersion: row.version,
            },
          )
        }

        const revokedAt = new Date().toISOString()
        this.database.prepare(`
        UPDATE access_tokens
        SET revoked_at = ?, version = version + 1
        WHERE id = ? AND version = ? AND revoked_at IS NULL
      `).run(revokedAt, id, version)

        if (actorId !== undefined) {
          recordActivity(this.database, {
            actorId,
            source: validatedSource,
            operation: 'token.revoke',
            entityType: 'access_token',
            entityId: id,
            action: 'Revoked an access token',
            details: { name: row.name },
            createdAt: revokedAt,
          })
        }

        return {
          ...mapToken(row),
          revokedAt,
          version: row.version + 1,
        }
      })
    } catch (error) {
      if (error instanceof DomainError) {
        throw error
      }
      throw new DomainError(
        'TOKEN_REVOKE_FAILED',
        'Access token could not be revoked',
      )
    }
  }
}
