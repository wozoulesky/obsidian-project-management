import type { DatabaseSync } from 'node:sqlite'
import {
  ActivityService,
  ActorService,
  BackupService,
  DashboardService,
  DefectService,
  DomainError,
  ExportService,
  openDatabase,
  ProjectService,
  RequirementService,
  SettingsService,
  TaskService,
  TokenService,
} from '@project-os/core'
import type {
  DatabaseLifecycle,
  ExportDocument,
} from '@project-os/core'

export type AppServices = {
  activities: ActivityService
  actors: ActorService
  backups: BackupService
  dashboard: DashboardService
  defects: DefectService
  exports: ExportService
  projects: ProjectService
  requirements: RequirementService
  settings: SettingsService
  tasks: TaskService
  tokens: TokenService
}

export type AppContext = {
  readonly database: DatabaseSync
  readonly services: AppServices
  close(): void
}

export type AppContextOptions = {
  databasePath: string
  backupRoot: string
}

const seedTimestamp = '2026-07-29T00:00:00.000Z'
const ownerId = 'actor_local_owner'
const projectId = 'project_default'

export const defaultSeedDocument = {
  schemaVersion: 1,
  exportedAt: seedTimestamp,
  actors: [{
    id: ownerId,
    name: 'Local Owner',
    kind: 'human',
    role: 'owner',
    status: 'active',
    client: null,
    capabilities: [],
    registeredAt: seedTimestamp,
    lastActiveAt: null,
    version: 1,
  }],
  projects: [{
    id: projectId,
    code: 'DEFAULT',
    name: 'Default Project',
    description: 'Local Project OS workspace',
    ownerId,
    startDate: null,
    dueDate: null,
    status: 'not_started',
    progress: 0,
    createdAt: seedTimestamp,
    updatedAt: seedTimestamp,
    version: 1,
  }],
  projectMembers: [{
    projectId,
    actorId: ownerId,
    membershipRole: 'owner',
    joinedAt: seedTimestamp,
  }],
  tasks: [],
  requirements: [],
  defects: [],
  settings: {
    theme: 'system',
    background: 'soft',
    accent: 'blue',
    density: 'comfortable',
    updatedAt: seedTimestamp,
    version: 1,
  },
} satisfies ExportDocument

class LocalDatabaseLifecycle implements DatabaseLifecycle {
  private current: DatabaseSync | undefined

  constructor(
    public readonly databasePath: string,
  ) {
    this.current = openDatabase(databasePath)
  }

  getDatabase(): DatabaseSync {
    if (this.current === undefined) {
      throw new DomainError(
        'DATABASE_UNAVAILABLE',
        'Database is unavailable',
      )
    }
    return this.current
  }

  closeDatabase(): void {
    const database = this.current
    this.current = undefined
    database?.close()
  }

  replaceDatabase(database: DatabaseSync): void {
    this.current = database
  }
}

export function createAppContext(options: AppContextOptions): AppContext {
  const lifecycle = new LocalDatabaseLifecycle(options.databasePath)
  const database = lifecycle.getDatabase()
  let services: AppServices
  try {
    services = {
      activities: new ActivityService(database),
      actors: new ActorService(database),
      backups: new BackupService(lifecycle, options.backupRoot),
      dashboard: new DashboardService(database),
      defects: new DefectService(database),
      exports: new ExportService(database),
      projects: new ProjectService(database),
      requirements: new RequirementService(database),
      settings: new SettingsService(database),
      tasks: new TaskService(database),
      tokens: new TokenService(database),
    }
  } catch (error) {
    lifecycle.closeDatabase()
    throw error
  }

  return {
    get database() {
      return lifecycle.getDatabase()
    },
    services,
    close() {
      lifecycle.closeDatabase()
    },
  }
}
