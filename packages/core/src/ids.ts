import { randomUUID } from 'node:crypto'

export type EntityIdPrefix =
  | 'activity'
  | 'actor'
  | 'project'
  | 'session'
  | 'handoff'
  | 'deliverable'

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

export function generateSessionId(): string {
  return generateId('session')
}

export function generateHandoffId(): string {
  return generateId('handoff')
}

export function generateDeliverableId(): string {
  return generateId('deliverable')
}
