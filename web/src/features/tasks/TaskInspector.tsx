import { useState, type FormEvent } from 'react'

import { EntityInspector } from '../../components/data/EntityInspector'
import { Button } from '../../components/ui/Button'
import type { Task, TaskStatus } from '../../data/domain'
import { useUpdateTaskProgress } from '../../data/query-hooks'

const statusLabels: Record<TaskStatus, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  done: '已完成',
  overdue: '已延期',
}

export interface TaskInspectorProps {
  fallbackFocusId?: string
  onClose: () => void
  task: Task
}

function TaskInspectorFields({ task }: { task: Task }) {
  const updateProgress = useUpdateTaskProgress()
  const [progress, setProgress] = useState(String(task.progress))
  const [status, setStatus] = useState<TaskStatus>(task.status)
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState('')

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const numericProgress = Number(progress)
    if (
      progress.trim() === '' ||
      !Number.isInteger(numericProgress) ||
      numericProgress < 0 ||
      numericProgress > 100
    ) {
      setFormError('进度必须是 0 到 100 的整数。')
      return
    }

    setFormError('')
    updateProgress.mutate(
      {
        taskId: task.id,
        input: { progress: numericProgress, status, note },
      },
      {
        onError: (error) => {
          setFormError(
            error instanceof Error ? error.message : '保存失败，请稍后重试。',
          )
        },
      },
    )
  }

  return (
    <div className="task-inspector">
      <dl className="task-inspector__details">
        <div>
          <dt>编号</dt>
          <dd>{task.code}</dd>
        </div>
        <div>
          <dt>负责人</dt>
          <dd>{task.assignee.name}</dd>
        </div>
        <div>
          <dt>开始日期</dt>
          <dd>{task.startDate}</dd>
        </div>
        <div>
          <dt>截止日期</dt>
          <dd>{task.dueDate}</dd>
        </div>
        <div>
          <dt>优先级</dt>
          <dd>{task.priority}</dd>
        </div>
        <div>
          <dt>依赖</dt>
          <dd>{task.dependencyIds.join('、') || '无'}</dd>
        </div>
      </dl>
      <p className="task-inspector__description">{task.description}</p>
      <form
        className="task-inspector__form"
        noValidate
        onSubmit={handleSubmit}
      >
        <label>
          任务进度
          <input
            inputMode="numeric"
            max="100"
            min="0"
            onChange={(event) => setProgress(event.target.value)}
            step="1"
            type="number"
            value={progress}
          />
        </label>
        <label>
          状态
          <select
            onChange={(event) =>
              setStatus(event.target.value as TaskStatus)
            }
            value={status}
          >
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          备注
          <textarea
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            value={note}
          />
        </label>
        {formError ? <p role="alert">{formError}</p> : null}
        <Button
          aria-label="提交进度"
          disabled={updateProgress.isPending}
          type="submit"
          variant="primary"
        >
          {updateProgress.isPending ? '正在提交…' : '提交进度'}
        </Button>
      </form>
    </div>
  )
}

export function TaskInspector({
  fallbackFocusId,
  onClose,
  task,
}: TaskInspectorProps) {
  return (
    <EntityInspector
      fallbackFocusId={fallbackFocusId}
      onClose={onClose}
      returnFocusId={`task-trigger-${task.id}`}
      title={task.title}
    >
      <TaskInspectorFields key={task.id} task={task} />
    </EntityInspector>
  )
}
