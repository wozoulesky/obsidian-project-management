import { describe, expect, it } from 'vitest'
import {
  generateDeliverableId,
  generateHandoffId,
  generateSessionId,
} from './index.js'
import { canPerform, workOperations } from './permissions.js'

describe('relay entity IDs', () => {
  it.each([
    ['session', generateSessionId],
    ['handoff', generateHandoffId],
    ['deliverable', generateDeliverableId],
  ] as const)('generates unique canonical %s IDs', (prefix, generate) => {
    const ids = Array.from({ length: 20 }, () => generate())

    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(id).toMatch(
        new RegExp(
          `^${prefix}_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}`
          + '-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          'i',
        ),
      )
    }
  })
})

describe('relay permissions', () => {
  const relayReadOperations = [
    'session.manage',
    'briefing.read',
    'handoff.read',
    'deliverable.read',
  ] as const

  it('appends the relay operations to the public work operation list', () => {
    expect(workOperations.slice(-5)).toEqual([
      ...relayReadOperations,
      'deliverable.record',
    ])
  })

  it.each([
    'pm-agent',
    'dev-agent',
    'qa-agent',
    'doc-agent',
  ] as const)('allows %s to manage sessions and read relay data', (role) => {
    for (const operation of relayReadOperations) {
      expect(canPerform(role, operation), `${role} ${operation}`).toBe(true)
    }
  })

  it.each([
    ['pm-agent', true],
    ['dev-agent', true],
    ['qa-agent', true],
    ['doc-agent', false],
  ] as const)('sets deliverable.record for %s to %s', (role, expected) => {
    expect(canPerform(role, 'deliverable.record')).toBe(expected)
  })

  it.each(['owner', 'member'] as const)(
    'gives %s every work operation',
    (role) => {
      for (const operation of workOperations) {
        expect(canPerform(role, operation), `${role} ${operation}`).toBe(true)
      }
    },
  )
})
