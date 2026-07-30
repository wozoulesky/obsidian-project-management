import { actorRoleSchema } from '@project-os/contracts'
import type { ActorRole } from '@project-os/contracts'
import { DomainError } from './errors.js'

export const workOperations = [
  'project.read',
  'project.write',
  'project.delete',
  'task.read',
  'task.write',
  'task.progress',
  'requirement.read',
  'requirement.write',
  'defect.read',
  'defect.write',
  'defect.verify',
  'report.read',
  'report.write',
  'activity.read',
  'activity.note',
  'description.write',
  'session.manage',
  'briefing.read',
  'handoff.read',
  'deliverable.read',
  'deliverable.record',
] as const

export type WorkOperation = (typeof workOperations)[number]

const humanOperations = new Set<WorkOperation>(workOperations)
const permissions: Record<ActorRole, ReadonlySet<WorkOperation>> = {
  owner: humanOperations,
  member: humanOperations,
  'pm-agent': new Set([
    'project.read',
    'project.write',
    'task.read',
    'task.write',
    'task.progress',
    'requirement.read',
    'requirement.write',
    'defect.read',
    'report.read',
    'report.write',
    'activity.read',
    'session.manage',
    'briefing.read',
    'handoff.read',
    'deliverable.read',
    'deliverable.record',
  ]),
  'dev-agent': new Set([
    'project.read',
    'task.read',
    'task.progress',
    'requirement.read',
    'defect.read',
    'defect.write',
    'report.read',
    'activity.read',
    'session.manage',
    'briefing.read',
    'handoff.read',
    'deliverable.read',
    'deliverable.record',
  ]),
  'qa-agent': new Set([
    'project.read',
    'task.read',
    'requirement.read',
    'defect.read',
    'defect.write',
    'defect.verify',
    'report.read',
    'activity.read',
    'session.manage',
    'briefing.read',
    'handoff.read',
    'deliverable.read',
    'deliverable.record',
  ]),
  'doc-agent': new Set([
    'project.read',
    'task.read',
    'requirement.read',
    'defect.read',
    'report.read',
    'activity.read',
    'activity.note',
    'description.write',
    'session.manage',
    'briefing.read',
    'handoff.read',
    'deliverable.read',
  ]),
}

export function canPerform(
  role: ActorRole,
  operation: WorkOperation,
): boolean {
  const validatedRole = actorRoleSchema.parse(role)
  return permissions[validatedRole].has(operation)
}

export function assertPermission(
  role: ActorRole,
  operation: WorkOperation,
): void {
  if (!canPerform(role, operation)) {
    throw new DomainError(
      'PERMISSION_DENIED',
      'Actor is not permitted to perform this operation',
      { role, operation },
    )
  }
}
