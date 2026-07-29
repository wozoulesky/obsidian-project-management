import { taskProgressInputSchema } from '@project-os/contracts'
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'

import { Button } from '../../components/ui/Button'
import type { Task, TaskStatus } from '../../data/domain'
import {
  useActors,
  useAllTasks,
  useUpdateTaskProgress,
} from '../../data/query-hooks'

const statusLabels: Record<TaskStatus, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  done: '已完成',
  overdue: '已延期',
}

type FieldName = 'actorId' | 'taskId' | 'progress' | 'status' | 'note'

export function QuickSubmitDialog({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess: (progress: number) => void
}) {
  const actorsQuery = useActors()
  const tasksQuery = useAllTasks()
  const updateProgress = useUpdateTaskProgress()
  const dialogRef = useRef<HTMLDivElement>(null)
  const actorRef = useRef<HTMLSelectElement>(null)
  const taskRef = useRef<HTMLSelectElement>(null)
  const progressRef = useRef<HTMLInputElement>(null)
  const statusRef = useRef<HTMLSelectElement>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const submitErrorRef = useRef<HTMLParagraphElement>(null)
  const submissionRef = useRef(false)
  const [actorId, setActorId] = useState('')
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [progress, setProgress] = useState('')
  const [status, setStatus] = useState<TaskStatus>('not_started')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Partial<Record<FieldName | 'submit', string>>>({})

  const activeActors = (actorsQuery.data ?? []).filter(
    (actor) => actor.status === 'active',
  )
  const tasks = (tasksQuery.data ?? []).filter(
    (task) => (task.assigneeId ?? task.assignee.id) === actorId,
  )
  useEffect(() => {
    if (
      !actorsQuery.isPending
      && !dialogRef.current?.contains(document.activeElement)
    ) {
      actorRef.current?.focus()
    }
  }, [actorsQuery.isPending])
  useEffect(() => {
    if (errors.submit) submitErrorRef.current?.focus()
  }, [errors.submit])

  const clearError = (field: FieldName) => {
    setErrors((current) => {
      const next = { ...current }
      delete next[field]
      delete next.submit
      return next
    })
  }

  const selectActor = (nextActorId: string) => {
    setActorId(nextActorId)
    setSelectedTask(null)
    setProgress('')
    setStatus('not_started')
    setNote('')
    setErrors({})
  }

  const selectTask = (nextTaskId: string) => {
    const task = tasks.find((candidate) => candidate.id === nextTaskId)
    setSelectedTask(task ?? null)
    setProgress(task ? String(task.progress) : '')
    setStatus(task?.status ?? 'not_started')
    setNote('')
    setErrors({})
  }

  const focusFirstInvalidField = (field: FieldName) => {
    const refs = {
      actorId: actorRef,
      taskId: taskRef,
      progress: progressRef,
      status: statusRef,
      note: noteRef,
    }
    refs[field].current?.focus()
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submissionRef.current) return

    const nextErrors: Partial<Record<FieldName | 'submit', string>> = {}
    const numericProgress = Number(progress)
    if (!activeActors.some((actor) => actor.id === actorId)) {
      nextErrors.actorId = '请选择有效的负责人。'
    }
    if (!selectedTask) {
      nextErrors.taskId = '请选择该负责人名下的任务。'
    }
    if (
      progress.trim() === ''
      || !Number.isInteger(numericProgress)
      || numericProgress < 0
      || numericProgress > 100
    ) {
      nextErrors.progress = '进度必须是 0 到 100 的整数。'
    }
    if (!(status in statusLabels)) {
      nextErrors.status = '请选择有效的任务状态。'
    }

    const parsed = taskProgressInputSchema.safeParse({
      progress: numericProgress,
      status,
      note,
      version: selectedTask?.version,
    })
    if (!parsed.success && !nextErrors.progress && !nextErrors.status) {
      const firstIssue = parsed.error.issues[0]
      if (firstIssue?.path[0] === 'note') {
        nextErrors.note = firstIssue.message
      }
    }
    if (
      selectedTask
      && (
        !selectedTask.projectId
        || !Number.isInteger(selectedTask.version)
        || (selectedTask.version ?? 0) < 1
      )
    ) {
      nextErrors.taskId = '任务数据已过期，请刷新后重试。'
    }

    const firstInvalid = (
      ['actorId', 'taskId', 'progress', 'status', 'note'] as const
    ).find((field) => nextErrors[field])
    if (firstInvalid) {
      setErrors(nextErrors)
      focusFirstInvalidField(firstInvalid)
      return
    }
    if (!selectedTask?.projectId || selectedTask.version === undefined) return

    submissionRef.current = true
    setErrors({})
    try {
      await updateProgress.mutateAsync({
        taskId: selectedTask.id,
        projectId: selectedTask.projectId,
        input: {
          progress: numericProgress,
          status,
          note,
          version: selectedTask.version,
        },
      })
      onSuccess(numericProgress)
    } catch (error) {
      setErrors({
        submit:
          error instanceof Error ? error.message : '提交失败，请稍后重试。',
      })
    } finally {
      submissionRef.current = false
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (!updateProgress.isPending) onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      ) ?? [],
    )
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const queryError = actorsQuery.error ?? tasksQuery.error

  return (
    <div
      aria-labelledby="quick-submit-title"
      aria-modal="true"
      className="project-dialog quick-submit-dialog"
      onKeyDown={handleKeyDown}
      ref={dialogRef}
      role="dialog"
    >
      <form
        className="project-dialog__panel quick-submit-dialog__panel"
        noValidate
        onSubmit={submit}
      >
        <header>
          <h2 id="quick-submit-title">快速提交</h2>
          <Button
            aria-label="关闭快速提交"
            disabled={updateProgress.isPending}
            onClick={onClose}
            variant="ghost"
          >
            关闭
          </Button>
        </header>

        {queryError ? (
          <p role="alert">
            {queryError instanceof Error
              ? queryError.message
              : '负责人或任务加载失败。'}
          </p>
        ) : null}

        <label>
          负责人
          <select
            aria-label="负责人"
            aria-invalid={Boolean(errors.actorId)}
            autoFocus
            disabled={actorsQuery.isPending || updateProgress.isPending}
            onChange={(event) => selectActor(event.target.value)}
            ref={actorRef}
            value={actorId}
          >
            <option value="">
              {actorsQuery.isPending ? '正在加载…' : '请选择'}
            </option>
            {activeActors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.name}
              </option>
            ))}
          </select>
          {errors.actorId ? (
            <span className="project-dialog__field-error">
              {errors.actorId}
            </span>
          ) : null}
        </label>

        <label>
          任务
          <select
            aria-label="任务"
            aria-invalid={Boolean(errors.taskId)}
            disabled={
              !actorId || tasksQuery.isPending || updateProgress.isPending
            }
            onChange={(event) => selectTask(event.target.value)}
            ref={taskRef}
            value={selectedTask?.id ?? ''}
          >
            <option value="">
              {tasksQuery.isPending ? '正在加载…' : '请选择'}
            </option>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </select>
          {errors.taskId ? (
            <span className="project-dialog__field-error">{errors.taskId}</span>
          ) : null}
        </label>

        <label>
          进度
          <input
            aria-label="进度"
            aria-invalid={Boolean(errors.progress)}
            disabled={!selectedTask || updateProgress.isPending}
            inputMode="numeric"
            max="100"
            min="0"
            onChange={(event) => {
              setProgress(event.target.value)
              clearError('progress')
            }}
            ref={progressRef}
            step="1"
            type="number"
            value={progress}
          />
          {errors.progress ? (
            <span className="project-dialog__field-error">
              {errors.progress}
            </span>
          ) : null}
        </label>

        <label>
          状态
          <select
            aria-label="状态"
            aria-invalid={Boolean(errors.status)}
            disabled={!selectedTask || updateProgress.isPending}
            onChange={(event) => {
              setStatus(event.target.value as TaskStatus)
              clearError('status')
            }}
            ref={statusRef}
            value={status}
          >
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {errors.status ? (
            <span className="project-dialog__field-error">{errors.status}</span>
          ) : null}
        </label>

        <label>
          进度备注
          <textarea
            aria-label="进度备注"
            disabled={!selectedTask || updateProgress.isPending}
            onChange={(event) => {
              setNote(event.target.value)
              clearError('note')
            }}
            ref={noteRef}
            rows={3}
            value={note}
          />
          {errors.note ? (
            <span className="project-dialog__field-error">{errors.note}</span>
          ) : null}
        </label>

        {errors.submit ? (
          <p ref={submitErrorRef} role="alert" tabIndex={-1}>
            {errors.submit}
          </p>
        ) : null}

        <footer>
          <Button
            disabled={updateProgress.isPending}
            onClick={onClose}
          >
            取消
          </Button>
          <Button
            disabled={!selectedTask || updateProgress.isPending}
            type="submit"
            variant="primary"
          >
            {updateProgress.isPending ? '正在提交…' : '提交进度'}
          </Button>
        </footer>
      </form>
    </div>
  )
}
