import { GlassPanel } from '../../components/ui/GlassPanel'
import type { Task } from '../../data/domain'
import { useProjectRepository } from '../../data/query-hooks'
import { TaskProgressForm } from './TaskInspector'

const statusLabels: Record<Task['status'], string> = {
  not_started: '未开始',
  in_progress: '进行中',
  done: '已完成',
  overdue: '已延期',
}

export interface TaskContextPanelProps {
  dataSlot?: string
  task: Task | null
}

export function TaskContextPanel({
  dataSlot,
  task,
}: TaskContextPanelProps) {
  const { projectId } = useProjectRepository()

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
          {task ? statusLabels[task.status] : '无选择'}
        </span>
      </header>
      {task ? (
        <div className="task-context__body">
          <dl className="task-context__details">
            <div><dt>编号</dt><dd>{task.code}</dd></div>
            <div><dt>负责人</dt><dd>{task.assignee.name}</dd></div>
            <div><dt>所属项目</dt><dd>{task.projectId ?? projectId}</dd></div>
            <div><dt>优先级</dt><dd>{task.priority}</dd></div>
            <div><dt>截止日期</dt><dd>{task.dueDate}</dd></div>
            <div>
              <dt>依赖</dt>
              <dd>{task.dependencyIds.join('、') || '无'}</dd>
            </div>
          </dl>
          <p className="task-context__description">{task.description}</p>
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
