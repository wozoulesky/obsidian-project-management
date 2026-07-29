import type { DatabaseSync } from 'node:sqlite'
import {
  dashboardSnapshotSchema,
  persistedTaskSchema,
  taskDateInputSchema,
} from '@project-os/contracts'
import type {
  DashboardSnapshot,
  PersistedActivity,
  PersistedTask,
} from '@project-os/contracts'
import {
  ActivityService,
} from './activity-service.js'
import type { ActivityListFilter } from './activity-service.js'
import { DefectService } from './defect-service.js'
import { DomainError } from './errors.js'
import { RequirementService } from './requirement-service.js'
import { TaskService } from './task-service.js'

export type DashboardOptions = {
  projectId?: string
  today?: string
  activityLimit?: number
}

export type OverdueTaskFilter = {
  projectId?: string
  today?: string
}

export class DashboardService {
  private readonly tasks: TaskService
  private readonly requirements: RequirementService
  private readonly defects: DefectService
  private readonly activities: ActivityService

  constructor(private readonly database: DatabaseSync) {
    this.tasks = new TaskService(database)
    this.requirements = new RequirementService(database)
    this.defects = new DefectService(database)
    this.activities = new ActivityService(database)
  }

  snapshot(options: DashboardOptions = {}): DashboardSnapshot {
    const today = this.validateToday(options.today)
    this.assertOptionalProject(options.projectId)
    const projectFilter = options.projectId === undefined
      ? {}
      : { projectId: options.projectId }
    const tasks = this.tasks.list(projectFilter)
    const requirements = this.requirements.list(projectFilter)
    const defects = this.defects.list(projectFilter)
    const effectiveStatus = (task: PersistedTask) => (
      task.status !== 'done' && task.dueDate < today
        ? 'overdue'
        : task.status
    )
    const taskStatusCounts = {
      not_started: 0,
      in_progress: 0,
      done: 0,
      overdue: 0,
    }
    for (const task of tasks) {
      taskStatusCounts[effectiveStatus(task)] += 1
    }
    const activeActors = this.database.prepare(`
      SELECT
        COUNT(*) AS actors,
        SUM(CASE WHEN kind = 'agent' THEN 1 ELSE 0 END) AS agents
      FROM actors
      WHERE status = 'active'
    `).get() as { actors: number; agents: number | null }
    const weekStart = new Date(`${today}T00:00:00.000Z`)
    weekStart.setUTCDate(weekStart.getUTCDate() - 6)
    const completedThisWeek = tasks.filter((task) => (
      task.status === 'done'
      && task.updatedAt >= weekStart.toISOString()
      && task.updatedAt < `${today}T23:59:59.999Z`
    )).length
    const activities = this.recentActivities(
      options.projectId,
      options.activityLimit ?? 20,
    )
    const snapshot = {
      metrics: {
        totalTasks: tasks.length,
        completedTasks: tasks.filter((task) => task.status === 'done').length,
        deliveredRequirements: requirements.filter((requirement) => (
          requirement.status === 'delivered'
          || requirement.status === 'accepted'
        )).length,
        totalRequirements: requirements.length,
        activeDefects: defects.filter((defect) => (
          !['closed', 'rejected', 'not_a_defect'].includes(defect.status)
        )).length,
        seriousDefects: defects.filter((defect) => (
          (defect.severity === 'fatal' || defect.severity === 'serious')
          && !['closed', 'rejected', 'not_a_defect'].includes(defect.status)
        )).length,
        velocityPerWeek: completedThisWeek,
        activeActors: activeActors.actors,
        activeAgents: activeActors.agents ?? 0,
      },
      taskStatusCounts,
      trend: this.buildTrend(tasks, today),
      risks: tasks
        .filter((task) => effectiveStatus(task) === 'overdue')
        .map((task) => ({
          id: `risk_${task.id}`,
          entityType: 'task' as const,
          entityId: task.id,
          title: task.title,
          assignee: task.assignee,
          progress: task.progress,
          dueDate: task.dueDate,
          level: task.priority === 'P0' || task.priority === 'P1'
            ? 'critical' as const
            : 'warning' as const,
        })),
      activities,
    }
    return dashboardSnapshotSchema.parse(snapshot)
  }

  summary(options: DashboardOptions = {}): DashboardSnapshot {
    return this.snapshot(options)
  }

  listOverdue(filter: OverdueTaskFilter = {}): PersistedTask[] {
    const today = this.validateToday(filter.today)
    this.assertOptionalProject(filter.projectId)
    const projectFilter = filter.projectId === undefined
      ? {}
      : { projectId: filter.projectId }
    return this.tasks.list(projectFilter)
      .filter((task) => task.status !== 'done' && task.dueDate < today)
      .map((task) => persistedTaskSchema.parse({
        ...task,
        status: 'overdue',
      }))
  }

  listActivities(filter: ActivityListFilter = {}): PersistedActivity[] {
    return this.activities.list(filter)
  }

  private recentActivities(
    projectId: string | undefined,
    limit: number,
  ): PersistedActivity[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new DomainError(
        'DASHBOARD_ACTIVITY_LIMIT_INVALID',
        'Dashboard activity limit must be between 1 and 200',
        { limit },
      )
    }
    if (projectId === undefined) {
      return this.activities.list({ limit })
    }
    return this.activities.list({ projectId, limit })
  }

  private buildTrend(
    tasks: readonly PersistedTask[],
    today: string,
  ): DashboardSnapshot['trend'] {
    if (tasks.length === 0) {
      return []
    }
    const earliestStart = tasks.reduce(
      (earliest, task) => task.startDate < earliest
        ? task.startDate
        : earliest,
      tasks[0]!.startDate,
    )
    const firstDate = earliestStart > today ? today : earliestStart
    const points: DashboardSnapshot['trend'] = []
    const cursor = new Date(`${firstDate}T00:00:00.000Z`)
    const last = new Date(`${today}T00:00:00.000Z`)

    while (cursor <= last) {
      const date = cursor.toISOString().slice(0, 10)
      points.push({
        date,
        planned: tasks.filter((task) => task.dueDate <= date).length,
        actual: tasks.filter((task) => (
          task.status === 'done'
          && task.updatedAt.slice(0, 10) <= date
        )).length,
      })
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    return points
  }

  private validateToday(today: string | undefined): string {
    return taskDateInputSchema.shape.startDate.parse(
      today ?? new Date().toISOString().slice(0, 10),
    )
  }

  private assertOptionalProject(projectId: string | undefined): void {
    if (
      projectId !== undefined
      && this.database.prepare(`
        SELECT id FROM projects WHERE id = ?
      `).get(projectId) === undefined
    ) {
      throw new DomainError(
        'PROJECT_NOT_FOUND',
        'Project does not exist',
        { projectId },
      )
    }
  }
}
