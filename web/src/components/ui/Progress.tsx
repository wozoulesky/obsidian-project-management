import type { HTMLAttributes } from 'react'

export type ProgressProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  value: number
}

export function Progress({ className = '', value, ...props }: ProgressProps) {
  const normalizedValue = Number.isFinite(value)
    ? Math.min(100, Math.max(0, value))
    : 0
  const classes = ['progress', className].filter(Boolean).join(' ')

  return (
    <div
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={normalizedValue}
      className={classes}
      role="progressbar"
      {...props}
    >
      <span
        className="progress__value"
        style={{ width: `${normalizedValue}%` }}
      />
    </div>
  )
}
