import type {
  ActivityEvent,
  DashboardSnapshot,
  RequirementStatus,
  Task,
  TaskDateInput,
  TaskProgressInput,
} from './domain'
import {
  activities,
  defects,
  requirements,
  risks,
  tasks,
  trendByDays,
} from './fixtures'
import type { ProjectRepository } from './project-repository'

const clone = <T>(value: T): T => structuredClone(value)

export function createMockProjectRepository(): ProjectRepository {
  const taskState = clone(tasks)
  const requirementState = clone(requirements)
  const activityState = clone(activities)

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
      return clone({
        metrics: {
          totalTasks: 50,
          completed: 34,
          deliveredRequirements: 14,
          totalRequirements: 20,
          activeDefects: 7,
          seriousDefects: 2,
          velocity: 16.4,
          activeActors: 6,
          activeAgents: 3,
        },
        trend: trendByDays[days],
        risks,
        activities: activityState,
      })
    },

    async listTasks(projectId) {
      void projectId
      return clone(taskState)
    },

    async updateTaskProgress(taskId, input: TaskProgressInput) {
      const task = getTask(taskId)
      task.progress = input.progress
      task.status = input.status

      const activity: ActivityEvent = {
        id: `activity-${task.id}-progress-${input.progress}`,
        actor: task.assignee,
        message: `将「${task.title}」更新至 ${input.progress}%`,
        operation: 'task.update',
        timestamp: '2026-07-28T12:00:00+08:00',
      }
      activityState.unshift(activity)

      return clone(task)
    },

    async updateTaskDates(taskId, input: TaskDateInput) {
      const task = getTask(taskId)
      task.startDate = input.startDate
      task.dueDate = input.dueDate

      const activity: ActivityEvent = {
        id: `activity-${task.id}-schedule-${input.startDate}-${input.dueDate}`,
        actor: task.assignee,
        message: `调整「${task.title}」排期至 ${input.startDate}–${input.dueDate}`,
        operation: 'task.schedule',
        timestamp: '2026-07-28T12:05:00+08:00',
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
      return clone(defects)
    },

    async createTaskFromDefect(defectId) {
      const defect = defects.find((candidate) => candidate.id === defectId)
      if (!defect) {
        throw new Error(`Defect not found: ${defectId}`)
      }

      const taskId = `task-fix-${defectId}`
      const existingTask = taskState.find((task) => task.id === taskId)
      if (existingTask) {
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
      return clone(task)
    },

    async listGanttTasks(projectId) {
      void projectId
      return clone(taskState)
    },
  }
}
