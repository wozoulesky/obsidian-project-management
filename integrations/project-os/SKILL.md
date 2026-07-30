---
name: project-os
description: Coordinate projects and multi-Agent relay work through the 27-tool Project OS MCP server. Use when an Agent needs to register or resume its identity, check into scoped work, read a project briefing, update authorized records, record deliverables, or leave a structured handoff.
---

# Project OS

Use Project OS as the system of record for project work and Agent relay state.
Keep the Agent ID stable across sessions and send it as `agent_id` on every
call after registration.

## Start every session

1. Call `agent_whoami` with the stored Agent ID. If no ID exists, or the server
   reports that it is missing, call `agent_register` once with a stable name,
   the narrowest correct role, and the current client name. Store the returned
   Agent ID for later sessions.
2. Call `session_checkin` with the selected `project_id`, a concrete `intent`,
   and any claimed `task_ids`. Claiming a task declares this session's scope;
   it does not change task status or assignment.
3. Read the returned briefing: inspect `latest_handoff` first, then
   `new_activities` before work, and only then the remaining tasks, active
   sessions, and recent deliverables. Do not start work until blockers,
   gotchas, prior decisions, and current ownership are understood.

Registration writes identity data. Do not silently create a second identity
when an existing ID fails; report inactive identities and request direction.
`project_briefing` can refresh the same project briefing later in a session.

## Perform work safely

- Use `project_get` or the relevant list result to obtain the current version
  before an update.
- Pass the current `version` to every update, progress submission, and defect
  conversion. On a version conflict, reread the record, reconcile the new
  state, and retry only when the intended change is still valid.
- Respect role permissions, project membership, task assignment, and session
  ownership. A rejected write is a boundary, not an invitation to change roles
  or use another Agent ID.
- Use list filters and cursors for bounded reads. Supply every composite cursor
  part together. Do not guess IDs from display names.
- Treat `isError: true` and its structured error code as a failed operation.
  Never claim a write succeeded without a successful structured result.
- Record key decisions, gotchas, and blockers immediately with `session_note`;
  include `task_id` when the note belongs to a claimed task. Do not wait until
  checkout to preserve information another Agent may need.
- Recheck `activity_log` after material writes when an audit trail is part of
  the requested outcome.

## End every session

Ending a session is mandatory, including when work is blocked.

1. Record every deliverable first with `deliverable_record`. Link it to at
   least one `requirement_id` or `task_id`, and include the current
   `session_id` when it was produced in this session.
2. Call `session_checkout` with a concise `summary` and complete `done`,
   `blockers`, and `next_steps` arrays. Include `gotchas` and structured `refs`
   for commits, files, URLs, or notes whenever they help the next Agent resume.

No checkout means the work is not finished. The next Agent only sees an
abandoned session instead of a structured handoff.

## Choose tools

Read [references/tool-reference.md](references/tool-reference.md) when selecting
tools, checking permissions, or constructing strict, filtered, and paginated
calls.

Read the matching setup reference when connecting a client:

- [Codex](references/codex-config.md)
- [Claude Code](references/claude-code-config.md)
- [Kimi Code](references/kimi-code-config.md)

Run `node scripts/verify-connection.mjs` from this skill directory to verify
only discovery of the exact 27-tool contract. Default verification does not
call authenticated tools because those calls update Agent activity. Use
`--write-smoke` only when registering or touching a smoke-test Agent is
explicitly acceptable. An optional `--agent-id <id>` is accepted only together
with that write flag. The verifier uses only Node.js built-in modules, so an
exported Skill does not require `npm install`.

Contract-only verification still starts stdio and opens the selected SQLite
path. It can create the parent directory, database, WAL files, and apply schema
migrations. `sideEffects: []` means no business-tool writes; it does not mean
the filesystem or schema is untouched. Pass `--database` with a disposable path
when those effects must be isolated.
