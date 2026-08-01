import type { CSSProperties } from 'react'

import { GlassPanel } from '../../components/ui/GlassPanel'
import type { Task } from '../../data/domain'

const statusLabels: Record<Task['status'], string> = {
  not_started: '待开始',
  in_progress: '进行中',
  done: '已完成',
  overdue: '逾期',
}

export interface TaskFanProps {
  onSelect: (taskId: string, triggerId: string) => void
  selectedTaskId: string | null
  tasks: readonly Task[]
}

export function TaskFan({
  onSelect,
  selectedTaskId,
  tasks,
}: TaskFanProps) {
  const visibleTasks = tasks.slice(0, 6)
  const listStyle = {
    '--task-fan-count': Math.max(visibleTasks.length, 1),
  } as CSSProperties

  return (
    <GlassPanel ariaLabel="任务扇面" className="task-fan">
      <header className="task-fan__header">
        <div>
          <p>PRIORITY STACK</p>
          <h2>任务扇面</h2>
        </div>
        <span>{visibleTasks.length} / 最多 6 项</span>
      </header>
      {visibleTasks.length === 0 ? (
        <p className="task-fan__empty" role="status">
          当前筛选范围暂无可展示任务
        </p>
      ) : (
        <div className="task-fan__scroll" tabIndex={0}>
          <ul className="task-fan__list" style={listStyle}>
            {visibleTasks.map((task, index) => {
              const isSelected = task.id === selectedTaskId
              const itemStyle = {
                '--task-fan-depth': Math.abs(
                  index - Math.max(0, visibleTasks.length - 1) / 2,
                ),
                '--task-fan-index': index,
                '--task-fan-position':
                  index - Math.max(0, visibleTasks.length - 1) / 2,
              } as CSSProperties
              return (
                <li
                  className="task-fan__item"
                  data-status={task.status}
                  key={task.id}
                  style={itemStyle}
                >
                  <button
                    aria-label={`选择 ${task.code} ${task.title}`}
                    aria-pressed={isSelected}
                    className="task-fan__button"
                    id={`task-fan-trigger-${task.id}`}
                    onClick={(event) =>
                      onSelect(task.id, event.currentTarget.id)
                    }
                    type="button"
                  >
                    <span className="task-fan__surface">
                      <small>
                        <span>{task.priority}</span> · {task.code}
                      </small>
                      <strong>{task.title}</strong>
                      <span className="task-fan__status">
                        {statusLabels[task.status]}
                      </span>
                      <span>截止 {task.dueDate}</span>
                      <span>进度 {task.progress}%</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </GlassPanel>
  )
}
