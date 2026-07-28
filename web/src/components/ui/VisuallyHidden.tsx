import type { HTMLAttributes } from 'react'

export type VisuallyHiddenProps = HTMLAttributes<HTMLSpanElement>

export function VisuallyHidden({
  className = '',
  ...props
}: VisuallyHiddenProps) {
  const classes = ['visually-hidden', className].filter(Boolean).join(' ')

  return <span className={classes} {...props} />
}
