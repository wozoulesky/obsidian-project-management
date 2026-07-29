import type { ActorService } from '@project-os/core'

export function runAtomicWrite<T>(
  actors: ActorService,
  agentId: string,
  operation: () => T,
): T {
  return actors.runAtomic(() => {
    const result = operation()
    actors.touch(agentId)
    return result
  })
}

export function touchAfterRead(
  actors: ActorService,
  agentId: string,
): void {
  actors.touch(agentId)
}
