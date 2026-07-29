import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { DomainError } from '@project-os/core'

type StructuredContent = Record<string, unknown>

export function successResult(
  text: string,
  structuredContent: StructuredContent,
): CallToolResult {
  return {
    content: [{
      type: 'text',
      text,
    }],
    structuredContent,
  }
}

export function domainErrorResult(error: DomainError): CallToolResult {
  const code = error.code === 'PERMISSION_DENIED'
    ? 'AGENT_PERMISSION_DENIED'
    : error.code
  const structuredContent = {
    code,
    message: error.message,
    details: error.details,
  }

  return {
    isError: true,
    content: [{
      type: 'text',
      text: JSON.stringify(structuredContent),
    }],
    structuredContent,
  }
}

export function handleToolCall(
  operation: () => CallToolResult,
): CallToolResult {
  try {
    return operation()
  } catch (error) {
    if (error instanceof DomainError) {
      return domainErrorResult(error)
    }
    throw error
  }
}
