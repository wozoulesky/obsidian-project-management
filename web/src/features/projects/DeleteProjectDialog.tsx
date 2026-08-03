import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'

import { Button } from '../../components/ui/Button'
import { ApiError } from '../../data/api-client'
import type { Project } from '../../data/domain'
import { useDeleteProject } from '../../data/query-hooks'

const apiErrorMessages: Record<string, string> = {
  PROJECT_VERSION_CONFLICT: '项目已被修改，请刷新后重新确认。',
  DEFAULT_PROJECT_PROTECTED: '默认项目受保护，无法删除。',
  PROJECT_DELETE_FORBIDDEN: '你没有删除此项目的权限。',
}

function deletionErrorMessage(error: unknown) {
  if (error instanceof ApiError && apiErrorMessages[error.code]) {
    return apiErrorMessages[error.code]
  }
  if (error instanceof Error && error.message.trim()) {
    return `删除失败：${error.message.trim()}，请稍后重试。`
  }
  return '项目删除失败，请检查网络后重试。'
}

export function DeleteProjectDialog({
  project,
  onClose,
  onDeleted,
}: {
  project: Project
  onClose: () => void
  onDeleted: () => void
}) {
  const deleteProject = useDeleteProject()
  const dialogRef = useRef<HTMLDivElement>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const submissionRef = useRef(false)
  const [confirmation, setConfirmation] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (errorMessage) errorRef.current?.focus()
  }, [errorMessage])

  useEffect(() => {
    if (deleteProject.isPending) dialogRef.current?.focus()
  }, [deleteProject.isPending])

  const close = () => {
    if (submissionRef.current || deleteProject.isPending) return
    onClose()
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (
      confirmation !== project.name
      || submissionRef.current
      || deleteProject.isPending
    ) return
    submissionRef.current = true
    setErrorMessage(null)
    try {
      await deleteProject.mutateAsync({
        projectId: project.id,
        version: project.version,
      })
      onDeleted()
    } catch (error) {
      setErrorMessage(deletionErrorMessage(error))
    } finally {
      submissionRef.current = false
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled])',
      ) ?? [],
    )
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first || !last) {
      event.preventDefault()
      dialogRef.current?.focus()
      return
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      aria-describedby="delete-project-description"
      aria-labelledby="delete-project-title"
      aria-modal="true"
      className="project-dialog project-delete-dialog"
      onKeyDown={handleKeyDown}
      ref={dialogRef}
      role="dialog"
      tabIndex={-1}
    >
      <form
        aria-busy={deleteProject.isPending}
        className="project-dialog__panel project-delete-dialog__panel"
        onSubmit={submit}
      >
        <header>
          <h2 id="delete-project-title">永久删除项目 {project.name}</h2>
          <Button
            aria-label="关闭永久删除项目"
            disabled={deleteProject.isPending}
            onClick={close}
            variant="ghost"
          >
            关闭
          </Button>
        </header>
        <p id="delete-project-description">
          此操作永久不可恢复，并将级联删除项目任务、成员关系、交接记录和交付物；
          关联的需求、缺陷和会话也会一并删除。
        </p>
        <label>
          输入 {project.name} 以确认
          <input
            autoFocus
            disabled={deleteProject.isPending}
            onChange={(event) => {
              setConfirmation(event.target.value)
              setErrorMessage(null)
            }}
            value={confirmation}
          />
        </label>
        {errorMessage ? (
          <p ref={errorRef} role="alert" tabIndex={-1}>{errorMessage}</p>
        ) : null}
        <footer>
          <Button disabled={deleteProject.isPending} onClick={close}>取消</Button>
          <Button
            className="project-delete-dialog__submit"
            disabled={confirmation !== project.name || deleteProject.isPending}
            type="submit"
          >
            {deleteProject.isPending ? '正在永久删除…' : '永久删除项目'}
          </Button>
        </footer>
      </form>
    </div>
  )
}
