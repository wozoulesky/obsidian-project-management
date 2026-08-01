import type { CSSProperties } from 'react'

import { GlassPanel } from '../../components/ui/GlassPanel'
import type { Task } from '../../data/domain'

const statusLabels: Record<Task['status'], string> = {
  not_started: '待开始',
  in_progress: '进行中',
  done: '已完成',
  overdue: '逾期',
}

export interface DeliveryTimelineProps {
  selectedTaskId: string | null
  tasks: readonly Task[]
}

export function DeliveryTimeline({
  selectedTaskId,
  tasks,
}: DeliveryTimelineProps) {
  const listStyle = {
    '--delivery-count': Math.max(tasks.length, 1),
  } as CSSProperties

  return (
    <GlassPanel ariaLabel="交付时间线" className="delivery-timeline">
      <header className="delivery-timeline__header">
        <div>
          <p>DELIVERY DATES</p>
          <h2>交付时间线</h2>
        </div>
        <span>{tasks.length} 个节点</span>
      </header>
      {tasks.length === 0 ? (
        <p className="delivery-timeline__empty" role="status">
          当前筛选范围暂无交付节点
        </p>
      ) : (
        <div className="delivery-timeline__scroll" tabIndex={0}>
          <ol className="delivery-timeline__list" style={listStyle}>
            {tasks.map((task) => (
              <li
                aria-current={task.id === selectedTaskId || undefined}
                className="delivery-timeline__item"
                data-status={task.status}
                key={task.id}
              >
                <span className="delivery-timeline__bar" aria-hidden="true" />
                <strong>{task.title}</strong>
                <span>{statusLabels[task.status]}</span>
                <span className="delivery-timeline__dates">
                  <time dateTime={task.startDate}>{task.startDate}</time>
                  <span aria-hidden="true">→</span>
                  <time dateTime={task.dueDate}>{task.dueDate}</time>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </GlassPanel>
  )
}
