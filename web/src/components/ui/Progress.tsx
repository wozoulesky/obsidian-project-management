export type ProgressProps = {
  value: number
  label: string
}

export function Progress({ label, value }: ProgressProps) {
  const normalizedValue = Number.isFinite(value)
    ? Math.min(100, Math.max(0, value))
    : 0

  return (
    <div
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={normalizedValue}
      className="progress"
      role="progressbar"
    >
      <span style={{ width: `${normalizedValue}%` }} />
    </div>
  )
}
