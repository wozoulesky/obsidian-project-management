import { useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import {
  EmptyState,
  ErrorState,
  LoadingState,
  RefreshState,
} from '../../components/data/DataState'
import { Button } from '../../components/ui/Button'
import {
  useActors,
  useProject,
  useProjectMembers,
  useProjectTasks,
} from '../../data/query-hooks'
import { CreateTaskDialog } from './CreateTaskDialog'
import { projectRisk } from './project-risk'

const projectStatusLabels = {
  not_started: '未开始',
  in_progress: '进行中',
  on_hold: '已暂停',
  completed: '已完成',
  cancelled: '已取消',
} as const

const taskStatusLabels = {
  not_started: '未开始',
  in_progress: '进行中',
  done: '已完成',
  overdue: '已逾期',
} as const

export function ProjectDetailPage() {
  const params = useParams<{ id: string }>()
  const selectedProjectId = params.id
    ?? window.location.pathname.split('/').filter(Boolean).at(-1)
    ?? ''
  const projectQuery = useProject(selectedProjectId)
  const actorsQuery = useActors()
  const membersQuery = useProjectMembers(selectedProjectId)
  const tasksQuery = useProjectTasks(selectedProjectId)
  const [dialogOpen, setDialogOpen] = useState(false)
  const openerRef = useRef<HTMLButtonElement | null>(null)

  const actorById = useMemo(
    () => new Map((actorsQuery.data ?? []).map((actor) => [actor.id, actor])),
    [actorsQuery.data],
  )
  const project = projectQuery.data
  const owner = project ? actorById.get(project.ownerId) : undefined
  const memberIds = new Set(
    (membersQuery.data ?? []).map((membership) => membership.actorId),
  )
  if (project) memberIds.add(project.ownerId)
  const members = [...memberIds]
    .map((actorId) => actorById.get(actorId))
    .filter((actor) => actor !== undefined)
  const activeMembers = members.filter(({ status }) => status === 'active')

  const queries = [projectQuery, actorsQuery, membersQuery, tasksQuery]
  const initialErrorQuery = queries.find(
    (query) => query.isError && query.data === undefined,
  )
  const isPending =
    !initialErrorQuery && queries.some((query) => query.isPending)
  const error = initialErrorQuery?.error
    ?? projectQuery.error
    ?? actorsQuery.error
    ?? membersQuery.error
    ?? tasksQuery.error
  const retry = () => {
    void projectQuery.refetch()
    void actorsQuery.refetch()
    void membersQuery.refetch()
    void tasksQuery.refetch()
  }
  const closeDialog = () => {
    setDialogOpen(false)
    openerRef.current?.focus()
  }

  return (
    <section
      aria-labelledby="project-detail-title"
      className="project-page project-detail"
    >
      {isPending ? <LoadingState label="正在加载项目详情" /> : null}
      {!isPending && initialErrorQuery ? (
        <ErrorState error={error} onRetry={retry} />
      ) : null}
      {!isPending && !initialErrorQuery && project ? (
        <>
          <RefreshState
            dataUpdatedAt={Math.min(
              projectQuery.dataUpdatedAt,
              actorsQuery.dataUpdatedAt,
              membersQuery.dataUpdatedAt,
              tasksQuery.dataUpdatedAt,
            )}
            error={error}
            isError={queries.some((query) => query.isError)}
            isFetching={queries.some((query) => query.isFetching)}
          />
          <header className="project-page__header">
            <div>
              <Link className="project-detail__back" to="/projects">
                返回全部项目
              </Link>
              <p className="project-page__eyebrow">{project.code}</p>
              <h1 id="project-detail-title">{project.name}</h1>
            </div>
            <Button
              onClick={(event) => {
                openerRef.current = event.currentTarget
                setDialogOpen(true)
              }}
              variant="primary"
            >
              新建任务
            </Button>
          </header>

          <div className="project-detail__overview">
            <section aria-labelledby="project-overview-title">
              <h2 id="project-overview-title">项目概览</h2>
              <p>{project.description || '暂无项目描述'}</p>
              <dl className="project-detail__facts">
                <div>
                  <dt>主要负责人</dt>
                  <dd>{owner?.name ?? '未分配'}</dd>
                </div>
                <div>
                  <dt>状态</dt>
                  <dd>{projectStatusLabels[project.status]}</dd>
                </div>
                <div>
                  <dt>进度</dt>
                  <dd>
                    <progress max="100" value={project.progress}>
                      {project.progress}%
                    </progress>{' '}
                    {project.progress}%
                  </dd>
                </div>
                <div>
                  <dt>开始日期</dt>
                  <dd>{project.startDate ?? '未排期'}</dd>
                </div>
                <div>
                  <dt>截止日期</dt>
                  <dd>{project.dueDate ?? '未排期'}</dd>
                </div>
                <div>
                  <dt>风险</dt>
                  <dd>{projectRisk(project)}</dd>
                </div>
              </dl>
            </section>

            <section aria-labelledby="project-members-title">
              <h2 id="project-members-title">项目成员</h2>
              {members.length > 0 ? (
                <ul className="project-detail__members">
                  {members.map((member) => (
                    <li key={member.id}>
                      <span>{member.name}</span>
                      <small>
                        {member.id === project.ownerId ? '负责人' : '成员'}
                        {member.status !== 'active' ? ' · 已停用' : ''}
                      </small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>暂无项目成员</p>
              )}
            </section>
          </div>

          <section
            aria-labelledby="project-tasks-title"
            className="project-detail__tasks"
          >
            <h2 id="project-tasks-title">项目任务</h2>
            {(tasksQuery.data ?? []).length > 0 ? (
              <ul>
                {(tasksQuery.data ?? []).map((task) => (
                  <li key={task.id}>
                    <div>
                      <strong>{task.title}</strong>
                      <small>{task.code}</small>
                    </div>
                    <span>{actorById.get(task.assigneeId ?? '')?.name
                      ?? task.assignee.name}</span>
                    <span>{task.priority}</span>
                    <span>{taskStatusLabels[task.status]}</span>
                    <time dateTime={task.dueDate}>{task.dueDate}</time>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="当前项目还没有任务" />
            )}
          </section>

          {dialogOpen ? (
            <CreateTaskDialog
              activeMembers={activeMembers}
              onClose={closeDialog}
              projectId={project.id}
              projectName={project.name}
            />
          ) : null}
        </>
      ) : null}
    </section>
  )
}
