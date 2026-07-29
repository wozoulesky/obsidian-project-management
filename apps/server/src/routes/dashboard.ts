import type { SQLInputValue } from 'node:sqlite'
import {
  dashboardSnapshotSchema,
  persistedProjectSchema,
  persistedTaskSchema,
} from '@project-os/contracts'
import { DomainError } from '@project-os/core'
import type { Router } from 'express'
import { z } from 'zod'
import type { AppRouteModule } from '../app.js'
import {
  callService,
  cursorError,
  internalOperation,
  paginate,
  readCursorPosition,
  routeIdSchema,
  sendSuccess,
} from './actors.js'

const dateSchema = z.iso.date()
const dashboardQuerySchema = z.object({
  project_id: routeIdSchema.optional(),
  days: z.enum(['7', '30', '90']).transform(Number).default(30),
  today: dateSchema.optional(),
}).strict()
const overdueQuerySchema = z.object({
  project_id: routeIdSchema.optional(),
  today: dateSchema.optional(),
  limit: z.string().regex(/^[1-9]\d{0,2}$/).transform(Number)
    .pipe(z.number().int().min(1).max(200)).default(50),
  cursor: z.string().min(1).max(4096).optional(),
}).strict()

function startOfWindow(today: string, days: number): string {
  const date = new Date(`${today}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() - days + 1)
  return date.toISOString().slice(0, 10)
}

export const dashboardRoutes: AppRouteModule = {
  register(router: Router, getContext) {
    router.get('/dashboard/overdue', (request, response) => {
      const query = overdueQuerySchema.parse(request.query)
      const context = getContext()
      const today = query.today ?? new Date().toISOString().slice(0, 10)
      const filters = {
        project_id: query.project_id,
        today,
      }
      const position = readCursorPosition({
        scope: 'dashboard-overdue',
        filters,
        cursor: query.cursor,
      })
      let anchor: {
        projectId: string
        code: string
        id: string
      } | undefined
      if (position !== undefined) {
        if (position.length !== 3) throw cursorError(query.cursor!)
        let task
        try {
          task = callService(
            persistedTaskSchema,
            () => context.services.tasks.get(position[2]!),
          )
        } catch (error) {
          if (
            error instanceof DomainError
            && error.code === 'TASK_NOT_FOUND'
          ) throw cursorError(query.cursor!)
          throw error
        }
        if (
          task.projectId !== position[0]
          || task.code !== position[1]
          || task.id !== position[2]
          || task.status === 'done'
          || task.dueDate >= today
          || (
            query.project_id !== undefined
            && task.projectId !== query.project_id
          )
        ) throw cursorError(query.cursor!)
        anchor = {
          projectId: task.projectId,
          code: task.code,
          id: task.id,
        }
      }
      if (query.project_id !== undefined) {
        callService(
          persistedProjectSchema,
          () => context.services.projects.get(query.project_id!),
        )
      }
      const clauses = [
        "status <> 'done'",
        'due_date < ?',
      ]
      const values: SQLInputValue[] = [today]
      if (query.project_id !== undefined) {
        clauses.push('project_id = ?')
        values.push(query.project_id)
      }
      if (anchor !== undefined) {
        clauses.push(`
          (
            project_id > ?
            OR (
              project_id = ?
              AND (
                code > ?
                OR (code = ? AND id > ?)
              )
            )
          )
        `)
        values.push(
          anchor.projectId,
          anchor.projectId,
          anchor.code,
          anchor.code,
          anchor.id,
        )
      }
      const ids = internalOperation(() => context.database.prepare(`
        SELECT id
        FROM tasks
        WHERE ${clauses.join(' AND ')}
        ORDER BY project_id, code, id
        LIMIT ?
      `).all(...values, query.limit + 1) as unknown as { id: string }[])
      const items = ids.map(({ id }) => {
        const task = callService(
          persistedTaskSchema,
          () => context.services.tasks.get(id),
        )
        return persistedTaskSchema.parse({ ...task, status: 'overdue' })
      })
      sendSuccess(response, paginate(items, {
        scope: 'dashboard-overdue',
        filters,
        limit: query.limit,
        position: (task) => [task.projectId, task.code, task.id],
      }))
    })

    router.get('/dashboard', (request, response) => {
      const query = dashboardQuerySchema.parse(request.query)
      const context = getContext()
      const today = query.today ?? new Date().toISOString().slice(0, 10)
      const snapshot = callService(
        dashboardSnapshotSchema,
        () => context.services.dashboard.snapshot({
          today,
          ...(query.project_id === undefined
            ? {}
            : { projectId: query.project_id }),
        }),
      )
      const first = startOfWindow(today, query.days)
      sendSuccess(response, dashboardSnapshotSchema.parse({
        ...snapshot,
        trend: snapshot.trend.filter(
          (point) => point.date >= first && point.date <= today,
        ).sort((left, right) => left.date.localeCompare(right.date)),
      }))
    })
  },
}
