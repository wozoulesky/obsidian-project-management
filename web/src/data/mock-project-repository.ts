import type {
  ActivityEvent,
  DashboardSnapshot,
  RequirementStatus,
  Task,
  TaskDateInput,
  TaskProgressInput,
} from './domain'
import { createFixtureSeed } from './fixtures'
import type { ProjectRepository } from './project-repository'

const clone = <T>(value: T): T => structuredClone(value)
const inactiveDefectStatuses = new Set([
  'closed',
  'rejected',
  'not_a_defect',
])

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }
  const timestamp = Date.parse(`${value}T00:00:00Z`)
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
  )
}

export function createMockProjectRepository(): ProjectRepository {
  const seed = createFixtureSeed()
  const taskState = seed.tasks
  const requirementState = seed.requirements
  const defectState = seed.defects
  const activityState = seed.activities
  let activitySequence = activityState.length

  const nextActivityId = () => {
    activitySequence += 1
    return `activity-${activitySequence}`
  }

  const getTask = (taskId: string): Task => {
    const task = taskState.find((candidate) => candidate.id === taskId)
    if (!task) {
      throw new Error(`Task not found: ${taskId}`)
    }
    return task
  }

  return {
    async getDashboard(projectId, days = 30): Promise<DashboardSnapshot> {
      void projectId
      const activeDefects = defectState.filter(
        (defect) => !inactiveDefectStatuses.has(defect.status),
      )
      const actorList = Object.values(seed.actors)
      const taskStatusCounts = taskState.reduce<
        DashboardSnapshot['taskStatusCounts']
      >(
        (counts, task) => {
          counts[task.status] += 1
          return counts
        },
        {
          not_started: 0,
          in_progress: 0,
          done: 0,
          overdue: 0,
        },
      )
      return clone({
        metrics: {
          totalTasks: taskState.length,
          completedTasks: taskState.filter((task) => task.status === 'done')
            .length,
          deliveredRequirements: requirementState.filter(
            (requirement) =>
              requirement.status === 'delivered' ||
              requirement.status === 'accepted',
          ).length,
          totalRequirements: requirementState.length,
          activeDefects: activeDefects.length,
          seriousDefects: activeDefects.filter(
            (defect) =>
              defect.severity === 'fatal' || defect.severity === 'serious',
          ).length,
          velocityPerWeek: 16.4,
          activeActors: actorList.length,
          activeAgents: actorList.filter((actor) => actor.kind === 'agent')
            .length,
        },
        taskStatusCounts,
        trend: seed.trendByDays[days],
        risks: seed.risks,
        activities: activityState,
      })
    },

    async listTasks(projectId) {
      void projectId
      return clone(taskState)
    },

    async updateTaskProgress(taskId, input: TaskProgressInput) {
      const task = getTask(taskId)
      if (
        !Number.isFinite(input.progress) ||
        !Number.isInteger(input.progress) ||
        input.progress < 0 ||
        input.progress > 100
      ) {
        throw new Error('Progress must be an integer between 0 and 100')
      }

      task.progress = input.progress
      task.status = input.status
      const note = input.note.trim()
      const activity: ActivityEvent = {
        id: nextActivityId(),
        actor: task.assignee,
        action: `将「${task.title}」更新至 ${input.progress}%`,
        operation: 'task.update',
        createdAt: '2026-07-28T12:00:00+08:00',
        ...(note ? { note: input.note } : {}),
      }
      activityState.unshift(activity)

      return clone(task)
    },

    async updateTaskDates(taskId, input: TaskDateInput) {
      const task = getTask(taskId)
      if (
        !isIsoDate(input.startDate) ||
        !isIsoDate(input.dueDate) ||
        input.startDate > input.dueDate
      ) {
        throw new Error('Task dates are invalid')
      }

      task.startDate = input.startDate
      task.dueDate = input.dueDate
      const activity: ActivityEvent = {
        id: nextActivityId(),
        actor: task.assignee,
        action: `调整「${task.title}」排期至 ${input.startDate}–${input.dueDate}`,
        operation: 'task.schedule',
        createdAt: '2026-07-28T12:05:00+08:00',
      }
      activityState.unshift(activity)

      return clone(task)
    },

    async listRequirements(projectId) {
      void projectId
      return clone(requirementState)
    },

    async updateRequirementStatus(
      requirementId,
      status: RequirementStatus,
    ) {
      const requirement = requirementState.find(
        (candidate) => candidate.id === requirementId,
      )
      if (!requirement) {
        throw new Error(`Requirement not found: ${requirementId}`)
      }
      requirement.status = status
      return clone(requirement)
    },

    async listDefects(projectId) {
      void projectId
      return clone(defectState)
    },

    async createTaskFromDefect(defectId) {
      const defect = defectState.find((candidate) => candidate.id === defectId)
      if (!defect) {
        throw new Error(`Defect not found: ${defectId}`)
      }

      const taskId = `task-fix-${defectId}`
      const existingTask = taskState.find((task) => task.id === taskId)
      if (existingTask) {
        defect.linkedTaskId = taskId
        return clone(existingTask)
      }

      const task: Task = {
        id: taskId,
        code: `FIX-${defect.code}`,
        title: `修复：${defect.title}`,
        description: defect.reproductionSteps.join('\n'),
        assignee: defect.assignee,
        startDate: '2026-07-28',
        dueDate: '2026-07-30',
        priority: defect.severity === 'fatal' ? 'P0' : 'P1',
        status: 'not_started',
        progress: 0,
        milestoneId: 'm2',
        dependencyIds: [],
      }
      taskState.push(task)
      defect.linkedTaskId = taskId
      return clone(task)
    },

    async listGanttTasks(projectId) {
      void projectId
      return clone(taskState)
    },
  }
}
