import type { CSSProperties, ReactNode } from 'react'

import { GlassPanel } from '../../components/ui/GlassPanel'
import type { Actor, Project, Task } from '../../data/domain'

type ActorEdge = {
  from: string
  projectName: string
  taskTitle: string
  to: string
}

type ActorPosition = {
  x: number
  y: number
}

function deriveActorEdges({
  actors,
  projects,
  tasks,
}: {
  actors: Actor[]
  projects: Project[]
  tasks: Task[]
}): ActorEdge[] {
  const actorIds = new Set(actors.map(({ id }) => id))
  const projectById = new Map(projects.map((project) => [project.id, project]))
  const evidence = new Map<string, ActorEdge>()

  for (const task of tasks) {
    if (!task.projectId) continue
    const project = projectById.get(task.projectId)
    const assigneeId = task.assigneeId ?? task.assignee.id
    if (
      !project
      || project.ownerId === assigneeId
      || !actorIds.has(project.ownerId)
      || !actorIds.has(assigneeId)
    ) continue

    const pair = [project.ownerId, assigneeId].sort()
    const key = `${pair[0]}:${pair[1]}`
    if (evidence.has(key)) continue
    evidence.set(key, {
      from: project.ownerId,
      projectName: project.name,
      taskTitle: task.title,
      to: assigneeId,
    })
  }

  return [...evidence.values()]
}

function actorPositions(actors: Actor[]): Map<string, ActorPosition> {
  const count = Math.max(actors.length, 1)
  return new Map(actors.map((actor, index) => {
    const angle = -Math.PI / 2 + index / count * Math.PI * 2
    return [actor.id, {
      x: 50 + Math.cos(angle) * 36,
      y: 50 + Math.sin(angle) * 34,
    }]
  }))
}

export function ActorNetwork({
  actors,
  currentActorId,
  filters,
  onSelectActor,
  projects,
  selectedActorId,
  tasks,
}: {
  actors: Actor[]
  currentActorId?: string
  filters?: ReactNode
  onSelectActor(actorId: string): void
  projects: Project[]
  selectedActorId: string | null
  tasks: Task[]
}) {
  const positions = actorPositions(actors)
  const edges = deriveActorEdges({ actors, projects, tasks })
  const actorById = new Map(actors.map((actor) => [actor.id, actor]))
  const unfinishedByActor = new Map<string, number>()
  for (const task of tasks) {
    if (task.status === 'done') continue
    const actorId = task.assigneeId ?? task.assignee.id
    unfinishedByActor.set(actorId, (unfinishedByActor.get(actorId) ?? 0) + 1)
  }

  return (
    <GlassPanel
      ariaLabel="协作者关系网络"
      className="actor-network-panel"
    >
      <div className="actor-network-panel__heading">
        <div>
          <p className="project-page__eyebrow">EVIDENCE NETWORK</p>
          <h2>协作者关系网络</h2>
          <p>连线仅来自项目负责人和同项目任务负责人之间的共享证据。</p>
        </div>
        <div className="actor-network-panel__controls">
          <span>{actors.length} 个节点 · {edges.length} 条证据边</span>
          {filters}
        </div>
      </div>

      <div
        aria-label="协作者关系图，可在窄屏横向滚动"
        className="actor-network-scroll"
        tabIndex={0}
      >
        <div className="actor-network-canvas">
          <svg
            aria-hidden="true"
            className="actor-network-connectors"
            preserveAspectRatio="none"
            viewBox="0 0 100 100"
          >
            {edges.map((edge) => {
              const from = positions.get(edge.from)!
              const to = positions.get(edge.to)!
              return (
                <line
                  key={`${edge.from}-${edge.to}`}
                  x1={from.x}
                  x2={to.x}
                  y1={from.y}
                  y2={to.y}
                />
              )
            })}
          </svg>
          {actors.map((actor) => {
            const position = positions.get(actor.id)!
            const isCurrent = actor.id === currentActorId
            const unfinished = unfinishedByActor.get(actor.id) ?? 0
            return (
              <button
                aria-label={`查看 ${actor.name} 协作摘要${isCurrent ? '，当前操作者' : ''}`}
                aria-pressed={selectedActorId === actor.id}
                className="actor-network-node"
                key={actor.id}
                onClick={() => onSelectActor(actor.id)}
                style={{
                  '--actor-x': `${position.x}%`,
                  '--actor-y': `${position.y}%`,
                } as CSSProperties}
                type="button"
              >
                <span className="actor-network-node__heading">
                  <strong>{actor.name}</strong>
                  {isCurrent ? <em>当前操作者</em> : null}
                </span>
                <span>{actor.kind === 'agent' ? 'Agent' : '人类'} · {unfinished} 项未完成</span>
                <span className="actor-network-node__skills">
                  {(actor.capabilities ?? []).length
                    ? actor.capabilities!.map((capability) => (
                        <small key={capability}>{capability}</small>
                      ))
                    : <small>暂无技能</small>}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {edges.length === 0 ? (
        <p className="actor-network-panel__empty">
          当前没有可由项目与任务证据确认的协作关系。
        </p>
      ) : null}
      <div className="sr-only">
        <p>当前协作连接关系：</p>
        <ul aria-label="已确认的协作关系">
          {edges.map((edge) => (
            <li key={`${edge.from}-${edge.to}-description`}>
              {`${actorById.get(edge.from)?.name} 与 ${actorById.get(edge.to)?.name} 通过 ${edge.projectName} 的任务 ${edge.taskTitle}协作`}
            </li>
          ))}
        </ul>
      </div>
    </GlassPanel>
  )
}
