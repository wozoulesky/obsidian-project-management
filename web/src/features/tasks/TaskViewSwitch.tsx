import { useSearchParams } from 'react-router-dom'

import { SegmentedControl } from '../../components/ui/SegmentedControl'
import type { TaskView } from './task-workspace-model'

const options = [
  { label: '扇面', value: 'fan' },
  { label: '看板', value: 'board' },
  { label: '时间线', value: 'timeline' },
] as const

export function TaskViewSwitch({ value }: { value: TaskView }) {
  const [searchParams, setSearchParams] = useSearchParams()

  return (
    <SegmentedControl
      ariaLabel="任务视图"
      onChange={(nextValue) => {
        const next = new URLSearchParams(searchParams)
        if (nextValue === 'fan') {
          next.delete('view')
        } else {
          next.set('view', nextValue)
        }
        setSearchParams(next)
      }}
      options={options}
      value={value}
    />
  )
}
