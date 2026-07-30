# Project OS MCP tool reference

The server exposes exactly these 27 unique tools:

- `agent_register` — Register or resume an idempotent Agent identity. This is a
  write and returns the Agent ID used by all later calls.
- `agent_whoami` — Validate an active Agent ID and return its role and client.
- `agent_list` — List registered Agents, optionally filtered by status.
- `session_checkin` — Open an Agent-owned project session with an intent and up
  to 20 task claims; returns the session and its initial project briefing.
- `project_briefing` — Refresh the caller's project briefing and advance its
  activity cursor.
- `session_note` — Record a key decision, gotcha, blocker, or task-scoped note
  on the caller's active session.
- `session_checkout` — Close the caller's active session and atomically create
  its structured handoff.
- `deliverable_record` — Record a commit, file, URL, or note linked to a
  requirement or task.
- `project_create` — Create a project and its owner membership.
- `project_get` — Read one project by ID.
- `project_list` — List projects by owner or status with a composite cursor.
- `project_update` — Update a project with its current version.
- `task_create` — Create a task within a project for a valid project member.
- `task_get` — Read one task by ID.
- `task_list` — List tasks by project, assignee, or status with a composite
  cursor.
- `task_update` — Update a task with its current version and shared role rules.
- `progress_submit` — Submit assigned-task progress, status, note, and current
  version.
- `requirement_create` — Create a requirement under shared role rules.
- `requirement_list` — List requirements by project or status with a composite
  cursor.
- `requirement_update` — Update a requirement with its current version.
- `defect_create` — Create a defect under shared role rules.
- `defect_list` — List defects by project, assignee, or status with a composite
  cursor.
- `defect_update` — Update a defect with its current version.
- `defect_to_task` — Convert a defect into a linked task using the defect's
  current version.
- `dashboard_snapshot` — Read current task, defect, progress, risk, and activity
  metrics, optionally for one project.
- `list_overdue` — List overdue tasks, optionally for one project and effective
  date.
- `activity_log` — Read audit activity by entity, actor, project, source, or
  cursor.

## Permission matrix

Every authenticated tool first requires an active Agent. Domain services then
apply project membership, assignment, ownership, and entity-state checks.

| Capability / operation | pm-agent | dev-agent | qa-agent | doc-agent |
| --- | :---: | :---: | :---: | :---: |
| Project write | yes | no | no | description only |
| Task write | yes | assigned progress only | no | description only |
| Requirement write | yes | no | no | description only |
| Defect write / verify | no | write | write + verify | description only |
| Reports and activity read | yes | yes | yes | yes |
| Session manage | yes | yes | yes | yes |
| Briefing and handoff read | yes | yes | yes | yes |
| Deliverable read | yes | yes | yes | yes |
| Deliverable record | yes | yes | yes | no |

The collaboration tools map to those capabilities as follows:

| Tool group | Required operation |
| --- | --- |
| Check in, note, and check out | `session.manage` |
| Refresh project briefing | `briefing.read` |
| Record a deliverable | `deliverable.record` |

Use the narrowest role that matches the Agent's job. A permission error must
not be bypassed by changing Agent identity.

## Strict collaboration inputs

All MCP inputs are strict objects: unknown fields are rejected. Include
`agent_id` on every tool except initial registration.

- Check-in requires `project_id` and non-empty `intent`; optional `task_ids`
  contains no more than 20 IDs. Claims declare scope but do not reassign tasks
  or change task status.
- Briefing requires `project_id`.
- Session notes require `session_id` and non-empty `note`; `task_id` is
  optional but must belong to the session project.
- Checkout requires `session_id`, non-empty `summary`, and the arrays `done`,
  `blockers`, and `next_steps`; optional `gotchas` and `refs` arrays default to
  empty.
- Each handoff ref has `kind` set to commit, file, url, or note, a non-empty
  `ref`, and an optional `note`.
- Deliverables require `project_id`, non-empty `title`, `kind`, and non-empty
  `ref`, plus at least one of `requirement_id` or `task_id`. Optional
  `session_id` must belong to the recording Agent and project.

## Pagination and activity cursors

- Limits are integers from 1 through 200.
- Project cursors require `after_code` and `after_id` together.
- Task, requirement, and defect cursors require `after_project_id`,
  `after_code`, and `after_id` together.
- For `activity_log`, `after` and `since` are mutually exclusive.
- `after` is normal reverse-chronological pagination: it returns older
  activities in descending timestamp/ID order.
- `since` is incremental relay consumption: it returns only activities newer
  than the cursor in insertion order, ascending (ASC), and excludes the cursor
  itself. The cursor must exist and match every supplied filter.

Treat returned IDs, cursors, and versions as opaque values.

## Concurrency and audit rules

- Include `version` on project, task, requirement, and defect updates, progress
  submissions, and defect conversion.
- Refresh the record before retrying a version conflict; reconcile concurrent
  changes instead of blindly repeating the write.
- Authenticated reads update the caller's last-active state. Domain writes,
  session changes, checkout handoffs, and deliverables record MCP activity.
- Record decisions, gotchas, and blockers with a session note immediately.
- Record every deliverable before checkout. A checkout creates the handoff the
  next Agent receives as `latest_handoff`; an unclosed stale session is only
  reported as abandoned.
