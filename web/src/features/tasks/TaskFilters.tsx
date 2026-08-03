import { useSearchParams } from 'react-router-dom'

import type { Priority, Task, TaskStatus } from '../../data/domain'

const taskStatuses = [
  'not_started',
  'in_progress',
  'done',
  'overdue',
] as const satisfies readonly TaskStatus[]
const priorities = ['P0', 'P1', 'P2', 'P3'] as const satisfies readonly Priority[]
const sorts = ['due_asc', 'due_desc'] as const

type TaskSort = (typeof sorts)[number]

function includesValue<T extends string>(
  values: readonly T[],
  value: string | null,
): value is T {
  return value !== null && values.some((candidate) => candidate === value)
}

// Filtering is exported beside the control so URL behavior has one canonical path.
// eslint-disable-next-line react-refresh/only-export-components
export function filterTasks(
  tasks: readonly Task[],
  searchParams: URLSearchParams,
): Task[] {
  const statusValue = searchParams.get('status')
  const priorityValue = searchParams.get('priority')
  const assigneeValue = searchParams.get('assignee')
  const sortValue = searchParams.get('sort')
  const query = (searchParams.get('q') ?? '').trim().toLocaleLowerCase()
  const status = includesValue(taskStatuses, statusValue)
    ? statusValue
    : undefined
  const priority = includesValue(priorities, priorityValue)
    ? priorityValue
    : undefined
  const assigneeIds = new Set(tasks.map((item) => item.assignee.id))
  const assignee =
    assigneeValue && assigneeIds.has(assigneeValue)
      ? assigneeValue
      : undefined
  const sort: TaskSort = includesValue(sorts, sortValue)
    ? sortValue
    : 'due_asc'
  const matchesQuery = (task: Task) => !query || [
    task.code,
    task.title,
    task.description,
    task.assignee.name,
    task.projectId ?? '',
  ].join(' ').toLocaleLowerCase().includes(query)

  return tasks
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      return (
        (!status || item.status === status) &&
        (!assignee || item.assignee.id === assignee) &&
        (!priority || item.priority === priority) &&
        matchesQuery(item)
      )
    })
    .sort((left, right) => {
      const dueComparison = left.item.dueDate.localeCompare(right.item.dueDate)
      const sortedComparison =
        sort === 'due_desc' ? -dueComparison : dueComparison
      return sortedComparison || left.index - right.index
    })
    .map(({ item }) => item)
}

export interface TaskFiltersProps {
  tasks: readonly Task[]
}

export function TaskFilters({ tasks }: TaskFiltersProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const assignees = Array.from(
    new Map(tasks.map((item) => [item.assignee.id, item.assignee])).values(),
  )

  const setParam = (key: string, value: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (value) {
        next.set(key, value)
      } else {
        next.delete(key)
      }
      next.delete('selected')
      return next
    })
  }

  const selectedStatus = includesValue(taskStatuses, searchParams.get('status'))
    ? searchParams.get('status')!
    : ''
  const selectedPriority = includesValue(priorities, searchParams.get('priority'))
    ? searchParams.get('priority')!
    : ''
  const selectedAssignee = assignees.some(
    (actor) => actor.id === searchParams.get('assignee'),
  )
    ? searchParams.get('assignee')!
    : ''
  const selectedSort = includesValue(sorts, searchParams.get('sort'))
    ? searchParams.get('sort')!
    : 'due_asc'
  const query = searchParams.get('q') ?? ''

  return (
    <section aria-label="任务筛选" className="task-filters">
      <input
        aria-label="搜索任务"
        onChange={(event) => setParam('q', event.target.value)}
        placeholder="搜索任务"
        type="search"
        value={query}
      />
      <button
        aria-pressed={selectedStatus === 'overdue'}
        className="task-filters__overdue"
        onClick={() =>
          setParam(
            'status',
            selectedStatus === 'overdue' ? '' : 'overdue',
          )
        }
        type="button"
      >
        已延期
      </button>
      <label>
        状态
        <select
          onChange={(event) => setParam('status', event.target.value)}
          value={selectedStatus}
        >
          <option value="">全部状态</option>
          <option value="not_started">未开始</option>
          <option value="in_progress">进行中</option>
          <option value="done">已完成</option>
          <option value="overdue">已延期</option>
        </select>
      </label>
      <label>
        负责人
        <select
          onChange={(event) => setParam('assignee', event.target.value)}
          value={selectedAssignee}
        >
          <option value="">全部负责人</option>
          {assignees.map((actor) => (
            <option key={actor.id} value={actor.id}>
              {actor.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        优先级
        <select
          onChange={(event) => setParam('priority', event.target.value)}
          value={selectedPriority}
        >
          <option value="">全部优先级</option>
          {priorities.map((priority) => (
            <option key={priority} value={priority}>
              {priority}
            </option>
          ))}
        </select>
      </label>
      <label>
        排序
        <select
          onChange={(event) => setParam('sort', event.target.value)}
          value={selectedSort}
        >
          <option value="due_asc">截止日期升序</option>
          <option value="due_desc">截止日期降序</option>
        </select>
      </label>
    </section>
  )
}
