import type { TaskStatus } from './domain'

export function progressForStatus(
  status: TaskStatus,
  currentProgress: number,
): number {
  if (status === 'not_started') return 0
  if (status === 'done') return 100
  if (!Number.isFinite(currentProgress)) return 1
  return Math.min(99, Math.max(1, Math.round(currentProgress)))
}
