import { Link } from 'react-router-dom'

import type { Actor, Project, ProjectStatus } from '../../data/domain'

const statusLabels: Record<ProjectStatus, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  on_hold: '已暂停',
  completed: '已完成',
  cancelled: '已取消',
}

function projectRisk(project: Project): string {
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

export function ProjectCard({
  owner,
  project,
}: {
  owner?: Actor
  project: Project
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
          <dt>负责人</dt>
          <dd>{owner?.name ?? project.ownerId}</dd>
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
      <Link className="project-card__link" to={`/projects/${project.id}`}>
        查看项目
      </Link>
    </article>
  )
}
