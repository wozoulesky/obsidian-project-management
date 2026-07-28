import { init, type EChartsOption, type EChartsType } from 'echarts'
import { useEffect, useRef } from 'react'

export type EChartProps = {
  ariaLabel: string
  className?: string
  option: EChartsOption
}

export function EChart({
  ariaLabel,
  className = '',
  option,
}: EChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<EChartsType | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const chart = init(container)
    const resizeObserver = new ResizeObserver(() => chart.resize())
    chartRef.current = chart
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true })
  }, [option])

  return (
    <div
      aria-label={ariaLabel}
      className={`echart ${className}`.trim()}
      ref={containerRef}
      role="img"
    />
  )
}
