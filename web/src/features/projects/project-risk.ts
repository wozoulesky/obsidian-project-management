import type { Project } from '../../data/domain'

export function projectRisk(project: Project): string {
  if (
    project.dueDate === null
    || project.status === 'completed'
    || project.status === 'cancelled'
  ) {
    return project.dueDate === null ? '未排期' : '已结束'
  }
  const today = new Date().toISOString().slice(0, 10)
  if (project.dueDate < today) return '已逾期'
  const days = Math.ceil(
    (Date.parse(`${project.dueDate}T00:00:00Z`)
      - Date.parse(`${today}T00:00:00Z`))
      / 86_400_000,
  )
  return days <= 7 ? '7 天内到期' : '排期正常'
}
