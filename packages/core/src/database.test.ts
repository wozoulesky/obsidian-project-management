import {
  existsSync,
  mkdtempSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { persistedActorSchema } from '@project-os/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import { createTestDatabase, openDatabase } from './database.js'
import { DomainError } from './errors.js'
import {
  runMigrations,
  validateMigrationVersions,
} from './migrations.js'

const approvedTables = [
  'access_tokens',
  'activities',
  'actors',
  'defects',
  'deliverables',
  'handoffs',
  'project_members',
  'projects',
  'requirement_tasks',
  'requirements',
  'schema_migrations',
  'sessions',
  'settings',
  'tasks',
]

function insertActor(
  database: DatabaseSync,
  {
    id = 'actor-1',
    registeredAt = '2026-07-29T08:00:00.000Z',
    lastActiveAt = null,
    capabilitiesJson = '[]',
  }: {
    id?: string
    registeredAt?: string
    lastActiveAt?: string | null
    capabilitiesJson?: string
  } = {},
): void {
  database
    .prepare(`
      INSERT INTO actors (
        id, name, kind, role, status, client, capabilities_json,
        registered_at, last_active_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      id,
      'Lin',
      'human',
      'owner',
      'active',
      null,
      capabilitiesJson,
      registeredAt,
      lastActiveAt,
      1,
    )
}

function insertProject(
  database: DatabaseSync,
  {
    id = 'project-1',
    startDate = '2026-07-29',
    dueDate = '2026-08-31',
    createdAt = '2026-07-29T08:00:00.000Z',
    updatedAt = '2026-07-29T08:00:00Z',
  }: {
    id?: string
    startDate?: string | null
    dueDate?: string | null
    createdAt?: string
    updatedAt?: string
  } = {},
): void {
  database
    .prepare(`
      INSERT INTO projects (
        id, code, name, description, owner_id, start_date, due_date,
        status, progress, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      id,
      `PRJ-${id}`,
      'Atlas',
      '',
      'actor-1',
      startDate,
      dueDate,
      'not_started',
      0,
      createdAt,
      updatedAt,
      1,
    )
}

function insertTask(
  database: DatabaseSync,
  {
    id = 'task-1',
    startDate = '2026-07-29',
    dueDate = '2026-08-01',
    createdAt = '2026-07-29T08:00:00Z',
    updatedAt = '2026-07-29T08:00:00.000Z',
    dependencyIdsJson = '[]',
  }: {
    id?: string
    startDate?: string
    dueDate?: string
    createdAt?: string
    updatedAt?: string
    dependencyIdsJson?: string
  } = {},
): void {
  database
    .prepare(`
      INSERT INTO tasks (
        id, code, project_id, title, description, assignee_id,
        start_date, due_date, priority, status, progress, milestone_id,
        dependency_ids_json, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      id,
      `TASK-${id}`,
      'project-1',
      'Implement canonical dates',
      '',
      'actor-1',
      startDate,
      dueDate,
      'P1',
      'not_started',
      0,
      'm1',
      dependencyIdsJson,
      createdAt,
      updatedAt,
      1,
    )
}

function insertRequirement(
  database: DatabaseSync,
  acceptanceCriteriaJson: string,
): void {
  database
    .prepare(`
      INSERT INTO requirements (
        id, code, project_id, title, description, priority, status,
        acceptance_criteria_json, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      'requirement-1',
      'REQ-001',
      'project-1',
      'Canonical persistence',
      '',
      'P1',
      'draft',
      acceptanceCriteriaJson,
      '2026-07-29T08:00:00Z',
      '2026-07-29T08:00:00.123Z',
      1,
    )
}

function insertDefect(
  database: DatabaseSync,
  reproductionStepsJson: string,
): void {
  database
    .prepare(`
      INSERT INTO defects (
        id, code, project_id, title, description, severity, status,
        assignee_id, reproduction_steps_json, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      'defect-1',
      'BUG-001',
      'project-1',
      'Reject invalid JSON shapes',
      '',
      'normal',
      'open',
      'actor-1',
      reproductionStepsJson,
      '2026-07-29T08:00:00.123Z',
      '2026-07-29T08:00:01.123Z',
      1,
    )
}

const v1DatePattern =
  '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
const v1TimestampMinutePattern =
  `${v1DatePattern}T[0-9][0-9]:[0-9][0-9]`
const v1TimestampBasePattern =
  `${v1DatePattern}T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]`

function v1CanonicalDate(column: string): string {
  return `(
    length(${column}) = 10
    AND ${column} GLOB '${v1DatePattern}'
    AND date(${column}) IS NOT NULL
    AND strftime('%Y-%m-%d', ${column}) = ${column}
  )`
}

function v1OptionalCanonicalDate(column: string): string {
  return `(${column} IS NULL OR ${v1CanonicalDate(column)})`
}

function v1CanonicalUtcTimestamp(column: string): string {
  const baseTimestamp = `substr(${column}, 1, 19)`
  const utcBaseTimestamp = `(${baseTimestamp} || 'Z')`
  const fraction = `substr(${column}, 21, length(${column}) - 21)`

  return `(
    (
      length(${column}) = 17
      AND ${column} GLOB '${v1TimestampMinutePattern}Z'
      AND datetime(${column}) IS NOT NULL
      AND strftime('%Y-%m-%dT%H:%MZ', ${column}) = ${column}
    )
    OR
    (
      length(${column}) = 20
      AND ${column} GLOB '${v1TimestampBasePattern}Z'
      AND datetime(${column}) IS NOT NULL
      AND strftime('%Y-%m-%dT%H:%M:%SZ', ${column}) = ${column}
    )
    OR (
      length(${column}) >= 22
      AND ${baseTimestamp} GLOB '${v1TimestampBasePattern}'
      AND substr(${column}, 20, 1) = '.'
      AND substr(${column}, -1) = 'Z'
      AND length(${fraction}) >= 1
      AND ${fraction} NOT GLOB '*[^0-9]*'
      AND datetime(${column}) IS NOT NULL
      AND datetime(${utcBaseTimestamp}) IS NOT NULL
      AND strftime('%Y-%m-%dT%H:%M:%SZ', ${utcBaseTimestamp})
        = ${utcBaseTimestamp}
    )
  )`
}

function v1OptionalCanonicalUtcTimestamp(column: string): string {
  return `(${column} IS NULL OR ${v1CanonicalUtcTimestamp(column)})`
}

function createV1RelayFixture(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY CHECK (version >= 1),
      applied_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE actors (
      id TEXT PRIMARY KEY CHECK (length(id) > 0),
      name TEXT NOT NULL CHECK (length(name) > 0),
      kind TEXT NOT NULL CHECK (kind IN ('human', 'agent')),
      role TEXT NOT NULL CHECK (
        role IN (
          'owner',
          'member',
          'pm-agent',
          'dev-agent',
          'qa-agent',
          'doc-agent'
        )
      ),
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
      client TEXT,
      capabilities_json TEXT NOT NULL DEFAULT '[]'
        CHECK (
          json_valid(capabilities_json)
          AND json_type(capabilities_json) = 'array'
        ),
      registered_at TEXT NOT NULL
        CHECK (${v1CanonicalUtcTimestamp('registered_at')}),
      last_active_at TEXT
        CHECK (${v1OptionalCanonicalUtcTimestamp('last_active_at')}),
      version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
      CHECK (
        (
          kind = 'human'
          AND role IN ('owner', 'member')
          AND client IS NULL
        )
        OR (
          kind = 'agent'
          AND role IN ('pm-agent', 'dev-agent', 'qa-agent', 'doc-agent')
          AND client IS NOT NULL
          AND length(client) > 0
        )
      )
    ) STRICT;

    CREATE TABLE projects (
      id TEXT PRIMARY KEY CHECK (length(id) > 0),
      code TEXT NOT NULL UNIQUE CHECK (length(code) > 0),
      name TEXT NOT NULL CHECK (length(name) > 0),
      description TEXT NOT NULL DEFAULT '',
      owner_id TEXT NOT NULL,
      start_date TEXT,
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'not_started'
        CHECK (
          status IN (
            'not_started',
            'in_progress',
            'on_hold',
            'completed',
            'cancelled'
          )
        ),
      progress INTEGER NOT NULL DEFAULT 0
        CHECK (progress BETWEEN 0 AND 100),
      created_at TEXT NOT NULL
        CHECK (${v1CanonicalUtcTimestamp('created_at')}),
      updated_at TEXT NOT NULL
        CHECK (${v1CanonicalUtcTimestamp('updated_at')}),
      version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
      FOREIGN KEY (owner_id) REFERENCES actors (id) ON DELETE RESTRICT,
      CHECK (${v1OptionalCanonicalDate('start_date')}),
      CHECK (${v1OptionalCanonicalDate('due_date')})
    ) STRICT;

    CREATE TABLE activities (
      id TEXT PRIMARY KEY CHECK (length(id) > 0),
      actor_id TEXT NOT NULL,
      project_id TEXT,
      source TEXT NOT NULL CHECK (source IN ('web', 'mcp')),
      operation TEXT NOT NULL CHECK (
        operation IN (
          'actor.create',
          'actor.update',
          'actor.deactivate',
          'actor.register',
          'project.create',
          'project.update',
          'project.member.add',
          'task.create',
          'task.update',
          'task.schedule',
          'task.progress',
          'requirement.create',
          'requirement.update',
          'defect.create',
          'defect.update',
          'defect.to_task',
          'settings.update',
          'backup.create',
          'backup.restore',
          'import.run',
          'token.issue',
          'token.revoke'
        )
      ),
      entity_type TEXT NOT NULL CHECK (length(entity_type) > 0),
      entity_id TEXT NOT NULL CHECK (length(entity_id) > 0),
      action TEXT NOT NULL CHECK (length(action) > 0),
      note TEXT,
      details_json TEXT NOT NULL DEFAULT '{}'
        CHECK (json_valid(details_json)),
      created_at TEXT NOT NULL
        CHECK (${v1CanonicalUtcTimestamp('created_at')}),
      FOREIGN KEY (actor_id) REFERENCES actors (id) ON DELETE RESTRICT,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE SET NULL
    ) STRICT;

    CREATE INDEX activities_created_at_idx
      ON activities (created_at DESC);
    CREATE INDEX activities_entity_idx
      ON activities (entity_type, entity_id, created_at DESC);
    CREATE INDEX activities_project_id_idx ON activities (project_id);

    INSERT INTO schema_migrations (version, applied_at)
    VALUES (1, '2026-07-29T08:00:00Z');
    INSERT INTO actors (
      id, name, kind, role, status, client, capabilities_json,
      registered_at, last_active_at, version
    ) VALUES (
      'actor-v1', 'Legacy owner', 'human', 'owner', 'active', NULL,
      '["planning"]', '2026-07-29T08:00:00.123Z',
      '2026-07-29T08:05:00Z', 4
    );
    INSERT INTO projects (
      id, code, name, description, owner_id, start_date, due_date,
      status, progress, created_at, updated_at, version
    ) VALUES (
      'project-v1', 'PRJ-V1', 'Legacy project', 'preserved', 'actor-v1',
      '2026-07-29', '2026-08-31', 'in_progress', 42,
      '2026-07-29T08:00:00Z', '2026-07-29T08:05:00.123Z', 3
    );
    INSERT INTO activities (
      id, actor_id, project_id, source, operation, entity_type,
      entity_id, action, note, details_json, created_at
    ) VALUES (
      'activity-v1', 'actor-v1', 'project-v1', 'mcp', 'task.update',
      'task', 'task-v1', 'changed fields', 'preserve
verbatim', '{"nested":{"flag":true},"items":[1,"two"]}',
      '2026-07-29T08:05:00.123456Z'
    );
  `)
  return database
}

function insertSession(
  database: DatabaseSync,
  {
    id = 'session-1',
    projectId = 'project-1',
    agentId = 'actor-1',
    intent = 'Deliver relay foundations',
    taskIdsJson = '[]',
    status = 'active',
    createdAt = '2026-07-29T08:00:00Z',
    lastActiveAt = '2026-07-29T08:00:01.123Z',
    closedAt = null,
  }: {
    id?: string
    projectId?: string
    agentId?: string
    intent?: string
    taskIdsJson?: string
    status?: string
    createdAt?: string
    lastActiveAt?: string
    closedAt?: string | null
  } = {},
): void {
  database.prepare(`
    INSERT INTO sessions (
      id, project_id, agent_id, intent, task_ids_json, status, summary,
      created_at, last_active_at, closed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    projectId,
    agentId,
    intent,
    taskIdsJson,
    status,
    null,
    createdAt,
    lastActiveAt,
    closedAt,
  )
}

function insertHandoff(
  database: DatabaseSync,
  {
    id = 'handoff-1',
    projectId = 'project-1',
    sessionId = 'session-1',
    authorId = 'actor-1',
    summary = 'Relay state',
    doneJson = '[]',
    blockersJson = '[]',
    nextStepsJson = '[]',
    gotchasJson = '[]',
    refsJson = '{}',
    createdAt = '2026-07-29T08:00:02Z',
  }: {
    id?: string
    projectId?: string
    sessionId?: string | null
    authorId?: string
    summary?: string
    doneJson?: string
    blockersJson?: string
    nextStepsJson?: string
    gotchasJson?: string
    refsJson?: string
    createdAt?: string
  } = {},
): void {
  database.prepare(`
    INSERT INTO handoffs (
      id, project_id, session_id, author_id, summary, done_json,
      blockers_json, next_steps_json, gotchas_json, refs_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    projectId,
    sessionId,
    authorId,
    summary,
    doneJson,
    blockersJson,
    nextStepsJson,
    gotchasJson,
    refsJson,
    createdAt,
  )
}

function insertDeliverable(
  database: DatabaseSync,
  {
    id = 'deliverable-1',
    projectId = 'project-1',
    requirementId = 'requirement-1',
    taskId = null,
    title = 'Relay implementation',
    kind = 'commit',
    ref = 'abc123',
    createdBy = 'actor-1',
    sessionId = 'session-1',
    createdAt = '2026-07-29T08:00:03.123456Z',
  }: {
    id?: string
    projectId?: string
    requirementId?: string | null
    taskId?: string | null
    title?: string
    kind?: string
    ref?: string
    createdBy?: string
    sessionId?: string | null
    createdAt?: string
  } = {},
): void {
  database.prepare(`
    INSERT INTO deliverables (
      id, project_id, requirement_id, task_id, title, kind, ref, note,
      created_by, session_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    projectId,
    requirementId,
    taskId,
    title,
    kind,
    ref,
    null,
    createdBy,
    sessionId,
    createdAt,
  )
}

describe('database bootstrap', () => {
  const opened: DatabaseSync[] = []
  const temporaryDirectories: string[] = []

  afterEach(() => {
    opened.splice(0).forEach((database) => database.close())
    temporaryDirectories.splice(0).forEach((directory) => {
      rmSync(directory, { force: true, recursive: true })
    })
  })

  it('enables safety pragmas and creates every approved table', () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'project-os-memory-'))
    temporaryDirectories.push(workingDirectory)
    const originalDirectory = process.cwd()
    process.chdir(workingDirectory)

    let database: DatabaseSync
    try {
      database = createTestDatabase()
    } finally {
      process.chdir(originalDirectory)
    }
    opened.push(database)

    expect(database.prepare('PRAGMA foreign_keys').get()).toEqual({
      foreign_keys: 1,
    })
    expect(database.prepare('PRAGMA journal_mode').get()).toEqual({
      journal_mode: 'memory',
    })
    expect(existsSync(join(workingDirectory, 'data'))).toBe(false)

    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name)

    expect(tables).toEqual(approvedTables)
  })

  it('creates parent directories and configures file databases for WAL', () => {
    const directory = mkdtempSync(join(tmpdir(), 'project-os-file-'))
    temporaryDirectories.push(directory)
    const databasePath = join(directory, 'nested', 'project-os.sqlite')

    const database = openDatabase(databasePath)
    opened.push(database)

    expect(existsSync(databasePath)).toBe(true)
    expect(database.prepare('PRAGMA foreign_keys').get()).toEqual({
      foreign_keys: 1,
    })
    expect(database.prepare('PRAGMA busy_timeout').get()).toEqual({
      timeout: 5000,
    })
    expect(database.prepare('PRAGMA journal_mode').get()).toEqual({
      journal_mode: 'wal',
    })
  })

  it('applies migrations 001 and 002 only once', () => {
    const database = createTestDatabase()
    opened.push(database)

    runMigrations(database)
    runMigrations(database)

    expect(
      database
        .prepare('SELECT version FROM schema_migrations ORDER BY version')
        .all(),
    ).toEqual([{ version: 1 }, { version: 2 }])
  })

  it('enforces foreign keys', () => {
    const database = createTestDatabase()
    opened.push(database)

    expect(() => {
      database
        .prepare(`
          INSERT INTO projects (
            id, code, name, description, owner_id, status, progress,
            created_at, updated_at, version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          'project-1',
          'PRJ-001',
          'Atlas',
          '',
          'missing-actor',
          'not_started',
          0,
          '2026-07-29T00:00:00.000Z',
          '2026-07-29T00:00:00.000Z',
          1,
        )
    }).toThrow(/foreign key constraint failed/i)
  })

  it('rolls migration 001 back completely when a statement conflicts', () => {
    const database = new DatabaseSync(':memory:')
    opened.push(database)
    database.exec('CREATE TABLE projects (id TEXT PRIMARY KEY) STRICT')

    expect(() => runMigrations(database)).toThrow(/projects already exists/i)

    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name)
    expect(tables).toEqual(['projects'])
  })

  it('fails closed when the database schema is newer than this runtime', () => {
    const database = createTestDatabase()
    opened.push(database)
    database
      .prepare(`
        INSERT INTO schema_migrations (version, applied_at)
        VALUES (?, ?)
      `)
      .run(3, '2026-07-29T08:00:00Z')

    expect(() => runMigrations(database)).toThrow(
      expect.objectContaining({
        code: 'DATABASE_SCHEMA_NEWER',
        details: {
          databaseVersion: 3,
          latestKnownVersion: 2,
        },
        name: 'DomainError',
      }),
    )
  })

  it('rejects duplicate or out-of-order migration definitions', () => {
    expect(() => validateMigrationVersions([1, 1])).toThrow(
      /strictly ascending/i,
    )
    expect(() => validateMigrationVersions([2, 1])).toThrow(
      /strictly ascending/i,
    )
    expect(validateMigrationVersions([1, 3])).toBe(3)
  })
})

