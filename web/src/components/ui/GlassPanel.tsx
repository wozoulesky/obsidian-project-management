import type { HTMLAttributes, ReactNode } from 'react'

type GlassPanelElement = 'div' | 'section'

export type GlassPanelProps = Omit<
  HTMLAttributes<HTMLElement>,
  'aria-label' | 'children'
> & {
  ariaLabel: string
  as?: GlassPanelElement
  children: ReactNode
}

export function GlassPanel({
  ariaLabel,
  as: Element = 'div',
  children,
  className = '',
  ...props
}: GlassPanelProps) {
  return (
    <Element
      aria-label={ariaLabel}
      className={['glass-panel', className].filter(Boolean).join(' ')}
      {...props}
    >
      {children}
    </Element>
  )
}
