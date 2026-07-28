import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from 'react'

export interface EntityInspectorProps {
  children: ReactNode
  fallbackFocusId?: string
  onClose: () => void
  returnFocusId?: string
  title: string
}

export function EntityInspector({
  children,
  fallbackFocusId,
  onClose,
  returnFocusId,
  title,
}: EntityInspectorProps) {
  const titleId = useId()
  const inspectorRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  const fallbackFocusIdRef = useRef(fallbackFocusId)
  const returnFocusIdRef = useRef(returnFocusId)
  const restoreTargetRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    onCloseRef.current = onClose
    fallbackFocusIdRef.current = fallbackFocusId
    returnFocusIdRef.current = returnFocusId
  }, [fallbackFocusId, onClose, returnFocusId])

  useEffect(() => {
    const initialTrigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    if (initialTrigger && initialTrigger !== document.body) {
      restoreTargetRef.current = initialTrigger
    }
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
      const idTarget = returnFocusIdRef.current
        ? document.getElementById(returnFocusIdRef.current)
        : null
      const capturedTarget = restoreTargetRef.current
      const fallbackTarget = fallbackFocusIdRef.current
        ? document.getElementById(fallbackFocusIdRef.current)
        : null
      const restoreTarget =
        idTarget instanceof HTMLElement && idTarget.isConnected
          ? idTarget
          : capturedTarget?.isConnected
            ? capturedTarget
            : fallbackTarget instanceof HTMLElement &&
                fallbackTarget.isConnected
              ? fallbackTarget
              : null
      if (restoreTarget) {
        restoreTarget.focus()
      }
    }
  }, [])

  useEffect(() => {
    const activeElement =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    if (
      activeElement &&
      activeElement !== document.body &&
      !inspectorRef.current?.contains(activeElement)
    ) {
      restoreTargetRef.current = activeElement
      closeButtonRef.current?.focus()
    }
  }, [title])

  return (
    <aside
      aria-labelledby={titleId}
      className="entity-inspector inspector"
      ref={inspectorRef}
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