describe('migration 002 relay schema', () => {
  const opened: DatabaseSync[] = []

  afterEach(() => {
    opened.splice(0).forEach((database) => database.close())
  })

  it('rebuilds v1 activities without changing any stored activity data', () => {
    const database = createV1RelayFixture()
    opened.push(database)
    const activityColumns = [
      'id',
      'actor_id',
      'project_id',
      'source',
      'operation',
      'entity_type',
      'entity_id',
      'action',
      'note',
      'details_json',
      'created_at',
    ]
    const selectActivity = `
      SELECT ${activityColumns.join(', ')}
      FROM activities
      WHERE id = 'activity-v1'
    `
    const before = database.prepare(selectActivity).get()
    const beforeRootPage = database.prepare(`
      SELECT rootpage
      FROM sqlite_master
      WHERE type = 'table' AND name = 'activities'
    `).get()?.rootpage

    expect(() => {
      database.prepare(`
        INSERT INTO activities (
          id, actor_id, project_id, source, operation, entity_type,
          entity_id, action, details_json, created_at
        ) VALUES (
          'activity-rejected', 'actor-v1', 'project-v1', 'mcp',
          'session.checkin', 'session', 'session-v1', 'check in', '{}',
          '2026-07-29T08:06:00Z'
        )
      `).run()
    }).toThrow(/check constraint failed/i)

    runMigrations(database)

    expect(database.prepare(selectActivity).get()).toEqual(before)
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM activities').get(),
    ).toEqual({ count: 1 })
    expect(
      database
        .prepare('SELECT version FROM schema_migrations ORDER BY version')
        .all(),
    ).toEqual([{ version: 1 }, { version: 2 }])

    expect(() => {
      database.prepare(`
        INSERT INTO activities (
          id, actor_id, project_id, source, operation, entity_type,
          entity_id, action, details_json, created_at
        ) VALUES (
          'activity-relay', 'actor-v1', 'project-v1', 'mcp',
          'session.checkin', 'session', 'session-v1', 'check in', '{}',
          '2026-07-29T08:06:00Z'
        )
      `).run()
    }).not.toThrow()

    const activityTable = database.prepare(`
      SELECT name, sql
      FROM sqlite_master
      WHERE type = 'table' AND name IN ('activities', 'activities_v2')
      ORDER BY name
    `).all()
    expect(activityTable).toHaveLength(1)
    expect(activityTable[0]?.name).toBe('activities')
    expect(
      database.prepare(`
        SELECT rootpage
        FROM sqlite_master
        WHERE type = 'table' AND name = 'activities'
      `).get()?.rootpage,
    ).not.toBe(beforeRootPage)
    for (const operation of [
      'session.checkin',
      'session.note',
      'session.checkout',
      'handoff.update',
      'deliverable.record',
    ]) {
      expect(activityTable[0]?.sql).toContain(`'${operation}'`)
    }

    const indexes = database.prepare(`
      SELECT name, sql
      FROM sqlite_master
      WHERE type = 'index' AND tbl_name = 'activities' AND sql IS NOT NULL
      ORDER BY name
    `).all()
    expect(indexes).toEqual([
      {
        name: 'activities_created_at_idx',
        sql: expect.stringMatching(
          /ON activities\s*\(created_at DESC\)/i,
        ),
      },
      {
        name: 'activities_entity_idx',
        sql: expect.stringMatching(
          /ON activities\s*\(entity_type, entity_id, created_at DESC\)/i,
        ),
      },
      {
        name: 'activities_project_id_idx',
        sql: expect.stringMatching(
          /ON activities\s*\(project_id\)/i,
        ),
      },
    ])
  })

  it('adds the nullable actor briefing waterline and relay indexes', () => {
    const database = createTestDatabase()
    opened.push(database)

    const waterlineColumn = database.prepare(`
      SELECT name, type, "notnull", dflt_value, pk
      FROM pragma_table_info('actors')
      WHERE name = 'last_briefing_activity_id'
    `).get()
    expect(waterlineColumn).toEqual({
      name: 'last_briefing_activity_id',
      type: 'TEXT',
      notnull: 0,
      dflt_value: null,
      pk: 0,
    })

    insertActor(database)
    expect(
      database.prepare(`
        SELECT last_briefing_activity_id
        FROM actors
        WHERE id = 'actor-1'
      `).get(),
    ).toEqual({ last_briefing_activity_id: null })
    expect(
      database.prepare(`
        SELECT *
        FROM pragma_foreign_key_list('actors')
        WHERE "from" = 'last_briefing_activity_id'
      `).get(),
    ).toBeUndefined()

    const relayIndexes = database.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'index'
        AND name IN (
          'sessions_project_id_idx',
          'sessions_agent_id_idx',
          'sessions_status_idx',
          'handoffs_project_created_at_idx',
          'deliverables_project_id_idx',
          'deliverables_requirement_id_idx'
        )
      ORDER BY name
    `).all()
    expect(relayIndexes).toEqual([
      { name: 'deliverables_project_id_idx' },
      { name: 'deliverables_requirement_id_idx' },
      { name: 'handoffs_project_created_at_idx' },
      { name: 'sessions_agent_id_idx' },
      { name: 'sessions_project_id_idx' },
      { name: 'sessions_status_idx' },
    ])
  })

  it('enforces session checks, foreign keys, timestamps, and text arrays', () => {
    const database = createTestDatabase()
    opened.push(database)
    insertActor(database)
    insertProject(database)
    insertSession(database, { taskIdsJson: '["task-1"]' })

    expect(() => {
      insertSession(database, {
        id: 'session-abandoned',
        status: 'abandoned',
      })
    }).toThrow(/check constraint failed/i)
    expect(() => {
      insertSession(database, {
        id: 'session-empty-intent',
        intent: '',
      })
    }).toThrow(/check constraint failed/i)
    expect(() => {
      insertSession(database, {
        id: 'session-bad-json-shape',
        taskIdsJson: '{}',
      })
    }).toThrow(/check constraint failed/i)
    expect(() => {
      insertSession(database, {
        id: 'session-bad-json-element',
        taskIdsJson: '["task-1", 2]',
      })
    }).toThrow(/must contain only text values/i)
    expect(() => {
      database.prepare(`
        UPDATE sessions
        SET task_ids_json = '["task-1", 2]'
        WHERE id = 'session-1'
      `).run()
    }).toThrow(/must contain only text values/i)
    expect(() => {
      insertSession(database, {
        id: 'session-bad-created',
        createdAt: '2026-07-29 08:00:00',
      })
    }).toThrow(/check constraint failed/i)
    expect(() => {
      insertSession(database, {
        id: 'session-bad-closed',
        closedAt: 'not-a-timestamp',
      })
    }).toThrow(/check constraint failed/i)
    expect(() => {
      insertSession(database, {
        id: 'session-missing-project',
        projectId: 'missing-project',
      })
    }).toThrow(/foreign key constraint failed/i)
    expect(() => {
      insertSession(database, {
        id: 'session-missing-agent',
        agentId: 'missing-agent',
      })
    }).toThrow(/foreign key constraint failed/i)
  })

  it('enforces handoff checks, foreign keys, JSON, and timestamp rules', () => {
    const database = createTestDatabase()
    opened.push(database)
    insertActor(database)
    insertProject(database)
    insertSession(database)
    insertHandoff(database, {
      doneJson: '["schema"]',
      blockersJson: '["none"]',
      nextStepsJson: '["services"]',
      gotchasJson: '["timestamps"]',
      refsJson: '{"commit":"abc123"}',
    })

    expect(
      database.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'trigger' AND tbl_name = 'handoffs'
        ORDER BY name
      `).all(),
    ).toEqual([
      { name: 'handoffs_blockers_json_text_array_insert' },
      { name: 'handoffs_blockers_json_text_array_update' },
      { name: 'handoffs_done_json_text_array_insert' },
      { name: 'handoffs_done_json_text_array_update' },
      { name: 'handoffs_gotchas_json_text_array_insert' },
      { name: 'handoffs_gotchas_json_text_array_update' },
      { name: 'handoffs_next_steps_json_text_array_insert' },
      { name: 'handoffs_next_steps_json_text_array_update' },
    ])

    for (const column of [
      'done_json',
      'blockers_json',
      'next_steps_json',
      'gotchas_json',
    ]) {
      expect(() => {
        database.prepare(`
          UPDATE handoffs
          SET ${column} = '["valid", 1]'
          WHERE id = 'handoff-1'
        `).run()
      }, column).toThrow(/must contain only text values/i)
    }

    expect(() => {
      insertHandoff(database, {
        id: 'handoff-bad-json-shape',
        blockersJson: '{}',
      })
    }).toThrow(/check constraint failed/i)
    expect(() => {
      insertHandoff(database, {
        id: 'handoff-bad-json-element',
        nextStepsJson: '["valid", false]',
      })
    }).toThrow(/must contain only text values/i)
    expect(() => {
      insertHandoff(database, {
        id: 'handoff-bad-refs',
        refsJson: 'not-json',
      })
    }).toThrow(/check constraint failed/i)
    expect(() => {
      insertHandoff(database, {
        id: 'handoff-empty-summary',
        summary: '',
      })
    }).toThrow(/check constraint failed/i)
    expect(() => {
      insertHandoff(database, {
        id: 'handoff-bad-created',
        createdAt: '2026-07-29T08:00:00+00:00',
      })
    }).toThrow(/check constraint failed/i)
    expect(() => {
      insertHandoff(database, {
        id: 'handoff-missing-session',
        sessionId: 'missing-session',
      })
    }).toThrow(/foreign key constraint failed/i)
    expect(() => {
      insertHandoff(database, {
        id: 'handoff-missing-author',
        authorId: 'missing-author',
      })
    }).toThrow(/foreign key constraint failed/i)
  })

  it('enforces deliverable checks, anchors, foreign keys, and timestamps', () => {
    const database = createTestDatabase()
    opened.push(database)
    insertActor(database)
    insertProject(database)
    insertTask(database)
    insertRequirement(database, '["Accepted"]')
    insertSession(database)
    insertDeliverable(database)
    insertDeliverable(database, {
      id: 'deliverable-task',
      requirementId: null,
      taskId: 'task-1',
      kind: 'file',
      ref: 'packages/core/src/migrations.ts',
    })

    expect(() => {
      insertDeliverable(database, {
        id: 'deliverable-no-anchor',
        requirementId: null,
        taskId: null,
      })
    }).toThrow(/check constraint failed/i)
    expect(() => {
      insertDeliverable(database, {
        id: 'deliverable-bad-kind',
        kind: 'artifact',
      })
    }).toThrow(/check constraint failed/i)
    expect(() => {
      insertDeliverable(database, {
        id: 'deliverable-empty-title',
        title: '',
      })
    }).toThrow(/check constraint failed/i)
    expect(() => {
      insertDeliverable(database, {
        id: 'deliverable-empty-ref',
        ref: '',
      })
    }).toThrow(/check constraint failed/i)
    expect(() => {
      insertDeliverable(database, {
        id: 'deliverable-bad-created',
        createdAt: 'yesterday',
      })
    }).toThrow(/check constraint failed/i)
    expect(() => {
      insertDeliverable(database, {
        id: 'deliverable-missing-requirement',
        requirementId: 'missing-requirement',
      })
    }).toThrow(/foreign key constraint failed/i)
    expect(() => {
      insertDeliverable(database, {
        id: 'deliverable-missing-task',
        requirementId: null,
        taskId: 'missing-task',
      })
    }).toThrow(/foreign key constraint failed/i)
    expect(() => {
      insertDeliverable(database, {
        id: 'deliverable-missing-creator',
        createdBy: 'missing-actor',
      })
    }).toThrow(/foreign key constraint failed/i)
    expect(() => {
      insertDeliverable(database, {
        id: 'deliverable-missing-session',
        sessionId: 'missing-session',
      })
    }).toThrow(/foreign key constraint failed/i)
  })
})

