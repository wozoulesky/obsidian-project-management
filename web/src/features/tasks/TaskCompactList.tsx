import { GlassPanel } from '../../components/ui/GlassPanel'
import type { Task } from '../../data/domain'

const statusLabels: Record<Task['status'], string> = {
  not_started: '未开始',
  in_progress: '进行中',
  done: '已完成',
  overdue: '已延期',
}

export interface TaskCompactListProps {
  allTasks: readonly Task[]
  dataSlot?: string
  onSelect: (taskId: string, triggerId: string) => void
  selectedTaskId: string | null
  tasks: readonly Task[]
}

export function TaskCompactList({
  allTasks,
  dataSlot,
  onSelect,
  selectedTaskId,
  tasks,
}: TaskCompactListProps) {
  return (
    <GlassPanel
      ariaLabel="任务列表"
      className="task-list-panel"
      data-slot={dataSlot}
    >
      <header className="task-list-panel__header">
        <div>
          <p>FILTERED INDEX</p>
          <h2>任务列表</h2>
        </div>
        <span>{tasks.length} 项</span>
      </header>
      <div className="task-list-scroll">
        {tasks.length === 0 ? (
          <p className="task-list-empty" role="status">
            {allTasks.length === 0
              ? '当前项目暂无任务'
              : '没有符合筛选条件的任务'}
          </p>
        ) : (
          <ul className="task-list-items">
            {tasks.map((task) => {
              const triggerId = `task-list-trigger-${task.id}`
              return (
                <li className="task-list-item" key={task.id}>
                  <button
                    aria-label={`查看 ${task.title}`}
                    aria-pressed={task.id === selectedTaskId}
                    className="task-row-button"
                    id={triggerId}
                    onClick={() => onSelect(task.id, triggerId)}
                    type="button"
                  >
                    <span className="task-row-code">
                      {task.code} · {statusLabels[task.status]}
                    </span>
                    <strong>{task.title}</strong>
                    <small>
                      {task.assignee.name} · 截止 {task.dueDate}
                    </small>
                  </button>
                  <span className="task-list-item__priority">
                    {task.priority}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </GlassPanel>
  )
}
