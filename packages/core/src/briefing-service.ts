import type { DatabaseSync } from 'node:sqlite'
import {
  projectBriefingSchema,
  sessionCheckinInputSchema,
} from '@project-os/contracts'
import type {
  PersistedActivity,
  ProjectBriefing,
} from '@project-os/contracts'
import {
  ActivityService,
  withImmediateTransaction,
} from './activity-service.js'
import { DeliverableService } from './deliverable-service.js'
import { DomainError } from './errors.js'
import { HandoffService } from './handoff-service.js'
import { ProjectService } from './project-service.js'
import { SessionService } from './session-service.js'
import { TaskService } from './task-service.js'

export type BriefingInput = {
  projectId: string
  agentId: string
}

type BriefingServiceOptions = {
  afterActivityRead?: () => void
}

type ActorBriefingRow = {
  last_briefing_activity_id: string | null
}

type LatestProgressRow = {
  task_id: string
  note: string
  actor_name: string
  created_at: string
}

type LatestProgress = Omit<LatestProgressRow, 'task_id'>

const briefingInputSchema = sessionCheckinInputSchema.pick({
  projectId: true,
  agentId: true,
})

const priorityRank = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
} as const

export class BriefingService {
  private readonly projects: ProjectService
  private readonly tasks: TaskService
  private readonly sessions: SessionService
  private readonly handoffs: HandoffService
  private readonly deliverables: DeliverableService
  private readonly activities: ActivityService

  constructor(
    private readonly database: DatabaseSync,
    private readonly options: BriefingServiceOptions = {},
  ) {
    this.projects = new ProjectService(database)
    this.tasks = new TaskService(database)
    this.sessions = new SessionService(database)
    this.handoffs = new HandoffService(database)
    this.deliverables = new DeliverableService(database)
    this.activities = new ActivityService(database)
  }

  getBriefing(input: BriefingInput): ProjectBriefing {
    return withImmediateTransaction(this.database, () => {
      const { projectId, agentId } = briefingInputSchema.parse(input)
      const project = this.projects.get(projectId)
      const actor = this.readActor(agentId)
      const tasks = this.tasks.list({ projectId })
      const myTasks = tasks.filter((task) => (
        task.assigneeId === agentId && task.status !== 'done'
      ))
      const inProgressTasks = tasks.filter((task) => (
        task.status === 'in_progress'
      ))
      const latestProgressByTask = this.latestProgress(projectId)
      const sessions = this.sessions.listForProject({ projectId })
      const claimedTaskIds = new Set(
        sessions
          .filter((session) => session.status === 'active')
          .flatMap((session) => session.taskIds),
      )
      const taskOrder = new Map(
        tasks.map((task, index) => [task.id, index]),
      )
      const unclaimedTasks = tasks
        .filter((task) => (
          task.status === 'not_started'
          && !claimedTaskIds.has(task.id)
        ))
        .sort((left, right) => (
          priorityRank[left.priority] - priorityRank[right.priority]
          || taskOrder.get(left.id)! - taskOrder.get(right.id)!
        ))
      const latestHandoff = this.handoffs.latestForProject(projectId)
      const recentDeliverables = this.deliverables.listForProject({
        projectId,
        limit: 10,
      })
      const activityPage = this.readActivities(
        projectId,
        actor.last_briefing_activity_id,
      )
      this.options.afterActivityRead?.()
      const activityCursor = this.activities.latestCursor({ projectId })
      const briefing = projectBriefingSchema.parse({
        project,
        my_tasks: myTasks,
        in_progress_tasks: inProgressTasks.map((task) => ({
          task,
          latest_progress: latestProgressByTask.get(task.id) ?? null,
        })),
        unclaimed_tasks: unclaimedTasks,
        sessions,
        latest_handoff: latestHandoff,
        recent_deliverables: recentDeliverables,
        new_activities: activityPage.items,
        activities_truncated: activityPage.truncated,
        activity_cursor: activityCursor,
      })

      this.database.prepare(`
        UPDATE actors
        SET last_briefing_activity_id = ?
        WHERE id = ?
      `).run(activityCursor, agentId)

      return briefing
    })
  }

  private readActor(agentId: string): ActorBriefingRow {
    const actor = this.database.prepare(`
      SELECT last_briefing_activity_id
      FROM actors
      WHERE id = ?
    `).get(agentId) as ActorBriefingRow | undefined
    if (actor === undefined) {
      throw new DomainError(
        'ACTOR_NOT_FOUND',
        'Actor does not exist',
        { actorId: agentId },
      )
    }
    return actor
  }

  private latestProgress(
    projectId: string,
  ): Map<string, LatestProgress> {
    const rows = this.database.prepare(`
      WITH ranked_progress AS (
        SELECT
          activities.entity_id AS task_id,
          activities.actor_id,
          activities.note,
          activities.created_at,
          ROW_NUMBER() OVER (
            PARTITION BY activities.entity_id
            ORDER BY activities.rowid DESC
          ) AS progress_rank
        FROM activities
        JOIN tasks
          ON tasks.id = activities.entity_id
          AND tasks.project_id = activities.project_id
        WHERE activities.project_id = ?
          AND activities.entity_type = 'task'
          AND activities.operation = 'task.progress'
          AND activities.note IS NOT NULL
          AND tasks.status = 'in_progress'
      )
      SELECT
        ranked_progress.task_id,
        ranked_progress.note,
        actors.name AS actor_name,
        ranked_progress.created_at
      FROM ranked_progress
      JOIN actors ON actors.id = ranked_progress.actor_id
      WHERE ranked_progress.progress_rank = 1
    `).all(projectId) as unknown as LatestProgressRow[]

    return new Map(rows.map((row) => [
      row.task_id,
      {
        note: row.note,
        actor_name: row.actor_name,
        created_at: row.created_at,
      },
    ]))
  }

  private readActivities(
    projectId: string,
    cursor: string | null,
  ): {
    items: PersistedActivity[]
    truncated: boolean
  } {
    if (cursor !== null) {
      try {
        const newer = this.activities.listNewer({
          after: cursor,
          projectId,
          limit: 101,
        })
        return {
          items: newer.slice(0, 100),
          truncated: newer.length > 100,
        }
      } catch (error) {
        if (
          !(error instanceof DomainError)
          || error.code !== 'ACTIVITY_CURSOR_INVALID'
        ) {
          throw error
        }
      }
    }

    const latest = this.activities.list({ projectId, limit: 21 })
    return {
      items: latest.slice(0, 20).reverse(),
      truncated: latest.length > 20,
    }
  }
}