describe('canonical SQLite dates', () => {
  const opened: DatabaseSync[] = []

  afterEach(() => {
    opened.splice(0).forEach((database) => database.close())
  })

  it.each(['not-a-date', '2026-02-30'])(
    'rejects %s in project and task date fields',
    (invalidDate) => {
      const database = createTestDatabase()
      opened.push(database)
      insertActor(database)

      expect(() => {
        insertProject(database, { startDate: invalidDate })
      }).toThrow(/check constraint failed/i)

      insertProject(database)

      expect(() => {
        insertTask(database, { startDate: invalidDate })
      }).toThrow(/check constraint failed/i)
    },
  )

  it.each([
    'garbageZ',
    '2026-07-29T08:00:00+08:00',
    '2026-02-30T08:00:00.1Z',
  ])('rejects non-canonical UTC timestamp %s on inserts and updates', (value) => {
    const database = createTestDatabase()
    opened.push(database)

    expect(() => {
      insertActor(database, { id: 'invalid-actor', registeredAt: value })
    }).toThrow(/check constraint failed/i)

    insertActor(database)

    expect(() => {
      database
        .prepare('UPDATE actors SET last_active_at = ? WHERE id = ?')
        .run(value, 'actor-1')
    }).toThrow(/check constraint failed/i)
  })

  it('rejects a malformed migration timestamp', () => {
    const database = createTestDatabase()
    opened.push(database)

    expect(() => {
      database
        .prepare(`
          INSERT INTO schema_migrations (version, applied_at)
          VALUES (?, ?)
        `)
        .run(2, 'garbageZ')
    }).toThrow(/check constraint failed/i)
  })

  it('accepts canonical dates and UTC timestamps with or without milliseconds', () => {
    const database = createTestDatabase()
    opened.push(database)

    insertActor(database, {
      registeredAt: '2026-07-29T08:00:00.123Z',
      lastActiveAt: '2026-07-29T08:00:01Z',
    })
    insertProject(database, {
      startDate: '2026-07-29',
      dueDate: '2026-08-31',
      createdAt: '2026-07-29T08:00:00Z',
      updatedAt: '2026-07-29T08:00:00.123Z',
    })
    insertTask(database, {
      startDate: '2026-07-30',
      dueDate: '2026-08-01',
      createdAt: '2026-07-29T08:00:01.123Z',
      updatedAt: '2026-07-29T08:00:02Z',
    })

    expect(
      database.prepare('SELECT COUNT(*) AS count FROM tasks').get(),
    ).toEqual({ count: 1 })
  })

  it.each([
    '2026-07-29T08:00Z',
    '2026-07-29T08:00:00Z',
    '2026-07-29T08:00:00.1Z',
    '2026-07-29T08:00:00.123Z',
    '2026-07-29T08:00:00.123456Z',
    '2026-07-29T08:00:00.123456789Z',
    '2026-07-29T08:00:00.1234567890Z',
  ])('accepts contract-valid UTC timestamp precision %s', (timestamp) => {
    const actor = {
      id: timestamp,
      name: 'Lin',
      kind: 'human' as const,
      role: 'owner' as const,
      status: 'active' as const,
      client: null,
      capabilities: [],
      registeredAt: timestamp,
      lastActiveAt: null,
      lastBriefingActivityId: null,
      version: 1,
    }
    expect(persistedActorSchema.safeParse(actor).success).toBe(true)

    const database = createTestDatabase()
    opened.push(database)
    expect(() => {
      insertActor(database, { id: timestamp, registeredAt: timestamp })
    }).not.toThrow()
  })
})

