import { useId, useState } from 'react'

import { GlassPanel } from '../../components/ui/GlassPanel'
import type { Task } from '../../data/domain'
import { TaskProgressForm } from './TaskInspector'
import { taskInsights, taskStatusLabels } from './task-workspace-model'

const DEPENDENCY_PREVIEW_LIMIT = 5

function TaskDependencies({
  dependencyIds,
}: {
  dependencyIds: readonly string[]
}) {
  const dependencyListId = useId()
  const [expanded, setExpanded] = useState(false)
  const visibleDependencyIds = expanded
    ? dependencyIds
    : dependencyIds.slice(0, DEPENDENCY_PREVIEW_LIMIT)
  const hiddenDependencyCount = dependencyIds.length - visibleDependencyIds.length

  return (
    <dd>
      {dependencyIds.length} 项
      {visibleDependencyIds.length > 0 ? (
        <ul
          aria-label="依赖任务"
          className="task-context__dependencies"
          id={dependencyListId}
        >
          {visibleDependencyIds.map((dependencyId, index) => (
            <li key={`${dependencyId}-${index}`}>{dependencyId}</li>
          ))}
        </ul>
      ) : null}
      {hiddenDependencyCount > 0 ? (
        <span>另 {hiddenDependencyCount} 项</span>
      ) : null}
      {dependencyIds.length > DEPENDENCY_PREVIEW_LIMIT ? (
        <button
          aria-controls={dependencyListId}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          {expanded ? '收起依赖' : '展开全部依赖'}
        </button>
      ) : null}
    </dd>
  )
}

export interface TaskContextPanelProps {
  dataSlot?: string
  projectName: string
  task: Task | null
  today: string
}

export function TaskContextPanel({
  dataSlot,
  projectName,
  task,
  today,
}: TaskContextPanelProps) {
  const insights = task ? taskInsights(task, today) : []
  const insightsHeadingId = useId()

  return (
    <GlassPanel
      ariaLabel="智能任务上下文"
      className="task-context"
      data-slot={dataSlot}
    >
      <header className="task-context__header">
        <div>
          <p>SMART CONTEXT</p>
          <h2>{task?.title ?? '智能任务上下文'}</h2>
        </div>
        <span data-status={task?.status ?? 'empty'}>
          {task ? taskStatusLabels[task.status] : '无选择'}
        </span>
      </header>
      {task ? (
        <div className="task-context__scroll">
          <dl className="task-context__details">
            <div><dt>编号</dt><dd>{task.code}</dd></div>
            <div><dt>负责人</dt><dd>{task.assignee?.name || '未分配'}</dd></div>
            <div><dt>所属项目</dt><dd>{projectName}</dd></div>
            <div><dt>优先级</dt><dd>{task.priority}</dd></div>
            <div><dt>状态</dt><dd>{taskStatusLabels[task.status]}</dd></div>
            <div><dt>开始日期</dt><dd>{task.startDate}</dd></div>
            <div><dt>截止日期</dt><dd>{task.dueDate}</dd></div>
            <div><dt>当前进度</dt><dd>{task.progress}%</dd></div>
            <div>
              <dt>依赖</dt>
              <TaskDependencies
                dependencyIds={task.dependencyIds}
                key={task.id}
              />
            </div>
            <div>
              <dt>标签</dt>
              <dd>{task.milestoneId.trim() || '暂无标签'}</dd>
            </div>
          </dl>
          <p className="task-context__description">{task.description}</p>
          <section
            aria-labelledby={insightsHeadingId}
            className="task-context__insights"
          >
            <h3 id={insightsHeadingId}>任务建议</h3>
            {insights.length > 0 ? (
              <ul>
                {insights.map((insight) => (
                  <li key={insight}>{insight}</li>
                ))}
              </ul>
            ) : (
              <p>暂无任务建议</p>
            )}
          </section>
          <TaskProgressForm key={task.id} task={task} />
        </div>
      ) : (
        <p className="task-context__empty" role="status">
          当前筛选范围暂无任务上下文
        </p>
      )}
    </GlassPanel>
  )
}
