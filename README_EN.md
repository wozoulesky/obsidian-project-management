# Project OS — Local Project and Agent Coordination

[中文](README.md) | [English](README_EN.md)

Project OS is a local-first project workspace. Its React Web application, REST
API, SQLite database, MCP server, and installable Agent Skill share the same
data and permission rules. The current release includes:

- an all-project portfolio, owner filtering, project creation, and task
  creation inside a selected project;
- a unified human/Agent directory, quick progress submission, requirements,
  defects, Gantt planning, and dashboards;
- appearance, data, MCP token, and Agent Skills settings;
- stdio setup for Codex, Claude Code, and Kimi Code, plus `/mcp` Streamable HTTP;
- SQLite persistence, backups/restores, and JSON import/export.

> This project is intended for a local machine or a trusted-network,
> single-instance deployment. It does not provide user login, tenant isolation,
> or TLS termination. Configure tokens, host/origin allowlists, and an external
> TLS reverse proxy before binding to a remote interface.

![Project OS dashboard](web/e2e/dashboard.spec.ts-snapshots/dashboard-90-day-desktop-win32.png)

## Prerequisites

- Node.js 24 or newer
- npm
- Playwright Chromium for the first browser-test run

Install the locked dependencies:

```bash
npm ci
```

## Local development

```bash
npm run dev
```

This starts:

- the API and `/mcp` at `http://127.0.0.1:4310`;
- the Vite Web application, normally at `http://localhost:5173`.

Vite proxies `/api` to the local API. `Ctrl+C` supervises and stops both
processes. The default database is `data/project_manage.db`; startup runs
migrations and applies the idempotent demo seed.

## Build and start

```bash
npm run build
npm start
```

`npm run build` type-checks the workspaces and creates `web/dist/` and
`apps/mcp/dist/stdio.js`. `npm start` starts **only the API and MCP HTTP
service**; it does not serve `web/dist/`. To run the production Web build, host
`web/dist/` with a static server, configure an `index.html` SPA fallback, and
reverse-proxy `/api` to the API service.

Server defaults:

| Variable | Default | Purpose |
|---|---|---|
| `PROJECT_OS_HOST` | `127.0.0.1` | API/MCP bind address |
| `PROJECT_OS_PORT` | `4310` | API/MCP port |
| `PROJECT_OS_DATABASE_PATH` | `data/project_manage.db` | REST service database |
| `PROJECT_OS_BACKUP_ROOT` | `data/backups` | Backup directory |
| `PROJECT_OS_ALLOWED_HOSTS` | empty | Required Host allowlist for a non-loopback bind |
| `PROJECT_OS_ALLOWED_ORIGINS` | empty | Exact allowed HTTP/HTTPS origins |
| `PROJECT_OS_LOCAL_ACTOR_ID` | `actor_local_owner` | Local Web actor |

Relative paths resolve from the repository root. stdio also accepts
`PROJECT_OS_DB`, which takes precedence over `PROJECT_OS_DATABASE_PATH`.

## Commands

Run commands from the repository root.

| Command | Purpose |
|---|---|
| `npm run dev` | Start the API and Web development environment |
| `npm run build` | Build/type-check all workspaces |
| `npm start` | Start only the API and MCP HTTP service |
| `npm test` | Run all unit and integration tests |
| `npm run test:e2e` | Run real-service, accessibility, and visual Playwright tests |
| `npm run check:docs` | Validate documentation commands, links, clients, and safe examples |
| `npm run check` | Run lint, tests, builds, and the documentation gate |

Before the first E2E run:

```bash
npx playwright install chromium
npm run test:e2e
```

## MCP and the Agent Skill

Project OS exposes 22 tools. Both transports use the same services and SQLite
data:

- stdio at `apps/mcp/dist/stdio.js` for local Codex, Claude Code, and Kimi Code;
- Streamable HTTP at `http://127.0.0.1:4310/mcp` for compatible clients.

The MCP settings panel issues and revokes access tokens. Plaintext is displayed
once; the server stores only its digest. A loopback bind does not require a
token. On a non-loopback bind, REST and MCP requests require a valid Bearer
token except for `/api/v1/health`.

See the [Agent setup guide](docs/agent-setup.md) for all client configurations,
Skill installation, side effects, verification, and troubleshooting.

Default connection verification does not call business tools, so it does not
write Agents, projects, tasks, or activities. Starting stdio still opens the
selected SQLite path and may create its parent directory, database, WAL files,
and schema migrations. Pass a temporary `--database` path when filesystem and
schema effects must be isolated.

## Data and backups

The settings page creates/restores SQLite backups and exports/imports JSON.
Restore and import replace current data, so create a backup first. JSON exports
do not include access tokens.

See [Data and backups](docs/data-and-backups.md) for paths, formats, recovery,
and operational checks.

## Release status

See the [release checklist](docs/release-checklist.md) for automated and
real-client evidence, known limitations, and retry commands. The release must
not be described as “fully accepted by all three clients” unless every field in
all three evidence files is `true`.

The current candidate has **not** reached full three-client acceptance. In the
isolated smoke run, Codex was blocked by `spawn EPERM`; Claude was not invoked
because no credential source could be safely isolated. Kimi Code completed tool
discovery, identity registration, project read, progress write, and activity
verification inside an isolated temporary HOME, with every field passing and
the global client configuration unchanged. Passing server, tool-contract, and
browser automation still does not prove that every real model client completed
a write.

## More documentation

- [Web development](web/README.md)
- [Agent setup](docs/agent-setup.md)
- [Data and backups](docs/data-and-backups.md)
- [Release checklist](docs/release-checklist.md)
- [Full design specification](docs/superpowers/specs/2026-07-29-project-os-full-stack-mcp-design.md)
- [Implementation plan index](docs/superpowers/plans/2026-07-29-project-os-full-stack-index.md)

## Security boundary

- Do not commit tokens, databases, backups, real exports, or private client
  configuration.
- `VITE_*` values are embedded in frontend output and cannot hold secrets.
- A non-loopback bind requires `PROJECT_OS_ALLOWED_HOSTS`; cross-origin Web
  clients also require `PROJECT_OS_ALLOWED_ORIGINS`.
- External access requires a trusted reverse proxy for TLS, rate limiting, and
  network access control.
- This repository currently has no open-source license. Public visibility does
  not automatically grant copying or redistribution rights.