describe('JSON text-array persistence', () => {
  const invalidJsonValues = ['{}', '42', 'null', '["valid", 1]']
  const opened: DatabaseSync[] = []

  afterEach(() => {
    opened.splice(0).forEach((database) => database.close())
  })

  it.each(invalidJsonValues)(
    'rejects invalid actor capabilities JSON %s',
    (capabilitiesJson) => {
      const database = createTestDatabase()
      opened.push(database)

      expect(() => {
        insertActor(database, { capabilitiesJson })
      }).toThrow()

      expect(() => {
        insertActor(database, { capabilitiesJson: '["planning", "delivery"]' })
      }).not.toThrow()
    },
  )

  it.each(invalidJsonValues)(
    'rejects invalid task dependencies JSON %s',
    (dependencyIdsJson) => {
      const database = createTestDatabase()
      opened.push(database)
      insertActor(database)
      insertProject(database)

      expect(() => {
        insertTask(database, { dependencyIdsJson })
      }).toThrow()

      expect(() => {
        insertTask(database, { dependencyIdsJson: '["task-0"]' })
      }).not.toThrow()
    },
  )

  it.each(invalidJsonValues)(
    'rejects invalid requirement acceptance criteria JSON %s',
    (acceptanceCriteriaJson) => {
      const database = createTestDatabase()
      opened.push(database)
      insertActor(database)
      insertProject(database)

      expect(() => {
        insertRequirement(database, acceptanceCriteriaJson)
      }).toThrow()

      expect(() => {
        insertRequirement(database, '["Given", "When", "Then"]')
      }).not.toThrow()
    },
  )

  it.each(invalidJsonValues)(
    'rejects invalid defect reproduction steps JSON %s',
    (reproductionStepsJson) => {
      const database = createTestDatabase()
      opened.push(database)
      insertActor(database)
      insertProject(database)

      expect(() => {
        insertDefect(database, reproductionStepsJson)
      }).toThrow()

      expect(() => {
        insertDefect(database, '["Open page", "Observe error"]')
      }).not.toThrow()
    },
  )

  it('rejects non-string array elements through every update trigger', () => {
    const database = createTestDatabase()
    opened.push(database)
    insertActor(database, { capabilitiesJson: '["planning"]' })
    insertProject(database)
    insertTask(database, { dependencyIdsJson: '["task-0"]' })
    insertRequirement(database, '["Accepted"]')
    insertDefect(database, '["Open page"]')

    const invalidArray = '["valid", 1]'
    const updates = [
      {
        sql: 'UPDATE actors SET capabilities_json = ? WHERE id = ?',
        id: 'actor-1',
      },
      {
        sql: 'UPDATE tasks SET dependency_ids_json = ? WHERE id = ?',
        id: 'task-1',
      },
      {
        sql: `
          UPDATE requirements
          SET acceptance_criteria_json = ?
          WHERE id = ?
        `,
        id: 'requirement-1',
      },
      {
        sql: `
          UPDATE defects
          SET reproduction_steps_json = ?
          WHERE id = ?
        `,
        id: 'defect-1',
      },
    ]

    for (const update of updates) {
      expect(() => {
        database.prepare(update.sql).run(invalidArray, update.id)
      }).toThrow(/must contain only text values/i)
    }
  })
})

describe('DomainError', () => {
  it('preserves its stable public shape and Error prototype', () => {
    const details = { currentVersion: 2 }
    const error = new DomainError('VERSION_CONFLICT', 'Version is stale', details)

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(DomainError)
    expect(error.name).toBe('DomainError')
    expect(error.code).toBe('VERSION_CONFLICT')
    expect(error.message).toBe('Version is stale')
    expect(error.details).toBe(details)
  })
})
