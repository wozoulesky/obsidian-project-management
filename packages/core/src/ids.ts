import { randomUUID } from 'node:crypto'

export type EntityIdPrefix = 'activity' | 'actor' | 'project'

export function generateId(prefix: EntityIdPrefix): string {
  return `${prefix}_${randomUUID()}`
}

export function generateActivityId(): string {
  return generateId('activity')
}

export function generateActorId(): string {
  return generateId('actor')
}

export function generateProjectId(): string {
  return generateId('project')
}
