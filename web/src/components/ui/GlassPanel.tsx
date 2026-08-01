import type { HTMLAttributes, ReactNode } from 'react'

type GlassPanelBaseProps = Omit<
  HTMLAttributes<HTMLElement>,
  'aria-label' | 'children'
> & {
  children: ReactNode
}

type SemanticGlassPanelProps = GlassPanelBaseProps & {
  ariaLabel: string
  as?: 'section'
}

type DecorativeGlassPanelProps = GlassPanelBaseProps & {
  ariaLabel?: never
  as: 'div'
}

export type GlassPanelProps =
  | SemanticGlassPanelProps
  | DecorativeGlassPanelProps

export function GlassPanel({
  ariaLabel,
  as: requestedElement = 'section',
  children,
  className = '',
  ...props
}: GlassPanelProps) {
  const Element = requestedElement

  return (
    <Element
      aria-label={Element === 'section' ? ariaLabel : undefined}
      className={['glass-panel', className].filter(Boolean).join(' ')}
      {...props}
    >
      {children}
    </Element>
  )
}
