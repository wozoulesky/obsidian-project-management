import type { DatabaseSync } from 'node:sqlite'
import { DomainError } from './errors.js'

type Migration = {
  version: number
  sql: string
}

export function validateMigrationVersions(
  versions: readonly number[],
): number {
  let previousVersion = 0
  let latestVersion = 0

  for (const version of versions) {
    if (
      !Number.isInteger(version)
      || version <= 0
      || version <= previousVersion
    ) {
      throw new DomainError(
        'DATABASE_MIGRATIONS_INVALID',
        'Database migrations must have unique, strictly ascending versions',
        { previousVersion, version },
      )
    }

    previousVersion = version
    latestVersion = Math.max(latestVersion, version)
  }

  return latestVersion
}

const datePattern =
  '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
const timestampMinutePattern =
  `${datePattern}T[0-9][0-9]:[0-9][0-9]`
const timestampBasePattern =
  `${datePattern}T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]`

function canonicalDate(column: string): string {
  return `(
    length(${column}) = 10
    AND ${column} GLOB '${datePattern}'
    AND date(${column}) IS NOT NULL
    AND strftime('%Y-%m-%d', ${column}) = ${column}
  )`
}

function optionalCanonicalDate(column: string): string {
  return `(${column} IS NULL OR ${canonicalDate(column)})`
}

