import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import {
  EmptyState,
  ErrorState,
  LoadingState,
  RefreshState,
} from '../../components/data/DataState'
import { MetricGrid } from '../../components/layout/MetricGrid'
import { PageHeader } from '../../components/layout/PageHeader'
import { Button } from '../../components/ui/Button'
import { GlassPanel } from '../../components/ui/GlassPanel'
import type { Deliverable, Handoff } from '../../data/domain'
import {
  useActors,
  useProject,
  useProjectDeliverables,
  useProjectHandoffs,
  useProjectMembers,
  useProjects,
  useProjectTasks,
} from '../../data/query-hooks'
import { CreateTaskDialog } from './CreateTaskDialog'
import { MilestoneTrack } from './MilestoneTrack'
import { deriveMilestones } from './milestone-derivation'
import { projectRisk } from './project-risk'
import './projects-glass.css'

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

function newestByCreatedAt<T extends Handoff | Deliverable>(items: T[]): T | null {
  return [...items].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  )[0] ?? null
}

function DeliveryHandoffPanel({
  deliverablesQuery,
  handoffsQuery,
}: {
  deliverablesQuery: ReturnType<typeof useProjectDeliverables>
  handoffsQuery: ReturnType<typeof useProjectHandoffs>
}) {
  const deliverables = deliverablesQuery.data
  const handoffs = handoffsQuery.data
  const initialError = [deliverablesQuery, handoffsQuery].find(
    (query) => query.isError && query.data === undefined,
  )
  const retry = () => {
    void deliverablesQuery.refetch()
    void handoffsQuery.refetch()
  }

  return (
    <GlassPanel ariaLabel="交付与交接" className="project-relay-panel">
      <div className="project-detail-panel-heading">
        <div>
          <p className="project-page__eyebrow">DELIVERY RELAY</p>
          <h2>交付与交接</h2>
        </div>
        <span>当前项目证据</span>
      </div>
      {(deliverablesQuery.isPending && deliverables === undefined)
      || (handoffsQuery.isPending && handoffs === undefined) ? (
        <LoadingState label="正在加载交付与交接" />
      ) : initialError ? (
        <ErrorState
          error={initialError.error}
          isRetrying={
            deliverablesQuery.isFetching || handoffsQuery.isFetching
          }
          onRetry={retry}
        />
      ) : (
        <>
          <RefreshState
            dataUpdatedAt={Math.min(
              deliverablesQuery.dataUpdatedAt,
              handoffsQuery.dataUpdatedAt,
            )}
            error={deliverablesQuery.error ?? handoffsQuery.error}
            isError={deliverablesQuery.isError || handoffsQuery.isError}
            isFetching={
              deliverablesQuery.isFetching || handoffsQuery.isFetching
            }
            label="正在刷新交付与交接"
          />
          <div className="project-relay-panel__grid">
            <section aria-label="项目交付物">
              <h3>交付物</h3>
              {deliverables?.length ? (
                <ul>
                  {deliverables.slice(0, 2).map((deliverable) => (
                    <li key={deliverable.id}>
                      <strong>{deliverable.title}</strong>
                      <code>{deliverable.ref}</code>
                      <span>{deliverable.createdBy.name}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="当前项目尚未登记交付物" />
              )}
            </section>
            <section aria-label="最近项目交接">
              <h3>最近交接</h3>
              {newestByCreatedAt(handoffs ?? []) ? (
                <div className="project-relay-panel__handoff">
                  <strong>{newestByCreatedAt(handoffs ?? [])!.author.name}</strong>
                  <p>{newestByCreatedAt(handoffs ?? [])!.summary}</p>
                  <time dateTime={newestByCreatedAt(handoffs ?? [])!.createdAt}>
                    {newestByCreatedAt(handoffs ?? [])!.createdAt.slice(0, 10)}
                  </time>
                </div>
              ) : (
                <EmptyState title="当前项目尚未登记交接" />
              )}
            </section>
          </div>
        </>
      )}
    </GlassPanel>
  )
}

export function ProjectDetailPage() {
  const params = useParams<{ id: string }>()
  const navigate = useNavigate()
  const selectedProjectId = params.id
    ?? window.location.pathname.split('/').filter(Boolean).at(-1)
    ?? ''
  const projectsQuery = useProjects()
  const projectQuery = useProject(selectedProjectId)
  const actorsQuery = useActors()
  const membersQuery = useProjectMembers(selectedProjectId)
  const tasksQuery = useProjectTasks(selectedProjectId)
  const handoffsQuery = useProjectHandoffs(selectedProjectId)
  const deliverablesQuery = useProjectDeliverables(selectedProjectId)
  const [dialogOpen, setDialogOpen] = useState(false)
  const openerRef = useRef<HTMLButtonElement | null>(null)

  const actorById = useMemo(
    () => new Map((actorsQuery.data ?? []).map((actor) => [actor.id, actor])),
    [actorsQuery.data],
  )
  const project = projectQuery.data
  const tasks = tasksQuery.data ?? []
  const owner = project ? actorById.get(project.ownerId) : undefined
  const memberIds = new Set(
    (membersQuery.data ?? []).map((membership) => membership.actorId),
  )
  if (project) memberIds.add(project.ownerId)
  const members = [...memberIds]
    .map((actorId) => actorById.get(actorId))
    .filter((actor) => actor !== undefined)
  const activeMembers = members.filter(({ status }) => status === 'active')

  const coreQueries = [
    projectsQuery,
    projectQuery,
    actorsQuery,
    membersQuery,
    tasksQuery,
  ]
  const allQueries = [...coreQueries, handoffsQuery, deliverablesQuery]
  const initialErrorQuery = coreQueries.find(
    (query) => query.isError && query.data === undefined,
  )
  const isPending = !initialErrorQuery
    && coreQueries.some((query) => query.isPending)
  const error = initialErrorQuery?.error
    ?? allQueries.find((query) => query.error)?.error
  const retry = () => {
    for (const query of allQueries) void query.refetch()
  }
  const closeDialog = () => {
    setDialogOpen(false)
    openerRef.current?.focus()
  }
  const milestoneCount = deriveMilestones(tasks).length
  const openTasks = tasks
    .filter(({ status }) => status !== 'done')
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate))
  const openTaskCount = openTasks.length
  const deliverableMetric = deliverablesQuery.data === undefined
    ? [
        '交付物',
        '—',
        deliverablesQuery.isError
          ? '交付证据读取失败'
          : '正在确认交付证据',
      ]
    : ['交付物', String(deliverablesQuery.data.length), '已登记证据']

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
              ...allQueries.map((query) => query.dataUpdatedAt),
            )}
            error={error}
            isError={allQueries.some((query) => query.isError)}
            isFetching={allQueries.some((query) => query.isFetching)}
          />
          <div className="project-detail__toolbar">
            <Link className="project-detail__back" to="/projects">
              返回全部项目
            </Link>
            <label className="project-detail__selector">
              <span>选择项目</span>
              <select
                aria-label="选择项目"
                onChange={(event) => navigate(`/projects/${event.target.value}`)}
                value={selectedProjectId}
              >
                {(projectsQuery.data ?? []).map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </label>
            <Button onClick={retry} variant="ghost">刷新项目数据</Button>
          </div>
          <PageHeader
            actions={(
              <Button
                onClick={(event) => {
                  openerRef.current = event.currentTarget
                  setDialogOpen(true)
                }}
                variant="primary"
              >
                新建任务
              </Button>
            )}
            eyebrow={project.code}
            subtitle="聚焦当前项目的任务、里程碑、成员与交付接力。"
            title={<span id="project-detail-title">{project.name}</span>}
          />

          <MetricGrid ariaLabel="项目详情关键指标">
            {[
              ['总体进度', `${project.progress}%`, '项目记录进度'],
              ['开放任务', String(openTaskCount), `${tasks.length} 项总计`],
              ['里程碑', String(milestoneCount), '来自任务标签'],
              deliverableMetric,
            ].map(([label, value, detail]) => (
              <article className="metric-card dashboard-metric" key={label}>
                <span className="metric-card__label">{label}</span>
                <strong className="metric-value">{value}</strong>
                <span className="metric-card__detail">{detail}</span>
              </article>
            ))}
          </MetricGrid>

          <MilestoneTrack tasks={tasks} />

          <div className="project-brief-grid" data-testid="project-brief-grid">
            <GlassPanel ariaLabel="项目简报" className="project-detail__brief-panel">
              <div className="project-detail-panel-heading">
                <div>
                  <p className="project-page__eyebrow">PROJECT BRIEF</p>
                  <h2>项目简报</h2>
                </div>
                <span>当前事实</span>
              </div>
              <p>{project.description || '暂无项目描述'}</p>
              <dl className="project-detail__facts">
                <div><dt>主要负责人</dt><dd>{owner?.name ?? '未分配'}</dd></div>
                <div><dt>状态</dt><dd>{projectStatusLabels[project.status]}</dd></div>
                <div>
                  <dt>进度</dt>
                  <dd>
                    <progress max="100" value={project.progress}>
                      {project.progress}%
                    </progress>{' '}
                    {project.progress}%
                  </dd>
                </div>
                <div><dt>开始日期</dt><dd>{project.startDate ?? '未排期'}</dd></div>
                <div><dt>截止日期</dt><dd>{project.dueDate ?? '未排期'}</dd></div>
                <div><dt>风险</dt><dd>{projectRisk(project)}</dd></div>
                <div>
                  <dt>项目成员</dt>
                  <dd>
                    {members.length ? (
                      <span className="project-detail__member-names">
                        {members.map((member) => (
                          <span key={member.id}>
                            <span>{member.name}</span>
                            {member.status === 'active'
                              ? null
                              : <small>已停用</small>}
                          </span>
                        ))}
                      </span>
                    ) : '暂无项目成员'}
                  </dd>
                </div>
              </dl>
            </GlassPanel>

            <GlassPanel ariaLabel="开放任务" className="project-detail__tasks">
              <div className="project-detail-panel-heading">
                <div>
                  <p className="project-page__eyebrow">OPEN TASKS</p>
                  <h2>开放任务</h2>
                </div>
                <span>{openTaskCount} 项</span>
              </div>
              {openTasks.length > 0 ? (
                <ul>
                  {openTasks.slice(0, 4).map((task) => (
                    <li key={task.id}>
                      <div><strong>{task.title}</strong><small>{task.code}</small></div>
                      <span>{actorById.get(task.assigneeId ?? '')?.name ?? task.assignee.name}</span>
                      <span>{task.priority}</span>
                      <span>{taskStatusLabels[task.status]}</span>
                      <time dateTime={task.dueDate}>{task.dueDate}</time>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState title="当前项目没有开放任务" />}
            </GlassPanel>
            <DeliveryHandoffPanel
              deliverablesQuery={deliverablesQuery}
              handoffsQuery={handoffsQuery}
            />
          </div>

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
