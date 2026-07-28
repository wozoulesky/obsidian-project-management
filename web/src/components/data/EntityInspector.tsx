import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from 'react'

export interface EntityInspectorProps {
  children: ReactNode
  onClose: () => void
  returnFocusId?: string
  title: string
}

export function EntityInspector({
  children,
  onClose,
  returnFocusId,
  title,
}: EntityInspectorProps) {
  const titleId = useId()
  const inspectorRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  const returnFocusIdRef = useRef(returnFocusId)
  const restoreTargetRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    onCloseRef.current = onClose
    returnFocusIdRef.current = returnFocusId
  }, [onClose, returnFocusId])

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
    const handleFocusIn = (event: FocusEvent) => {
      const target =
        event.target instanceof HTMLElement ? event.target : null
      if (
        target &&
        target !== document.body &&
        !inspectorRef.current?.contains(target)
      ) {
        restoreTargetRef.current = target
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('focusin', handleFocusIn)
    closeButtonRef.current?.focus()

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('focusin', handleFocusIn)
      const idTarget = returnFocusIdRef.current
        ? document.getElementById(returnFocusIdRef.current)
        : null
      const restoreTarget =
        idTarget instanceof HTMLElement
          ? idTarget
          : restoreTargetRef.current
      if (restoreTarget?.isConnected) {
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