function canonicalUtcTimestamp(column: string): string {
  const baseTimestamp = `substr(${column}, 1, 19)`
  const utcBaseTimestamp = `(${baseTimestamp} || 'Z')`
  const fraction = `substr(${column}, 21, length(${column}) - 21)`

  return `(
    (
      length(${column}) = 17
      AND ${column} GLOB '${timestampMinutePattern}Z'
      AND datetime(${column}) IS NOT NULL
      AND strftime('%Y-%m-%dT%H:%MZ', ${column}) = ${column}
    )
    OR
    (
      length(${column}) = 20
      AND ${column} GLOB '${timestampBasePattern}Z'
      AND datetime(${column}) IS NOT NULL
      AND strftime('%Y-%m-%dT%H:%M:%SZ', ${column}) = ${column}
    )
    OR (
      length(${column}) >= 22
      AND ${baseTimestamp} GLOB '${timestampBasePattern}'
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

function optionalCanonicalUtcTimestamp(column: string): string {
  return `(${column} IS NULL OR ${canonicalUtcTimestamp(column)})`
}

function jsonTextArray(column: string): string {
  return `(
    json_valid(${column})
    AND json_type(${column}) = 'array'
  )`
}

function jsonTextArrayTriggers(table: string, column: string): string {
  const triggerPrefix = `${table}_${column}_text_array`
  const invalidElement = `
    EXISTS (
      SELECT 1
      FROM json_each(NEW.${column})
      WHERE type <> 'text'
    )
  `

  return `
    CREATE TRIGGER ${triggerPrefix}_insert
    BEFORE INSERT ON ${table}
    WHEN ${invalidElement}
    BEGIN
      SELECT RAISE(ABORT, '${column} must contain only text values');
    END;

    CREATE TRIGGER ${triggerPrefix}_update
    BEFORE UPDATE OF ${column} ON ${table}
    WHEN ${invalidElement}
    BEGIN
      SELECT RAISE(ABORT, '${column} must contain only text values');
    END;
  `
}

const migrations: readonly Migration[] = [
  {
    version: 1,
    sql: `
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
          CHECK (${jsonTextArray('capabilities_json')}),
        registered_at TEXT NOT NULL
          CHECK (${canonicalUtcTimestamp('registered_at')}),
        last_active_at TEXT
          CHECK (${optionalCanonicalUtcTimestamp('last_active_at')}),
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

      ${jsonTextArrayTriggers('actors', 'capabilities_json')}

      CREATE UNIQUE INDEX actors_agent_identity_idx
        ON actors (client, name)
        WHERE kind = 'agent';
      CREATE INDEX actors_status_idx ON actors (status);

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
          CHECK (${canonicalUtcTimestamp('created_at')}),
        updated_at TEXT NOT NULL
          CHECK (${canonicalUtcTimestamp('updated_at')}),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        FOREIGN KEY (owner_id) REFERENCES actors (id) ON DELETE RESTRICT,
        CHECK (${optionalCanonicalDate('start_date')}),
        CHECK (${optionalCanonicalDate('due_date')})
      ) STRICT;

      CREATE INDEX projects_owner_id_idx ON projects (owner_id);
      CREATE INDEX projects_status_idx ON projects (status);

      CREATE TABLE project_members (
        project_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        membership_role TEXT NOT NULL
          CHECK (membership_role IN ('owner', 'member')),
        joined_at TEXT NOT NULL
          CHECK (${canonicalUtcTimestamp('joined_at')}),
        PRIMARY KEY (project_id, actor_id),
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
        FOREIGN KEY (actor_id) REFERENCES actors (id) ON DELETE RESTRICT
      ) STRICT;

      CREATE INDEX project_members_actor_id_idx
        ON project_members (actor_id);

      CREATE TABLE tasks (
        id TEXT PRIMARY KEY CHECK (length(id) > 0),
        code TEXT NOT NULL CHECK (length(code) > 0),
        project_id TEXT NOT NULL,
        title TEXT NOT NULL CHECK (length(title) > 0),
        description TEXT NOT NULL DEFAULT '',
        assignee_id TEXT NOT NULL,
        start_date TEXT NOT NULL CHECK (${canonicalDate('start_date')}),
        due_date TEXT NOT NULL CHECK (${canonicalDate('due_date')}),
        priority TEXT NOT NULL CHECK (priority IN ('P0', 'P1', 'P2', 'P3')),
        status TEXT NOT NULL DEFAULT 'not_started'
          CHECK (status IN ('not_started', 'in_progress', 'done', 'overdue')),
        progress INTEGER NOT NULL DEFAULT 0
          CHECK (progress BETWEEN 0 AND 100),
        milestone_id TEXT NOT NULL DEFAULT '',
        parent_id TEXT,
        dependency_ids_json TEXT NOT NULL DEFAULT '[]'
          CHECK (${jsonTextArray('dependency_ids_json')}),
        created_at TEXT NOT NULL
          CHECK (${canonicalUtcTimestamp('created_at')}),
        updated_at TEXT NOT NULL
          CHECK (${canonicalUtcTimestamp('updated_at')}),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (project_id, code),
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
        FOREIGN KEY (assignee_id) REFERENCES actors (id) ON DELETE RESTRICT,
        FOREIGN KEY (parent_id) REFERENCES tasks (id) ON DELETE SET NULL
      ) STRICT;

      ${jsonTextArrayTriggers('tasks', 'dependency_ids_json')}

      CREATE INDEX tasks_project_id_idx ON tasks (project_id);
      CREATE INDEX tasks_assignee_id_idx ON tasks (assignee_id);
      CREATE INDEX tasks_status_idx ON tasks (status);
      CREATE INDEX tasks_project_status_idx ON tasks (project_id, status);

      CREATE TABLE requirements (
        id TEXT PRIMARY KEY CHECK (length(id) > 0),
        code TEXT NOT NULL CHECK (length(code) > 0),
        project_id TEXT NOT NULL,
        title TEXT NOT NULL CHECK (length(title) > 0),
        description TEXT NOT NULL DEFAULT '',
        priority TEXT NOT NULL CHECK (priority IN ('P0', 'P1', 'P2', 'P3')),
        status TEXT NOT NULL DEFAULT 'draft'
          CHECK (
            status IN (
              'draft',
              'reviewed',
              'developing',
              'delivered',
              'accepted',
              'rejected',
              'shelved'
            )
          ),
        acceptance_criteria_json TEXT NOT NULL DEFAULT '[]'
          CHECK (${jsonTextArray('acceptance_criteria_json')}),
        created_at TEXT NOT NULL
          CHECK (${canonicalUtcTimestamp('created_at')}),
        updated_at TEXT NOT NULL
          CHECK (${canonicalUtcTimestamp('updated_at')}),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (project_id, code),
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
      ) STRICT;

      ${jsonTextArrayTriggers('requirements', 'acceptance_criteria_json')}

      CREATE INDEX requirements_project_id_idx
        ON requirements (project_id);
      CREATE INDEX requirements_status_idx ON requirements (status);
      CREATE INDEX requirements_project_status_idx
        ON requirements (project_id, status);

      CREATE TABLE requirement_tasks (
        requirement_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        PRIMARY KEY (requirement_id, task_id),
        FOREIGN KEY (requirement_id)
          REFERENCES requirements (id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX requirement_tasks_task_id_idx
        ON requirement_tasks (task_id);

      CREATE TABLE defects (
        id TEXT PRIMARY KEY CHECK (length(id) > 0),
        code TEXT NOT NULL CHECK (length(code) > 0),
        project_id TEXT NOT NULL,
        title TEXT NOT NULL CHECK (length(title) > 0),
        description TEXT NOT NULL DEFAULT '',
        severity TEXT NOT NULL
          CHECK (severity IN ('fatal', 'serious', 'normal', 'suggestion')),
        status TEXT NOT NULL DEFAULT 'open'
          CHECK (
            status IN (
              'open',
              'fixing',
              'verifying',
              'closed',
              'rejected',
              'not_a_defect'
            )
          ),
        assignee_id TEXT NOT NULL,
        reproduction_steps_json TEXT NOT NULL DEFAULT '[]'
          CHECK (${jsonTextArray('reproduction_steps_json')}),
        linked_requirement_id TEXT,
        linked_task_id TEXT,
        created_at TEXT NOT NULL
          CHECK (${canonicalUtcTimestamp('created_at')}),
        updated_at TEXT NOT NULL
          CHECK (${canonicalUtcTimestamp('updated_at')}),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (project_id, code),
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
        FOREIGN KEY (assignee_id) REFERENCES actors (id) ON DELETE RESTRICT,
        FOREIGN KEY (linked_requirement_id)
          REFERENCES requirements (id) ON DELETE SET NULL,
        FOREIGN KEY (linked_task_id) REFERENCES tasks (id) ON DELETE SET NULL
      ) STRICT;

      ${jsonTextArrayTriggers('defects', 'reproduction_steps_json')}

      CREATE INDEX defects_project_id_idx ON defects (project_id);
      CREATE INDEX defects_assignee_id_idx ON defects (assignee_id);
      CREATE INDEX defects_status_idx ON defects (status);
      CREATE INDEX defects_project_status_idx ON defects (project_id, status);

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
          CHECK (${canonicalUtcTimestamp('created_at')}),
        FOREIGN KEY (actor_id) REFERENCES actors (id) ON DELETE RESTRICT,
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE SET NULL
      ) STRICT;

      CREATE INDEX activities_created_at_idx
        ON activities (created_at DESC);
      CREATE INDEX activities_entity_idx
        ON activities (entity_type, entity_id, created_at DESC);
      CREATE INDEX activities_project_id_idx ON activities (project_id);

      CREATE TABLE settings (
        key TEXT PRIMARY KEY CHECK (length(key) > 0),
        value_json TEXT NOT NULL CHECK (json_valid(value_json)),
        updated_at TEXT NOT NULL
          CHECK (${canonicalUtcTimestamp('updated_at')}),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
      ) STRICT;

      CREATE TABLE access_tokens (
        id TEXT PRIMARY KEY CHECK (length(id) > 0),
        name TEXT NOT NULL CHECK (length(name) > 0),
        token_hash TEXT NOT NULL CHECK (length(token_hash) > 0),
        created_at TEXT NOT NULL
          CHECK (${canonicalUtcTimestamp('created_at')}),
        last_used_at TEXT
          CHECK (${optionalCanonicalUtcTimestamp('last_used_at')}),
        revoked_at TEXT
          CHECK (${optionalCanonicalUtcTimestamp('revoked_at')}),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
      ) STRICT;

      CREATE INDEX access_tokens_name_idx ON access_tokens (name);
      CREATE INDEX access_tokens_revoked_at_idx ON access_tokens (revoked_at);
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE actors ADD COLUMN last_briefing_activity_id TEXT;

      CREATE TABLE activities_v2 (
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
            'token.revoke',
            'session.checkin',
            'session.note',
            'session.checkout',
            'handoff.update',
            'deliverable.record'
          )
        ),
        entity_type TEXT NOT NULL CHECK (length(entity_type) > 0),
        entity_id TEXT NOT NULL CHECK (length(entity_id) > 0),
        action TEXT NOT NULL CHECK (length(action) > 0),
        note TEXT,
        details_json TEXT NOT NULL DEFAULT '{}'
          CHECK (json_valid(details_json)),
        created_at TEXT NOT NULL
          CHECK (${canonicalUtcTimestamp('created_at')}),
        FOREIGN KEY (actor_id) REFERENCES actors (id) ON DELETE RESTRICT,
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE SET NULL
      ) STRICT;

      INSERT INTO activities_v2 SELECT * FROM activities;
      DROP TABLE activities;
      ALTER TABLE activities_v2 RENAME TO activities;

      CREATE INDEX activities_created_at_idx
        ON activities (created_at DESC);
      CREATE INDEX activities_entity_idx
        ON activities (entity_type, entity_id, created_at DESC);
      CREATE INDEX activities_project_id_idx ON activities (project_id);

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY CHECK (length(id) > 0),
        project_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        intent TEXT NOT NULL CHECK (length(intent) > 0),
        task_ids_json TEXT NOT NULL DEFAULT '[]'
          CHECK (${jsonTextArray('task_ids_json')}),
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'closed')),
        summary TEXT,
        created_at TEXT NOT NULL
          CHECK (${canonicalUtcTimestamp('created_at')}),
        last_active_at TEXT NOT NULL
          CHECK (${canonicalUtcTimestamp('last_active_at')}),
        closed_at TEXT
          CHECK (${optionalCanonicalUtcTimestamp('closed_at')}),
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
        FOREIGN KEY (agent_id) REFERENCES actors (id) ON DELETE RESTRICT
      ) STRICT;

      ${jsonTextArrayTriggers('sessions', 'task_ids_json')}

      CREATE INDEX sessions_project_id_idx ON sessions (project_id);
      CREATE INDEX sessions_agent_id_idx ON sessions (agent_id);
      CREATE INDEX sessions_status_idx ON sessions (status);

      CREATE TABLE handoffs (
        id TEXT PRIMARY KEY CHECK (length(id) > 0),
        project_id TEXT NOT NULL,
        session_id TEXT,
        author_id TEXT NOT NULL,
        summary TEXT NOT NULL CHECK (length(summary) > 0),
        done_json TEXT NOT NULL DEFAULT '[]'
          CHECK (${jsonTextArray('done_json')}),
        blockers_json TEXT NOT NULL DEFAULT '[]'
          CHECK (${jsonTextArray('blockers_json')}),
        next_steps_json TEXT NOT NULL DEFAULT '[]'
          CHECK (${jsonTextArray('next_steps_json')}),
        gotchas_json TEXT NOT NULL DEFAULT '[]'
          CHECK (${jsonTextArray('gotchas_json')}),
        refs_json TEXT NOT NULL DEFAULT '[]'
          CHECK (json_valid(refs_json)),
        created_at TEXT NOT NULL
          CHECK (${canonicalUtcTimestamp('created_at')}),
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE SET NULL,
        FOREIGN KEY (author_id) REFERENCES actors (id) ON DELETE RESTRICT
      ) STRICT;

      ${jsonTextArrayTriggers('handoffs', 'done_json')}
      ${jsonTextArrayTriggers('handoffs', 'blockers_json')}
      ${jsonTextArrayTriggers('handoffs', 'next_steps_json')}
      ${jsonTextArrayTriggers('handoffs', 'gotchas_json')}

      CREATE INDEX handoffs_project_created_at_idx
        ON handoffs (project_id, created_at DESC);

      CREATE TABLE deliverables (
        id TEXT PRIMARY KEY CHECK (length(id) > 0),
        project_id TEXT NOT NULL,
        requirement_id TEXT,
        task_id TEXT,
        title TEXT NOT NULL CHECK (length(title) > 0),
        kind TEXT NOT NULL CHECK (kind IN ('commit', 'file', 'url', 'note')),
        ref TEXT NOT NULL CHECK (length(ref) > 0),
        note TEXT,
        created_by TEXT NOT NULL,
        session_id TEXT,
        created_at TEXT NOT NULL
          CHECK (${canonicalUtcTimestamp('created_at')}),
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
        FOREIGN KEY (requirement_id)
          REFERENCES requirements (id) ON DELETE SET NULL,
        FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE SET NULL,
        FOREIGN KEY (created_by) REFERENCES actors (id) ON DELETE RESTRICT,
        FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE SET NULL,
        CHECK (requirement_id IS NOT NULL OR task_id IS NOT NULL)
      ) STRICT;

      CREATE INDEX deliverables_project_id_idx
        ON deliverables (project_id);
      CREATE INDEX deliverables_requirement_id_idx
        ON deliverables (requirement_id);
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE activities_v3 (
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
            'project.delete',
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
            'token.revoke',
            'session.checkin',
            'session.note',
            'session.checkout',
            'handoff.update',
            'deliverable.record'
          )
        ),
        entity_type TEXT NOT NULL CHECK (length(entity_type) > 0),
        entity_id TEXT NOT NULL CHECK (length(entity_id) > 0),
        action TEXT NOT NULL CHECK (length(action) > 0),
        note TEXT,
        details_json TEXT NOT NULL DEFAULT '{}'
          CHECK (json_valid(details_json)),
        created_at TEXT NOT NULL
          CHECK (${canonicalUtcTimestamp('created_at')}),
        FOREIGN KEY (actor_id) REFERENCES actors (id) ON DELETE RESTRICT,
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE SET NULL
      ) STRICT;

      INSERT INTO activities_v3 (
        rowid,
        id,
        actor_id,
        project_id,
        source,
        operation,
        entity_type,
        entity_id,
        action,
        note,
        details_json,
        created_at
      )
      SELECT
        rowid,
        id,
        actor_id,
        project_id,
        source,
        operation,
        entity_type,
        entity_id,
        action,
        note,
        details_json,
        created_at
      FROM activities
      ORDER BY rowid;
      DROP TABLE activities;
      ALTER TABLE activities_v3 RENAME TO activities;

      CREATE INDEX activities_created_at_idx
        ON activities (created_at DESC);
      CREATE INDEX activities_entity_idx
        ON activities (entity_type, entity_id, created_at DESC);
      CREATE INDEX activities_project_id_idx ON activities (project_id);
    `,
  },
]

const latestKnownVersion = validateMigrationVersions(
  migrations.map((migration) => migration.version),
)

export function runMigrations(database: DatabaseSync): void {
  database.exec('BEGIN IMMEDIATE')

  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY CHECK (version >= 1),
        applied_at TEXT NOT NULL
          CHECK (${canonicalUtcTimestamp('applied_at')})
      ) STRICT;
    `)

    const databaseVersion = database
      .prepare('SELECT MAX(version) AS version FROM schema_migrations')
      .get()?.version

    if (
      typeof databaseVersion === 'number'
      && databaseVersion > latestKnownVersion
    ) {
      throw new DomainError(
        'DATABASE_SCHEMA_NEWER',
        'Database schema is newer than this Project OS runtime',
        { databaseVersion, latestKnownVersion },
      )
    }

    const hasMigration = database.prepare(
      'SELECT 1 FROM schema_migrations WHERE version = ?',
    )
    const recordMigration = database.prepare(`
      INSERT INTO schema_migrations (version, applied_at)
      VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `)

    for (const migration of migrations) {
      if (hasMigration.get(migration.version) === undefined) {
        database.exec(migration.sql)
        recordMigration.run(migration.version)
      }
    }

    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
