---
name: project-os
description: Coordinate projects, tasks, requirements, defects, progress, overdue work, and activity through the Project OS MCP server. Use when an Agent needs to register or resume its Project OS identity, inspect assigned work, update authorized project records, submit task progress, or prepare a current project-status report.
---

# Project OS

Use the Project OS MCP tools as the system of record for project work. Keep the
Agent ID stable across sessions and send it as `agent_id` on every call after
registration.

## Start every session

1. Call `agent_whoami` with the stored Agent ID.
2. If no Agent ID exists, or the server reports it missing, call
   `agent_register` once with a stable name, the narrowest correct role, and the
   current client name. Store the returned Agent ID for later sessions.
3. Call `project_list` to establish project scope.
4. Call `task_list` with `assignee_id` set to the Agent ID to inspect assigned
   work. Add `project_id` when the user has selected a project.
5. Call `list_overdue` and `activity_log` before proposing priorities or
   reporting status.

Registration writes identity data. Do not silently create a second identity
when an existing ID fails; report inactive identities and request direction.

## Perform work safely

- Use `project_get` or the relevant list result to obtain the current version
  before an update.
- Pass the current `version` to every update and progress submission. On a
  version conflict, reread the record, reconcile the new state, and retry only
  when the intended change is still valid.
- Respect role permissions. A rejected write is a boundary, not an invitation
  to change roles or use another Agent ID.
- Prefer `progress_submit` for assigned-task progress. Include a concise note
  describing verified work and keep status consistent with progress.
- Use list filters and cursors for bounded reads. Do not guess IDs from display
  names.
- Treat `isError: true` and its structured error code as a failed operation.
  Never claim a write succeeded without a successful structured result.
- Recheck `activity_log` after material writes when an audit trail is part of
  the requested outcome.

## Choose tools

Read [references/tool-reference.md](references/tool-reference.md) when selecting
tools, checking permissions, or constructing filtered and paginated calls.

Read the matching setup reference when connecting a client:

- [Codex](references/codex-config.md)
- [Claude Code](references/claude-code-config.md)
- [Kimi Code](references/kimi-code-config.md)

Run `node scripts/verify-connection.mjs` from this skill directory to verify
only discovery of the exact tool contract. Default verification does not call
authenticated tools because those calls update Agent activity. Use
`--write-smoke` only when registering or touching a smoke-test Agent is
explicitly acceptable. An optional `--agent-id <id>` is accepted only together
with that write flag. The verifier uses only Node.js built-in modules, so an
exported Skill does not require `npm install`.

Contract-only verification still starts stdio and opens the selected SQLite
path. It can create the parent directory, database, WAL files, and apply schema
migrations. `sideEffects: []` means no business-tool writes; it does not mean
the filesystem or schema is untouched. Pass `--database` with a disposable path
when those effects must be isolated.
