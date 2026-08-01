import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'

import {
  EmptyState,
  ErrorState,
  LoadingState,
  RefreshState,
} from '../../components/data/DataState'
import { PageHeader } from '../../components/layout/PageHeader'
import { Button } from '../../components/ui/Button'
import { GlassPanel } from '../../components/ui/GlassPanel'
import type { Actor } from '../../data/domain'
import {
  useActors,
  useAllTasks,
  useCurrentActor,
  useDeactivateActor,
  useProjects,
} from '../../data/query-hooks'
import { ActorFormDialog } from './ActorFormDialog'
import { ActorNetwork } from './ActorNetwork'
import './actors-glass.css'

const roleLabels: Record<string, string> = {
  owner: '负责人',
  member: '成员',
  'pm-agent': 'PM Agent',
  'dev-agent': '开发 Agent',
  'qa-agent': 'QA Agent',
  'doc-agent': '文档 Agent',
}

function lastActivityLabel(value?: string | null): string {
  if (!value) return '最近活动：暂无'
  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) return `最近活动：${value}`
  return `最近活动：${new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp)}`
}

function DeactivateActorDialog({
  actor,
  onClose,
}: {
  actor: Actor
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const deactivateActor = useDeactivateActor()
  const [error, setError] = useState('')

  const confirm = async () => {
    if (actor.version === undefined) {
      setError('此负责人缺少可停用的版本信息')
      return
    }
    try {
      await deactivateActor.mutateAsync({
        actorId: actor.id,
        version: actor.version,
      })
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '负责人停用失败')
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const buttons = Array.from(
      dialogRef.current?.querySelectorAll<HTMLButtonElement>(
        'button:not([disabled])',
      ) ?? [],
    )
    const first = buttons[0]
    const last = buttons.at(-1)
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      aria-labelledby="deactivate-actor-title"
      aria-modal="true"
      className="project-dialog"
      onKeyDown={handleKeyDown}
      ref={dialogRef}
      role="dialog"
    >
      <section className="project-dialog__panel actor-confirm">
        <header>
          <h2 id="deactivate-actor-title">确认停用 {actor.name}</h2>
        </header>
        <p>
          停用后将不能再被分配到新项目或新任务，已有记录会继续保留。
        </p>
        {error ? <p role="alert">{error}</p> : null}
        <footer>
          <Button autoFocus onClick={onClose}>取消</Button>
          <Button
            disabled={deactivateActor.isPending}
            onClick={() => void confirm()}
            variant="primary"
          >
            {deactivateActor.isPending ? '正在停用…' : '确认停用'}
          </Button>
        </footer>
      </section>
    </div>
  )
}

type DialogState =
  | { mode: 'create' }
  | { mode: 'edit'; actor: Actor }
  | { mode: 'deactivate'; actor: Actor }
  | null

export function ActorPage() {
  const actorsQuery = useActors()
  const currentActorQuery = useCurrentActor()
  const projectsQuery = useProjects()
  const tasksQuery = useAllTasks()
  const [dialog, setDialog] = useState<DialogState>(null)
  const [copyStatus, setCopyStatus] = useState('')
  const openerRef = useRef<HTMLButtonElement | null>(null)

  const projectCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const project of projectsQuery.data ?? []) {
      counts.set(project.ownerId, (counts.get(project.ownerId) ?? 0) + 1)
    }
    return counts
  }, [projectsQuery.data])

  const taskCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const task of tasksQuery.data ?? []) {
      const actorId = task.assigneeId ?? task.assignee?.id
      if (actorId) counts.set(actorId, (counts.get(actorId) ?? 0) + 1)
    }
    return counts
  }, [tasksQuery.data])

  const queries = [
    actorsQuery,
    currentActorQuery,
    projectsQuery,
    tasksQuery,
  ]
  const initialErrorQuery = queries.find(
    (query) => query.isError && query.data === undefined,
  )
  const isPending = !initialErrorQuery
    && queries.some((query) => query.isPending)
  const error = initialErrorQuery?.error
    ?? actorsQuery.error
    ?? currentActorQuery.error
    ?? projectsQuery.error
    ?? tasksQuery.error
  const retry = () => {
    void actorsQuery.refetch()
    void currentActorQuery.refetch()
    void projectsQuery.refetch()
    void tasksQuery.refetch()
  }
  const closeDialog = () => {
    setDialog(null)
    openerRef.current?.focus()
  }
  const openDialog = (
    event: MouseEvent<HTMLButtonElement>,
    next: Exclude<DialogState, null>,
  ) => {
    openerRef.current = event.currentTarget
    setDialog(next)
  }

  const copyActorId = async (actor: Actor) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(actor.id)
      setCopyStatus(`已复制 ${actor.name} 的 Agent ID`)
    } catch {
      setCopyStatus(`无法自动复制，请手动复制 Agent ID：${actor.id}`)
    }
  }

  return (
    <section aria-labelledby="actor-page-title" className="actor-page">
      <PageHeader
        actions={(
          <Button
            onClick={(event) => openDialog(event, { mode: 'create' })}
            variant="primary"
          >
            新增负责人
          </Button>
        )}
        eyebrow="ACTOR NETWORK"
        subtitle="用项目与任务证据观察人类负责人和 Agent 的技能、负载与协作关系。"
        title={<span id="actor-page-title">负责人目录</span>}
      />

      <GlassPanel ariaLabel="Agent 注册说明" className="actor-page__agent-note">
        <strong>Agent 通过 MCP 注册。</strong>
        <span>在 Agent 客户端完成注册后，它会自动出现在此目录中。</span>
      </GlassPanel>
      {copyStatus ? <p className="actor-page__copy-status" role="status">{copyStatus}</p> : null}

      {isPending ? <LoadingState label="正在加载负责人目录" /> : null}
      {!isPending && initialErrorQuery ? (
        <ErrorState error={error} onRetry={retry} />
      ) : null}
      {!isPending && !initialErrorQuery ? (
        <>
          <RefreshState
            dataUpdatedAt={Math.min(
              actorsQuery.dataUpdatedAt,
              projectsQuery.dataUpdatedAt,
              tasksQuery.dataUpdatedAt,
            )}
            error={error}
            isError={queries.some((query) => query.isError)}
            isFetching={queries.some((query) => query.isFetching)}
          />
          {(actorsQuery.data ?? []).length === 0 ? (
            <EmptyState title="还没有负责人" />
          ) : (
            <>
              <ActorNetwork
                actors={actorsQuery.data ?? []}
                currentActorId={currentActorQuery.data?.id}
                projects={projectsQuery.data ?? []}
                tasks={tasksQuery.data ?? []}
              />
              <GlassPanel as="div" className="actor-directory-panel">
                <div className="actor-directory-panel__heading">
                  <div>
                    <p className="project-page__eyebrow">FULL DIRECTORY</p>
                    <h2>完整目录</h2>
                  </div>
                  <span>{actorsQuery.data?.length ?? 0} 位协作者</span>
                </div>
                <div className="actor-table data-grid">
              <table aria-label="负责人目录">
                <thead>
                  <tr>
                    <th scope="col">名称</th>
                    <th scope="col">类型</th>
                    <th scope="col">角色</th>
                    <th scope="col">客户端</th>
                    <th scope="col">状态</th>
                    <th scope="col">主责项目</th>
                    <th scope="col">分配任务</th>
                    <th scope="col">最近活动</th>
                    <th scope="col">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {(actorsQuery.data ?? []).map((actor) => {
                    const inactive = actor.status === 'inactive'
                    return (
                      <tr
                        aria-disabled={inactive || undefined}
                        className={inactive ? 'is-inactive' : ''}
                        key={actor.id}
                      >
                        <td>
                          <strong>{actor.name}</strong>
                          {actor.kind === 'agent' ? <code>{actor.id}</code> : null}
                        </td>
                        <td>{actor.kind === 'agent' ? 'Agent' : '人类'}</td>
                        <td>{roleLabels[actor.role ?? ''] ?? actor.role ?? '—'}</td>
                        <td>{actor.client ?? '—'}</td>
                        <td>
                          <span className={`actor-status actor-status--${actor.status ?? 'active'}`}>
                            {inactive ? '已停用' : '活跃'}
                          </span>
                        </td>
                        <td>{projectCounts.get(actor.id) ?? 0} 个项目</td>
                        <td>{taskCounts.get(actor.id) ?? 0} 个任务</td>
                        <td>{lastActivityLabel(actor.lastActiveAt)}</td>
                        <td>
                          <div className="actor-table__actions">
                            {actor.kind === 'human' ? (
                              <>
                                <Button
                                  aria-label={`编辑 ${actor.name}`}
                                  disabled={inactive}
                                  onClick={(event) => openDialog(event, {
                                    mode: 'edit',
                                    actor,
                                  })}
                                  variant="ghost"
                                >
                                  编辑
                                </Button>
                                <Button
                                  aria-label={`停用 ${actor.name}`}
                                  disabled={inactive}
                                  onClick={(event) => openDialog(event, {
                                    mode: 'deactivate',
                                    actor,
                                  })}
                                  variant="ghost"
                                >
                                  停用
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button
                                  aria-label={`复制 ${actor.name} 的 Agent ID`}
                                  onClick={() => void copyActorId(actor)}
                                  variant="ghost"
                                >
                                  复制 Agent ID
                                </Button>
                                <Button
                                  aria-label={`停用 ${actor.name}`}
                                  disabled={inactive}
                                  onClick={(event) => openDialog(event, {
                                    mode: 'deactivate',
                                    actor,
                                  })}
                                  variant="ghost"
                                >
                                  停用
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
                </div>
              </GlassPanel>
            </>
          )}
        </>
      ) : null}

      {dialog?.mode === 'create' ? (
        <ActorFormDialog onClose={closeDialog} />
      ) : null}
      {dialog?.mode === 'edit' ? (
        <ActorFormDialog actor={dialog.actor} onClose={closeDialog} />
      ) : null}
      {dialog?.mode === 'deactivate' ? (
        <DeactivateActorDialog actor={dialog.actor} onClose={closeDialog} />
      ) : null}
    </section>
  )
}
