import { useMemo, useRef, type RefObject } from 'react'
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'

import { Badge } from '../../components/ui/Badge'
import { Progress } from '../../components/ui/Progress'
import type { Task } from '../../data/domain'

const statusLabels: Record<Task['status'], string> = {
  not_started: '未开始',
  in_progress: '进行中',
  done: '已完成',
  overdue: '已延期',
}

export interface TaskTableProps {
  onSelect: (taskId: string) => void
  selectedTaskId: string | null
  tasks: Task[]
}

function taskColumns(onSelect: (taskId: string) => void): ColumnDef<Task>[] {
  return [
    {
      accessorKey: 'title',
      header: '任务',
      cell: ({ row }) => (
        <button
          aria-label={`查看 ${row.original.title}`}
          className="task-table__task-button"
          id={`task-trigger-${row.original.id}`}
          onClick={() => onSelect(row.original.id)}
          type="button"
        >
          <span>{row.original.title}</span>
          <small>{row.original.code}</small>
        </button>
      ),
    },
    {
      accessorKey: 'status',
      header: '状态',
      cell: ({ row }) => {
        const status = row.original.status
        return (
          <Badge
            tone={
              status === 'overdue'
                ? 'critical'
                : status === 'in_progress'
                  ? 'primary'
                  : 'neutral'
            }
          >
            {statusLabels[status]}
          </Badge>
        )
      },
    },
    {
      accessorFn: (item) => item.assignee.name,
      id: 'assignee',
      header: '负责人',
      cell: ({ row }) => row.original.assignee.name,
    },
    {
      accessorKey: 'progress',
      header: '进度',
      cell: ({ row }) => {
        const progress = row.original.progress
        return (
          <div className="task-table__progress">
            <Progress
              label={`${row.original.title}进度 ${progress}%`}
              value={progress}
            />
            <span>{progress}%</span>
          </div>
        )
      },
    },
    {
      accessorKey: 'dueDate',
      header: '截止日期',
    },
    {
      accessorKey: 'priority',
      header: '优先级',
      cell: ({ row }) => (
        <Badge tone={row.original.priority === 'P0' ? 'critical' : 'neutral'}>
          {row.original.priority}
        </Badge>
      ),
    },
  ]
}

function TaskRow({
  row,
  selectedTaskId,
}: {
  row: Row<Task>
  selectedTaskId: string | null
}) {
  return (
    <tr
      className={[
        'task-table__grid-row',
        row.original.id === selectedTaskId ? 'is-selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {row.getVisibleCells().map((cell) => (
        <td key={cell.id}>
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </tr>
  )
}

function VirtualTaskBody({
  rows,
  scrollRef,
  selectedTaskId,
}: {
  rows: Row<Task>[]
  scrollRef: RefObject<HTMLDivElement | null>
  selectedTaskId: string | null
}) {
  // TanStack Virtual intentionally exposes non-memoizable measurement callbacks.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
    overscan: 8,
  })

  return (
    <tbody
      className="task-table__virtual-body"
      style={{ height: rowVirtualizer.getTotalSize() }}
    >
      {rowVirtualizer.getVirtualItems().map((virtualRow) => {
        const row = rows[virtualRow.index]!
        return (
          <tr
            className={[
              'task-table__grid-row',
              row.original.id === selectedTaskId ? 'is-selected' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            data-index={virtualRow.index}
            key={row.id}
            ref={rowVirtualizer.measureElement}
            style={{ transform: `translateY(${virtualRow.start}px)` }}
          >
            {row.getVisibleCells().map((cell) => (
              <td key={cell.id}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          </tr>
        )
      })}
    </tbody>
  )
}

export function TaskTable({
  onSelect,
  selectedTaskId,
  tasks,
}: TaskTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const columns = useMemo(() => taskColumns(onSelect), [onSelect])
  // TanStack Table intentionally exposes a stateful table instance API.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    columns,
    data: tasks,
    getCoreRowModel: getCoreRowModel(),
  })
  const rows = table.getRowModel().rows

  return (
    <div className="data-grid task-table" ref={scrollRef}>
      <table aria-label="任务列表">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr className="task-table__grid-row" key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id} scope="col">
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        {tasks.length > 100 ? (
          <VirtualTaskBody
            rows={rows}
            scrollRef={scrollRef}
            selectedTaskId={selectedTaskId}
          />
        ) : (
          <tbody>
            {rows.map((row) => (
              <TaskRow
                key={row.id}
                row={row}
                selectedTaskId={selectedTaskId}
              />
            ))}
          </tbody>
        )}
      </table>
    </div>
  )
}
