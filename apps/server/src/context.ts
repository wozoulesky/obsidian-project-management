import type { DatabaseSync } from 'node:sqlite'
import { realpathSync } from 'node:fs'
import {
  ActivityService,
  ActorService,
  BackupService,
  BriefingService,
  DashboardService,
  DefectService,
  DeliverableService,
  DomainError,
  ExportService,
  HandoffService,
  openDatabase,
  ProjectService,
  RequirementService,
  SessionService,
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
  briefing: BriefingService
  dashboard: DashboardService
  defects: DefectService
  deliverables: DeliverableService
  exports: ExportService
  handoffs: HandoffService
  projects: ProjectService
  requirements: RequirementService
  sessions: SessionService
  settings: SettingsService
  tasks: TaskService
  tokens: TokenService
}

export type AppContext = {
  readonly database: DatabaseSync
  readonly services: AppServices
  readonly localActorId: string
  readonly backupRoot: string
  close(): void
}

export type AppContextOptions = {
  databasePath: string
  backupRoot: string
  localActorId?: string
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
    lastBriefingActivityId: null,
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
  sessions: [],
  handoffs: [],
  deliverables: [],
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

function liveService<Service extends object>(
  factory: () => Service,
): Service {
  return new Proxy({} as Service, {
    get(_target, property) {
      return (...args: unknown[]) => {
        const service = factory()
        const member = Reflect.get(service, property, service) as unknown
        if (typeof member !== 'function') {
          return member
        }
        return Reflect.apply(member, service, args) as unknown
      }
    },
  })
}

export function createAppContext(options: AppContextOptions): AppContext {
  const lifecycle = new LocalDatabaseLifecycle(options.databasePath)
  let services: AppServices
  try {
    const backups = new BackupService(lifecycle, options.backupRoot)
    services = {
      activities: liveService(() =>
        new ActivityService(lifecycle.getDatabase())),
      actors: liveService(() =>
        new ActorService(lifecycle.getDatabase())),
      backups,
      briefing: liveService(() =>
        new BriefingService(lifecycle.getDatabase())),
      dashboard: liveService(() =>
        new DashboardService(lifecycle.getDatabase())),
      defects: liveService(() =>
        new DefectService(lifecycle.getDatabase())),
      deliverables: liveService(() =>
        new DeliverableService(lifecycle.getDatabase())),
      exports: liveService(() =>
        new ExportService(lifecycle.getDatabase())),
      handoffs: liveService(() =>
        new HandoffService(lifecycle.getDatabase())),
      projects: liveService(() =>
        new ProjectService(lifecycle.getDatabase())),
      requirements: liveService(() =>
        new RequirementService(lifecycle.getDatabase())),
      sessions: liveService(() =>
        new SessionService(lifecycle.getDatabase())),
      settings: liveService(() =>
        new SettingsService(lifecycle.getDatabase())),
      tasks: liveService(() =>
        new TaskService(lifecycle.getDatabase())),
      tokens: liveService(() =>
        new TokenService(lifecycle.getDatabase())),
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
    localActorId: options.localActorId ?? ownerId,
    backupRoot: realpathSync(options.backupRoot),
    close() {
      lifecycle.closeDatabase()
    },
  }
}
