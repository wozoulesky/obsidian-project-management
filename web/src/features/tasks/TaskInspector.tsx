import { useEffect, useRef, useState, type FormEvent } from 'react'

import { EntityInspector } from '../../components/data/EntityInspector'
import { Button } from '../../components/ui/Button'
import type { Task, TaskStatus } from '../../data/domain'
import { useUpdateTaskProgress } from '../../data/query-hooks'
import { taskStatusLabels } from './task-workspace-model'

export interface TaskInspectorProps {
  fallbackFocusId?: string
  onClose: () => void
  returnFocusId?: string
  task: Task
}

export function TaskProgressForm({ task }: { task: Task }) {
  const updateProgress = useUpdateTaskProgress()
  const [progress, setProgress] = useState(String(task.progress))
  const [status, setStatus] = useState<TaskStatus>(task.status)
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState('')
  const taskIdRef = useRef(task.id)
  const progressDirtyRef = useRef(false)
  const statusDirtyRef = useRef(false)

  useEffect(() => {
    if (taskIdRef.current !== task.id) {
      taskIdRef.current = task.id
      progressDirtyRef.current = false
      statusDirtyRef.current = false
      setProgress(String(task.progress))
      setStatus(task.status)
      setNote('')
      setFormError('')
      return
    }

    if (!progressDirtyRef.current) {
      setProgress(String(task.progress))
    }
    if (!statusDirtyRef.current) {
      setStatus(task.status)
    }
  }, [task.id, task.progress, task.status])

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
        onSuccess: (updatedTask) => {
          progressDirtyRef.current = false
          statusDirtyRef.current = false
          setProgress(String(updatedTask.progress))
          setStatus(updatedTask.status)
        },
        onError: (error) => {
          setFormError(
            error instanceof Error ? error.message : '保存失败，请稍后重试。',
          )
        },
      },
    )
  }

  return (
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
          onChange={(event) => {
            progressDirtyRef.current = true
            setProgress(event.target.value)
          }}
          step="1"
          type="number"
          value={progress}
        />
      </label>
      <label>
        状态
        <select
          onChange={(event) => {
            statusDirtyRef.current = true
            setStatus(event.target.value as TaskStatus)
          }}
          value={status}
        >
          {Object.entries(taskStatusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        进度备注
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
  )
}

export function TaskInspector({
  fallbackFocusId,
  onClose,
  returnFocusId,
  task,
}: TaskInspectorProps) {
  return (
    <EntityInspector
      fallbackFocusId={fallbackFocusId}
      onClose={onClose}
      returnFocusId={returnFocusId ?? `task-trigger-${task.id}`}
      title={task.title}
    >
      <div className="task-inspector">
        <dl className="task-inspector__details">
          <div><dt>编号</dt><dd>{task.code}</dd></div>
          <div><dt>负责人</dt><dd>{task.assignee.name}</dd></div>
          <div><dt>开始日期</dt><dd>{task.startDate}</dd></div>
          <div><dt>截止日期</dt><dd>{task.dueDate}</dd></div>
          <div><dt>优先级</dt><dd>{task.priority}</dd></div>
          <div><dt>依赖</dt><dd>{task.dependencyIds.join('、') || '无'}</dd></div>
        </dl>
        <p className="task-inspector__description">{task.description}</p>
        <TaskProgressForm task={task} />
      </div>
    </EntityInspector>
  )
}
