import { EmptyState } from '../../components/data/DataState'
import { GlassPanel } from '../../components/ui/GlassPanel'
import type {
  Actor,
  Project,
  ProjectStatus,
  Task,
} from '../../data/domain'
import { projectHealth, projectRisk } from './project-risk'

const statusLabels: Record<ProjectStatus, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  on_hold: '已暂停',
  completed: '已完成',
  cancelled: '已取消',
}

export function ProjectSummaryPanel({
  owner,
  project,
  tasks,
}: {
  owner?: Actor
  project: Project | null
  tasks: Task[]
}) {
  if (!project) {
    return (
      <GlassPanel ariaLabel="项目摘要" className="project-summary-panel">
        <h2>项目摘要</h2>
        <EmptyState title="选择项目后查看真实摘要" />
      </GlassPanel>
    )
  }

  const unfinishedTasks = tasks
    .filter((task) => task.status !== 'done')
    .sort((left, right) =>
      (left.dueDate ?? '9999-12-31').localeCompare(
        right.dueDate ?? '9999-12-31',
      ),
    )
  const overdueCount = unfinishedTasks.filter(
    (task) => task.status === 'overdue',
  ).length
  const nextTask = unfinishedTasks[0]
  const risk = overdueCount > 0
    ? `${overdueCount} 项逾期`
    : projectRisk(project)
  const health = projectHealth(project, tasks)

  return (
    <GlassPanel
      ariaLabel={`${project.name}项目摘要`}
      className="project-summary-panel"
    >
      <div className="project-summary-panel__heading">
        <div>
          <p className="project-page__eyebrow">SELECTED PROJECT</p>
          <h2>{project.name}</h2>
        </div>
        <span className={`project-card__status project-card__status--${project.status}`}>
          {statusLabels[project.status]}
        </span>
      </div>
      <dl className="project-summary-panel__facts">
        <div>
          <dt>主要负责人</dt>
          <dd>{owner?.name ?? project.ownerId}</dd>
        </div>
        <div>
          <dt>项目进度</dt>
          <dd>{project.progress}%</dd>
        </div>
        <div>
          <dt>当前状态</dt>
          <dd>{statusLabels[project.status]}</dd>
        </div>
        <div>
          <dt>健康状态</dt>
          <dd>{health}</dd>
        </div>
        <div>
          <dt>任务风险</dt>
          <dd>{risk}</dd>
        </div>
        <div>
          <dt>下一截止日期</dt>
          <dd>{nextTask?.dueDate ?? '暂无截止日期'}</dd>
        </div>
      </dl>
      {nextTask ? (
        <p className="project-summary-panel__next">
          下一项：<strong>{nextTask.title}</strong>
        </p>
      ) : null}
    </GlassPanel>
  )
}
