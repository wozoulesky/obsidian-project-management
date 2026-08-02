import type { Task } from '../../data/domain'

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000
const MIN_VISIBLE_BAR_PERCENT = 1.2

export type GanttScale = 'day' | 'week' | 'month'
export type DateProposalKind = 'move' | 'resize'
export type GanttTaskDates = Pick<Task, 'startDate' | 'dueDate'>

export interface TaskBarLayout {
  left: number
  width: number
}

export interface DateProposal extends GanttTaskDates {
  kind?: DateProposalKind
  taskId?: string
}

export function parseIsoDate(date: string): number | null {
  if (!ISO_DATE_PATTERN.test(date)) return null
  const [year, month, day] = date.split('-').map(Number)
  const parsed = new Date(0)
  parsed.setUTCHours(0, 0, 0, 0)
  parsed.setUTCFullYear(year!, month! - 1, day)
  const timestamp = parsed.getTime()
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month! - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null
  }
  return timestamp
}

export function dateToPercent(
  date: string,
  rangeStart: string,
  rangeEnd: string,
): number {
  const dateMs = parseIsoDate(date)
  const startMs = parseIsoDate(rangeStart)
  const endMs = parseIsoDate(rangeEnd)
  if (dateMs === null || startMs === null || endMs === null || endMs <= startMs) {
    return 0
  }
  const percent = ((dateMs - startMs) / (endMs - startMs)) * 100
  return Math.min(100, Math.max(0, percent))
}

function roundPercent(value: number) {
  return Math.round(value * 100) / 100
}

export function taskBarLayout(
  task: GanttTaskDates,
  rangeStart: string,
  rangeEnd: string,
): TaskBarLayout {
  const taskStart = parseIsoDate(task.startDate)
  const taskEnd = parseIsoDate(task.dueDate)
  const start = parseIsoDate(rangeStart)
  const end = parseIsoDate(rangeEnd)
  if (
    taskStart === null ||
    taskEnd === null ||
    start === null ||
    end === null ||
    end <= start ||
    taskEnd < taskStart
  ) {
    return { left: 0, width: 0 }
  }
  if (taskEnd < start || taskStart > end) {
    return { left: 0, width: 0 }
  }
  const rangeDuration = end - start
  const clippedStart = Math.max(taskStart, start)
  const clippedEnd = Math.min(taskEnd, end)
  const rawLeft = ((clippedStart - start) / rangeDuration) * 100
  const rawRight = ((clippedEnd - start) / rangeDuration) * 100
  const rawWidth = Math.max(0, rawRight - rawLeft)
  const width = Math.max(rawWidth, MIN_VISIBLE_BAR_PERCENT)
  const left = Math.min(rawLeft, 100 - width)
  return {
    left: roundPercent(left),
    width: roundPercent(Math.min(width, 100 - left)),
  }
}

export function shiftDate(date: string, days: number): string | null {
  const timestamp = parseIsoDate(date)
  if (timestamp === null || !Number.isFinite(days)) return null
  return new Date(timestamp + Math.trunc(days) * DAY_MS).toISOString().slice(0, 10)
}

export function dateDeltaFromPixels(
  deltaPixels: number,
  timelineWidth: number,
  rangeDays: number,
): number {
  if (
    !Number.isFinite(deltaPixels) ||
    !Number.isFinite(timelineWidth) ||
    !Number.isFinite(rangeDays) ||
    timelineWidth <= 0 ||
    rangeDays <= 0
  ) {
    return 0
  }
  return Math.round((deltaPixels / timelineWidth) * rangeDays)
}

export function buildDateProposal(
  kind: DateProposalKind,
  startDate: string,
  dueDate: string,
  deltaDays: number,
): GanttTaskDates | null {
  const start = parseIsoDate(startDate)
  const due = parseIsoDate(dueDate)
  if (start === null || due === null || due < start || !Number.isFinite(deltaDays)) {
    return null
  }
  const delta = Math.trunc(deltaDays)
  if (kind === 'move') {
    const shiftedStart = shiftDate(startDate, delta)
    const shiftedDue = shiftDate(dueDate, delta)
    return shiftedStart && shiftedDue
      ? { startDate: shiftedStart, dueDate: shiftedDue }
      : null
  }
  const shiftedDue = shiftDate(dueDate, delta)
  const nextDue =
    shiftedDue && parseIsoDate(shiftedDue)! >= start ? shiftedDue : startDate
  return { startDate, dueDate: nextDue }
}
