import type { Task } from '../../data/domain'

type MilestoneStatus = '已完成' | '已逾期' | '进行中' | '未开始'

export type DerivedMilestone = {
  assignees: string[]
  id: string
  progress: number
  status: MilestoneStatus
  targetDate: string
  taskCount: number
}

function milestoneStatus(tasks: Task[]): MilestoneStatus {
  if (tasks.some(({ status }) => status === 'overdue')) return '已逾期'
  if (tasks.every(({ status }) => status === 'done')) return '已完成'
  if (tasks.some(({ status }) => status === 'in_progress' || status === 'done')) {
    return '进行中'
  }
  return '未开始'
}

export function deriveMilestones(tasks: Task[]): DerivedMilestone[] {
  const groups = new Map<string, Task[]>()
  for (const task of tasks) {
    const milestoneId = task.milestoneId.trim()
    if (!milestoneId) continue
    const group = groups.get(milestoneId) ?? []
    group.push(task)
    groups.set(milestoneId, group)
  }

  return [...groups.entries()]
    .map(([id, groupedTasks]) => ({
      assignees: [...new Set(groupedTasks.map((task) =>
        task.assignee?.name || task.assigneeId || '未分配',
      ))],
      id,
      progress: Math.round(
        groupedTasks.reduce((total, task) => total + task.progress, 0)
          / groupedTasks.length,
      ),
      status: milestoneStatus(groupedTasks),
      targetDate: groupedTasks
        .map(({ dueDate }) => dueDate)
        .sort((left, right) => left.localeCompare(right))
        .at(-1)!,
      taskCount: groupedTasks.length,
    }))
    .sort((left, right) =>
      left.targetDate.localeCompare(right.targetDate) || left.id.localeCompare(right.id),
    )
}
