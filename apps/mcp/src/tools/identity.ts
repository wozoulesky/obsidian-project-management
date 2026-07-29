import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  actorStatusSchema,
  agentActorRoleSchema,
  projectMemberSchema,
} from '@project-os/contracts'
import type { PersistedActor } from '@project-os/contracts'
import {
  DomainError,
} from '@project-os/core'
import type { ActorService } from '@project-os/core'
import { z } from 'zod'
import {
  handleToolCall,
  successResult,
} from '../tool-result.js'
import { bestEffortTouch } from '../tool-execution.js'

const agentIdSchema = projectMemberSchema.shape.actorId.describe(
  'Persisted Agent ID returned by agent_register',
)
const agentRegisterInputSchema = z.strictObject({
  name: z.string().min(1).describe('Stable Agent name within the client'),
  role: agentActorRoleSchema.describe('Project OS Agent role'),
  client: z.string().min(1).describe(
    'Calling client, for example codex, claude-code, or kimi-code',
  ),
  capabilities: z.array(z.string()).optional().describe(
    'Optional capability labels advertised by the Agent',
  ),
})
const agentWhoamiInputSchema = z.strictObject({
  agent_id: agentIdSchema,
})
const agentListInputSchema = z.strictObject({
  agent_id: agentIdSchema,
  status: actorStatusSchema.optional().describe(
    'Optional active or inactive status filter',
  ),
  limit: z.number().int().min(1).max(200).optional(),
})

function presentAgent(actor: PersistedActor): Record<string, unknown> {
  return {
    agent_id: actor.id,
    name: actor.name,
    role: actor.role,
    status: actor.status,
    client: actor.client ?? null,
    capabilities: actor.capabilities,
    registered_at: actor.registeredAt,
    last_active_at: actor.lastActiveAt,
    version: actor.version,
  }
}

export function requireAgent(
  actors: ActorService,
  agentId: string,
): Extract<PersistedActor, { kind: 'agent' }> {
  const actor = actors.get(agentId)
  if (actor.kind !== 'agent') {
    throw new DomainError(
      'ACTOR_KIND_INVALID',
      'MCP identity must be an agent',
      { actorId: agentId },
    )
  }
  if (actor.status !== 'active') {
    throw new DomainError(
      'ACTOR_INACTIVE',
      'Actor is inactive',
      { actorId: agentId },
    )
  }
  return actor
}

export function registerIdentityTools(
  server: McpServer,
  actors: ActorService,
): void {
  server.registerTool('agent_register', {
    description:
      'Register or resume a persistent Project OS Agent identity. '
      + 'This writes agent identity/activity data and returns the Agent ID '
      + 'required by later MCP calls.',
    inputSchema: agentRegisterInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, ({ name, role, client, capabilities }) => handleToolCall(() => {
    const actor = actors.runAtomic(() => {
      const registered = actors.registerAgent({
        name,
        role,
        client,
        ...(capabilities === undefined ? {} : { capabilities }),
      })
      return actors.touch(registered.id)
    })
    return successResult(
      `Registered Project OS Agent ${actor.name} (${actor.id}).`,
      presentAgent(actor),
    )
  }))

  server.registerTool('agent_whoami', {
    description:
      'Validate and resume a registered Agent identity. '
      + 'Requires agent_id and updates its last-active timestamp.',
    inputSchema: agentWhoamiInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, ({ agent_id: agentId }) => handleToolCall(() => {
    const actor = requireAgent(actors, agentId)
    bestEffortTouch(actors, agentId)
    return successResult(
      `Active Project OS Agent: ${actor.name} (${actor.role}).`,
      presentAgent(actor),
    )
  }))

  server.registerTool('agent_list', {
    description:
      'List registered Project OS Agents. Requires an active agent_id and '
      + 'updates the caller last-active timestamp; it does not modify others.',
    inputSchema: agentListInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, ({ agent_id: agentId, status, limit }) => handleToolCall(() => {
    requireAgent(actors, agentId)
    const agents = actors.list({
      kind: 'agent',
      ...(status === undefined ? {} : { status }),
      ...(limit === undefined ? {} : { limit }),
    })
    bestEffortTouch(actors, agentId)
    return successResult(
      `Found ${agents.length} Project OS Agent(s).`,
      { agents: agents.map(presentAgent) },
    )
  }))
}
