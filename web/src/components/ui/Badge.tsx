import type { HTMLAttributes } from 'react'

type BadgeTone = 'neutral' | 'primary' | 'warning' | 'critical'

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone
}

export function Badge({
  className = '',
  tone = 'neutral',
  ...props
}: BadgeProps) {
  const classes = ['badge', `badge--${tone}`, className]
    .filter(Boolean)
    .join(' ')

  return <span className={classes} {...props} />
}
