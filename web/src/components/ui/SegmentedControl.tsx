export type SegmentedControlOption = {
  disabled?: boolean
  label: string
  value: string
}

export type SegmentedControlProps = {
  ariaLabel: string
  className?: string
  onChange: (value: string) => void
  options: readonly SegmentedControlOption[]
  value: string
}

export function SegmentedControl({
  ariaLabel,
  className = '',
  onChange,
  options,
  value,
}: SegmentedControlProps) {
  return (
    <div
      aria-label={ariaLabel}
      className={['segmented-control', className].filter(Boolean).join(' ')}
      role="group"
    >
      {options.map((option) => (
        <button
          aria-pressed={option.value === value}
          className="segmented-control__option"
          disabled={option.disabled}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
