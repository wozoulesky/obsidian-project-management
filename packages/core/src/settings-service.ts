import type { DatabaseSync } from 'node:sqlite'
import {
  activitySourceSchema,
  persistedAppSettingsSchema,
} from '@project-os/contracts'
import type {
  ActivitySource,
  PersistedAppSettings,
} from '@project-os/contracts'
import {
  recordActivity,
  withImmediateTransaction,
} from './activity-service.js'
import { DomainError } from './errors.js'

export { persistedAppSettingsSchema } from '@project-os/contracts'

const settingsKey = 'app'
const defaultSettings: PersistedAppSettings = {
  theme: 'system',
  background: 'soft',
  accent: 'blue',
  density: 'comfortable',
  updatedAt: '1970-01-01T00:00:00.000Z',
  version: 1,
}

type SettingsRow = {
  value_json: string
  updated_at: string
  version: number
}

function settingsInvalid(): DomainError {
  return new DomainError(
    'SETTINGS_INVALID',
    'Settings are invalid',
  )
}

function parseSettings(
  value: unknown,
  updatedAt?: string,
  version?: number,
): PersistedAppSettings {
  try {
    const source = typeof value === 'string' ? JSON.parse(value) : value
    return persistedAppSettingsSchema.parse({
      ...(typeof source === 'object' && source !== null ? source : {}),
      ...(updatedAt === undefined ? {} : { updatedAt }),
      ...(version === undefined ? {} : { version }),
    })
  } catch {
    throw settingsInvalid()
  }
}

function sameSettings(
  left: PersistedAppSettings,
  right: PersistedAppSettings,
): boolean {
  return left.theme === right.theme
    && left.background === right.background
    && left.accent === right.accent
    && left.density === right.density
}

export class SettingsService {
  constructor(private readonly database: DatabaseSync) {}

  get(): PersistedAppSettings {
    const row = this.database.prepare(`
      SELECT value_json, updated_at, version
      FROM settings
      WHERE key = ?
    `).get(settingsKey) as SettingsRow | undefined

    if (row === undefined) {
      return { ...defaultSettings }
    }

    return parseSettings(row.value_json, row.updated_at, row.version)
  }

  update(
    input: PersistedAppSettings,
    actorId: string,
    source: ActivitySource,
  ): PersistedAppSettings {
    let validated: PersistedAppSettings
    let validatedSource: ActivitySource

    try {
      validated = persistedAppSettingsSchema.parse(input)
      validatedSource = activitySourceSchema.parse(source)
    } catch {
      throw settingsInvalid()
    }

    try {
      return withImmediateTransaction(this.database, () => {
        const row = this.database.prepare(`
        SELECT value_json, updated_at, version
        FROM settings
        WHERE key = ?
      `).get(settingsKey) as SettingsRow | undefined
        const current = row === undefined
          ? { ...defaultSettings }
          : parseSettings(row.value_json, row.updated_at, row.version)

        if (validated.version !== current.version) {
          throw new DomainError(
            'SETTINGS_VERSION_CONFLICT',
            'Settings changed since they were read',
            {
              expectedVersion: validated.version,
              actualVersion: current.version,
            },
          )
        }

        if (sameSettings(current, validated)) {
          return current
        }

        const updated: PersistedAppSettings = {
          theme: validated.theme,
          background: validated.background,
          accent: validated.accent,
          density: validated.density,
          updatedAt: new Date().toISOString(),
          version: current.version + 1,
        }
        const valueJson = JSON.stringify({
          theme: updated.theme,
          background: updated.background,
          accent: updated.accent,
          density: updated.density,
        })

        this.database.prepare(`
        INSERT INTO settings (key, value_json, updated_at, version)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at,
          version = excluded.version
        `).run(settingsKey, valueJson, updated.updatedAt, updated.version)

        recordActivity(this.database, {
          actorId,
          source: validatedSource,
          operation: 'settings.update',
          entityType: 'settings',
          entityId: settingsKey,
          action: 'Updated application settings',
          details: { version: updated.version },
          createdAt: updated.updatedAt,
        })

        return updated
      })
    } catch (error) {
      if (error instanceof DomainError) {
        throw error
      }
      throw new DomainError(
        'SETTINGS_UPDATE_FAILED',
        'Settings could not be updated',
      )
    }
  }
}
