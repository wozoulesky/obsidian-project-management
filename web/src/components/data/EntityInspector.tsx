import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from 'react'

export interface EntityInspectorProps {
  children: ReactNode
  onClose: () => void
  title: string
}

export function EntityInspector({
  children,
  onClose,
  title,
}: EntityInspectorProps) {
  const titleId = useId()
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    closeButtonRef.current?.focus()

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      trigger?.focus()
    }
  }, [])

  return (
    <aside
      aria-labelledby={titleId}
      className="entity-inspector inspector"
      role="dialog"
    >
      <header className="entity-inspector__header">
        <h2 id={titleId}>{title}</h2>
        <button
          aria-label={`关闭 ${title}`}
          className="button button--ghost"
          onClick={onClose}
          ref={closeButtonRef}
          type="button"
        >
          关闭
        </button>
      </header>
      <div className="entity-inspector__body">{children}</div>
    </aside>
  )
}
