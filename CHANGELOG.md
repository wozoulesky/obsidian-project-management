# Changelog

## v1.1.0 — 2026-07-30

Project OS v1.1.0 adds a durable Agent-to-Agent relay loop while preserving the
existing local-first project, task, requirement, defect, and reporting flows.

### Highlights

- Added Agent work sessions with explicit check-in intent and task claims.
- Added project briefings with the latest structured handoff, active and
  abandoned sessions, recent deliverables, and incremental activity.
- Added in-session notes for decisions, gotchas, and blockers.
- Added deliverable records linked to requirements or tasks.
- Added mandatory checkout handoffs containing completed work, blockers, next
  steps, gotchas, and references.

### Platform and integrations

- Expanded the MCP surface from 22 to 27 tools with strict schemas and
  permission checks for session check-in, project briefing, session notes,
  session checkout, and deliverable recording.
- Added relay persistence, migrations, import/export validation, and REST
  project-scoped session, handoff, and deliverable endpoints.
- Updated the installable Project OS Skill to a three-act start, work, and end
  protocol so the next Agent can resume from durable state.

### Quality and documentation

- Added an exact double-Agent MCP relay test proving Agent B receives Agent A's
  checkout, deliverable, and activity trail.
- Added collaboration service, REST, import/export, permission, and Web
  repository coverage.
- Updated the bilingual README, Agent setup guide, tool reference, verifier,
  and release evidence checklist for the 27-tool contract.

### Validation

- Focused v1.1 MCP, REST, and Web tests are recorded in the
  [release checklist](docs/release-checklist.md).
- A fresh final `npm run check` remains a release-orchestrator gate and must not
  be inferred from focused suites.

## v1.0.0 — 2026-07-30

Project OS v1.0.0 is the first complete local-first project management and
Agent collaboration release.

### Highlights

- Added an all-project portfolio as the default project view, with owner
  filtering and project creation directly from the project list.
- Scoped task creation and task management to the selected project.
- Added a unified owner directory for people and Agents, so project
  responsibilities are visible and assignable.
- Restored quick progress submission and connected it to persisted activities.
- Added requirements, defects, Gantt planning, dashboards, and a collapsible
  icon/name sidebar.
- Implemented appearance, data, MCP token, and Agent Skills settings instead
  of an empty settings page.

### Platform and integrations

- Added SQLite persistence, migrations, demo seed data, backups/restores, and
  JSON import/export.
- Added a versioned REST API with conflict handling and atomic activity writes.
- Added 22 MCP tools over stdio and Streamable HTTP at `/mcp`, backed by the
  same services and database as the Web application.
- Added remote-access safeguards for Bearer tokens, Host and Origin
  allowlists, session expiry, strict tool schemas, and sanitized errors.
- Added an installable Agent Skill package and setup guidance for Codex,
  Claude Code, and Kimi Code.

### Quality and documentation

- Added unit, integration, contract, accessibility, visual, and real-service
  Playwright coverage.
- Added fresh-clone-accurate setup, build, production hosting, backup,
  security, MCP, Skill, and release-checklist documentation.
- Added checks for REST/MCP consistency, failure recovery, atomic writes, and
  deterministic Skill packaging.
- Isolated nested-worktree concurrency clients and parallel Vite dependency
  caches to prevent duplicate test discovery and optimizer races.

### Known limitations

- Project OS is designed for a local machine or trusted-network,
  single-instance deployment. It does not provide user login, tenant
  isolation, or TLS termination.
- Real-client smoke evidence is complete for Kimi Code. In the isolated release
  environment, Codex was blocked by `spawn EPERM`, and Claude Code was not
  invoked because no credential source could be safely isolated. The release
  is therefore not described as fully accepted by all three clients.
- `npm audit` reports transitive advisories that cannot currently be resolved
  without forced major-version dependency changes. Do not use
  `npm audit fix --force`; follow upstream updates and re-run the full quality
  gate when dependency ranges are intentionally upgraded.

### Validation

- `npm run check`
- `npm run test:e2e`

See [README.md](README.md), [README_EN.md](README_EN.md), and the
[release checklist](docs/release-checklist.md) for setup and evidence details.
