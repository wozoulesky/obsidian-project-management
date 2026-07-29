# Project OS MCP tool reference

The server exposes exactly these 22 tools:

- `agent_register` — Register or resume an idempotent Agent identity. This is a
  write and returns the Agent ID used by all later calls.
- `agent_whoami` — Validate an active Agent ID and return its role and client.
- `agent_list` — List registered Agents, optionally filtered by status.
- `project_create` — Create a project and its owner membership. Requires
  project-write permission.
- `project_get` — Read one project by ID.
- `project_list` — List projects by owner or status with a composite cursor.
- `project_update` — Update a project with its current version. Requires
  project-write permission.
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

## Role boundaries

| Role | Intended writes |
| --- | --- |
| pm-agent | Projects, tasks, progress, and requirements |
| dev-agent | Assigned-task progress and permitted defect work |
| qa-agent | Defect creation, updates, and verification |
| doc-agent | Description-only changes where supported |

All Agent roles can read projects, tasks, requirements, defects, reports, and
activity. Domain services apply additional assignment and membership rules.
Use the narrowest role that matches the Agent's job.

## Call rules

- Include agent_id on every tool except initial registration.
- Include version on updates, progress submissions, and defect conversion.
- Use project_id, assignee_id, and status filters to avoid broad reads.
- Supply every part of a composite cursor together. Project cursors use code
  plus ID. Task, requirement, and defect cursors use project ID, code, and ID.
- Treat returned IDs and versions as opaque values.
- Refresh before retrying a concurrency error.

The MCP server records last-active touches for authenticated reads and records
MCP activity for domain writes.
