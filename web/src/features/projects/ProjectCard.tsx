import { Link } from 'react-router-dom'

import type { Actor, Project, ProjectStatus } from '../../data/domain'
import { projectRisk } from './project-risk'

const statusLabels: Record<ProjectStatus, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  on_hold: '已暂停',
  completed: '已完成',
  cancelled: '已取消',
}

export function ProjectCard({
  owner,
  onSelect,
  project,
  selected,
  taskCount,
}: {
  owner?: Actor
  onSelect: () => void
  project: Project
  selected: boolean
  taskCount: number
}) {
  const risk = projectRisk(project)
  return (
    <article aria-label={project.name} className="project-card">
      <div className="project-card__heading">
        <div>
          <small>{project.code}</small>
          <h2>{project.name}</h2>
        </div>
        <span className={`project-card__status project-card__status--${project.status}`}>
          {statusLabels[project.status]}
        </span>
      </div>
      {project.description ? (
        <p className="project-card__description">{project.description}</p>
      ) : null}
      <dl className="project-card__facts">
        <div>
          <dt>主要负责人</dt>
          <dd>{owner?.name ?? project.ownerId}</dd>
        </div>
        <div>
          <dt>任务数</dt>
          <dd>{taskCount}</dd>
        </div>
        <div>
          <dt>截止日期</dt>
          <dd>{project.dueDate ?? '未设置'}</dd>
        </div>
        <div>
          <dt>到期风险</dt>
          <dd className={risk === '已逾期' ? 'is-critical' : ''}>{risk}</dd>
        </div>
      </dl>
      <div className="project-card__progress">
        <span>项目进度</span>
        <strong>{project.progress}%</strong>
        <progress
          aria-label={`${project.name}进度`}
          max="100"
          value={project.progress}
        />
      </div>
      <div className="project-card__actions">
        <button
          aria-label={`查看 ${project.name} 摘要`}
          aria-pressed={selected}
          className="project-card__summary-button"
          onClick={onSelect}
          type="button"
        >
          查看摘要
        </button>
        <Link
          aria-label={`进入 ${project.name} 详情`}
          className="project-card__link"
          to={`/projects/${project.id}`}
        >
          进入项目
        </Link>
      </div>
    </article>
  )
}
