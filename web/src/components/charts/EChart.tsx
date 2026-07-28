import { LineChart, PieChart } from 'echarts/charts'
import {
  DatasetComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components'
import {
  init,
  use as registerEChartsModules,
  type EChartsCoreOption,
  type EChartsType,
} from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useRef, useState } from 'react'

registerEChartsModules([
  LineChart,
  PieChart,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  CanvasRenderer,
])

export type EChartProps = {
  ariaLabel: string
  className?: string
  option: EChartsCoreOption
}

export function EChart({
  ariaLabel,
  className = '',
  option,
}: EChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<EChartsType | null>(null)
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

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
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updatePreference = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches)
    }
    media.addEventListener('change', updatePreference)
    return () => media.removeEventListener('change', updatePreference)
  }, [])

  useEffect(() => {
    const resolvedOption = prefersReducedMotion
      ? ({
          ...option,
          animation: false,
          animationDuration: 0,
          animationDurationUpdate: 0,
        } as EChartsCoreOption)
      : option
    chartRef.current?.setOption(resolvedOption, { notMerge: true })
  }, [option, prefersReducedMotion])

  return (
    <div
      aria-label={ariaLabel}
      className={`echart ${className}`.trim()}
      ref={containerRef}
      role="img"
    />
  )
}
