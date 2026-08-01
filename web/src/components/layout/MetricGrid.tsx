import type { ReactNode } from 'react'

export type MetricGridProps = {
  ariaLabel: string
  children: ReactNode
  className?: string
}

export function MetricGrid({
  ariaLabel,
  children,
  className = '',
}: MetricGridProps) {
  return (
    <div
      aria-label={ariaLabel}
      className={['metric-grid', className].filter(Boolean).join(' ')}
      role="group"
    >
      {children}
    </div>
  )
}
