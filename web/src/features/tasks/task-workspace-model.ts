import type { Task, TaskStatus } from '../../data/domain'

export const taskViews = ['fan', 'board', 'timeline'] as const
export type TaskView = (typeof taskViews)[number]

export const taskStatuses = [
  'not_started',
  'in_progress',
  'done',
  'overdue',
] satisfies TaskStatus[]

export const taskStatusLabels = {
  not_started: '未开始',
  in_progress: '进行中',
  done: '已完成',
  overdue: '已逾期',
} satisfies Record<TaskStatus, string>

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86_400_000

function parseIsoDate(value: string): number | null {
  const match = ISO_DATE_PATTERN.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const timestamp = Date.UTC(year, month - 1, day)
  const parsed = new Date(timestamp)
  return parsed.getUTCFullYear() === year
      && parsed.getUTCMonth() === month - 1
      && parsed.getUTCDate() === day
    ? timestamp
    : null
}

export function parseTaskView(value: unknown): TaskView {
  return taskViews.find((view) => view === value) ?? 'fan'
}

export function taskInsights(task: Task, today: string): string[] {
  const insights: string[] = []
  const dueDate = parseIsoDate(task.dueDate)
  const todayDate = parseIsoDate(today)
  const hasValidDates = dueDate !== null && todayDate !== null
  const isDone = task.status === 'done'

  if (
    task.status === 'overdue'
    || (!isDone && hasValidDates && dueDate < todayDate)
  ) {
    insights.push('任务已逾期，请重新确认交付时间。')
  }

  if (
    !isDone
    && task.progress < 30
    && hasValidDates
    && dueDate >= todayDate
    && dueDate <= todayDate + 2 * DAY_MS
  ) {
    insights.push('临近截止日期且进度偏低。')
  }

  if (task.assigneeId === undefined) {
    insights.push('尚未分配负责人。')
  }

  if (task.dependencyIds.length > 0) {
    insights.push(
      `存在 ${task.dependencyIds.length} 项前置依赖，请确认阻塞状态。`,
    )
  }

  return insights.length > 0
    ? insights
    : ['当前任务未发现明确风险。']
}
