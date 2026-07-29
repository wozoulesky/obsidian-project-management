# Codex configuration

Build Project OS first, then replace `E:/project_manage` below with the
normalized absolute project root if the repository lives elsewhere.

Add this entry to the Codex MCP configuration:

```toml
[mcp_servers.project-os]
command = "node"
args = ["E:/project_manage/apps/mcp/dist/stdio.js"]
env = { PROJECT_OS_DB = "E:/project_manage/data/project_manage.db" }
```

Restart the Codex session after changing MCP configuration. The executable and
database paths are local paths; the Agent ID is returned by registration and is
not a bearer token or secret.

To check the same paths before starting Codex:

```powershell
$env:PROJECT_OS_ROOT = "E:/project_manage"
node "$env:PROJECT_OS_ROOT/integrations/project-os/scripts/verify-connection.mjs" `
  --root "$env:PROJECT_OS_ROOT"
```
