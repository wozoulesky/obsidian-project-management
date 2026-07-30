# Changelog

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
