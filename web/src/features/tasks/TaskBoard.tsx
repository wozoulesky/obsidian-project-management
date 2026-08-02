import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'

import { GlassPanel } from '../../components/ui/GlassPanel'
import type { Task, TaskStatus } from '../../data/domain'
import { taskStatusLabels, taskStatuses } from './task-workspace-model'

export interface TaskBoardProps {
  dataSlot?: string
  onMoveTask: (task: Task, status: TaskStatus) => Promise<void>
  onSelect: (taskId: string) => void
  selectedTaskId: string | null
  tasks: readonly Task[]
}

type MoveTask = (task: Task, status: TaskStatus) => Promise<void>

// Kept pure so drag behavior can be verified without unreliable JSDOM geometry.
// eslint-disable-next-line react-refresh/only-export-components
export function statusFromDrop(
  overId: string | null | undefined,
): TaskStatus | null {
  if (!overId?.startsWith('column:')) return null
  const status = overId.slice('column:'.length)
  return taskStatuses.find((candidate) => candidate === status) ?? null
}

// eslint-disable-next-line react-refresh/only-export-components
export function createTaskBoardDragEndHandler(moveTask: MoveTask) {
  return async (event: DragEndEvent): Promise<void> => {
    const task = event.active.data.current?.task as Task | undefined
    const status = statusFromDrop(
      event.over === null ? null : String(event.over.id),
    )
    if (!task || !status || status === task.status) return
    await moveTask(task, status)
  }
}

function BoardColumn({
  children,
  count,
  status,
}: {
  children: ReactNode
  count: number
  status: TaskStatus
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `column:${status}`,
    data: { status },
  })

  return (
    <section
      aria-label={`${taskStatusLabels[status]}任务列`}
      className="task-board__column"
      data-over={isOver || undefined}
      data-status={status}
      ref={setNodeRef}
    >
      <header className="task-board__column-header">
        <h3>{taskStatusLabels[status]}</h3>
        <span>{count}</span>
      </header>
      <div className="task-board__cards">
        {count === 0 ? (
          <p className="task-board__empty">暂无任务</p>
        ) : children}
      </div>
    </section>
  )
}

function BoardCard({
  isPending,
  moveTask,
  onSelect,
  selectedTaskId,
  task,
}: {
  isPending: boolean
  moveTask: MoveTask
  onSelect: (taskId: string) => void
  selectedTaskId: string | null
  task: Task
}) {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
  } = useDraggable({
    id: `task:${task.id}`,
    data: { task },
    disabled: isPending,
  })
  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      } satisfies CSSProperties
    : undefined

  return (
    <article
      className="task-board__card"
      data-dragging={isDragging || undefined}
      data-status={task.status}
      data-testid={`task-board-card-${task.id}`}
      ref={setNodeRef}
      style={style}
    >
      <div className="task-board__card-actions">
        <button
          aria-label={`选择 ${task.code} ${task.title}`}
          aria-pressed={task.id === selectedTaskId}
          className="task-board__select"
          onClick={() => onSelect(task.id)}
          type="button"
        >
          <small>{task.code}</small>
          <strong>{task.title}</strong>
        </button>
        <button
          {...attributes}
          {...listeners}
          aria-label={`拖拽 ${task.title}`}
          className="task-board__drag-handle"
          disabled={isPending}
          type="button"
        >
          <span aria-hidden="true">⋮⋮</span>
        </button>
      </div>
      <dl className="task-board__metadata">
        <div>
          <dt>进度</dt>
          <dd>{task.progress}%</dd>
        </div>
        <div>
          <dt>负责人</dt>
          <dd>{task.assignee.name}</dd>
        </div>
        <div>
          <dt>优先级</dt>
          <dd>{task.priority}</dd>
        </div>
        <div>
          <dt>截止</dt>
          <dd>{task.dueDate}</dd>
        </div>
      </dl>
      <label className="task-board__move-control">
        <span>移动到</span>
        <select
          aria-label={`移动 ${task.title} 到`}
          disabled={isPending}
          onChange={(event) => {
            const status = taskStatuses.find(
              (candidate) => candidate === event.currentTarget.value,
            )
            if (status && status !== task.status) {
              void moveTask(task, status)
            }
          }}
          value={task.status}
        >
          {taskStatuses.map((status) => (
            <option key={status} value={status}>
              {taskStatusLabels[status]}
            </option>
          ))}
        </select>
      </label>
    </article>
  )
}

export function TaskBoard({
  dataSlot,
  onMoveTask,
  onSelect,
  selectedTaskId,
  tasks,
}: TaskBoardProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor),
  )
  const [announcements, setAnnouncements] = useState<readonly {
    id: number
    message: string
  }[]>([])
  const [pendingTaskIds, setPendingTaskIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const pendingMoves = useRef(new Map<string, symbol>())
  const announce = useCallback((message: string) => {
    setAnnouncements((current) => {
      const announcement = {
        id: (current.at(-1)?.id ?? 0) + 1,
        message,
      }
      return [...current, announcement].slice(-12)
    })
  }, [])
  const moveTask = useCallback(async (task: Task, status: TaskStatus) => {
    if (pendingMoves.current.has(task.id)) return
    const token = Symbol(task.id)
    pendingMoves.current.set(task.id, token)
    setPendingTaskIds((current) => new Set(current).add(task.id))
    try {
      await onMoveTask(task, status)
      announce(
        `已将 ${task.title} 移动到${taskStatusLabels[status]}`,
      )
    } catch {
      announce(`移动 ${task.title} 失败，任务已恢复到原状态`)
    } finally {
      if (pendingMoves.current.get(task.id) === token) {
        pendingMoves.current.delete(task.id)
        setPendingTaskIds((current) => {
          const next = new Set(current)
          next.delete(task.id)
          return next
        })
      }
    }
  }, [announce, onMoveTask])
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    void createTaskBoardDragEndHandler(moveTask)(event)
  }, [moveTask])

  return (
    <GlassPanel
      ariaLabel="任务看板工作区"
      className="task-board"
      data-slot={dataSlot}
      style={{ gridColumn: '1 / span 2' }}
    >
      <DndContext
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        sensors={sensors}
      >
        <div className="task-board__scroll">
          <div className="task-board__grid">
            {taskStatuses.map((status) => {
              const columnTasks = tasks.filter((task) => task.status === status)
              return (
                <BoardColumn
                  count={columnTasks.length}
                  key={status}
                  status={status}
                >
                  {columnTasks.map((task) => (
                    <BoardCard
                      isPending={pendingTaskIds.has(task.id)}
                      key={task.id}
                      moveTask={moveTask}
                      onSelect={onSelect}
                      selectedTaskId={selectedTaskId}
                      task={task}
                    />
                  ))}
                </BoardColumn>
              )
            })}
          </div>
        </div>
      </DndContext>
      <p aria-live="polite" className="task-board__announcement" role="status">
        {announcements.map((announcement) => (
          <span
            data-announcement-id={announcement.id}
            key={announcement.id}
          >
            {announcement.message}
          </span>
        ))}
      </p>
    </GlassPanel>
  )
}
