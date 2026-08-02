import { GlassPanel } from '../../components/ui/GlassPanel'
import type { Task } from '../../data/domain'
import { TaskProgressForm } from './TaskInspector'
import { taskInsights, taskStatusLabels } from './task-workspace-model'

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
              <dd>
                {task.dependencyIds.length} 项
                {task.dependencyIds.length > 0
                  ? `（${task.dependencyIds.join('、')}）`
                  : null}
              </dd>
            </div>
            <div>
              <dt>标签</dt>
              <dd>{task.milestoneId.trim() || '暂无标签'}</dd>
            </div>
          </dl>
          <p className="task-context__description">{task.description}</p>
          <section
            aria-labelledby={`task-context-insights-${task.id}`}
            className="task-context__insights"
          >
            <h3 id={`task-context-insights-${task.id}`}>任务建议</h3>
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
