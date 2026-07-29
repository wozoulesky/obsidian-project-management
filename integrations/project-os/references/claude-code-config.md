# Claude Code configuration

Build Project OS first. Replace `E:/project_manage` with the normalized absolute
project root when needed.

Register the project-local stdio server:

```powershell
claude mcp add --transport stdio --env PROJECT_OS_DB=E:/project_manage/data/project_manage.db project-os -- node E:/project_manage/apps/mcp/dist/stdio.js
```

Use `claude mcp list` to confirm discovery, then start a new Claude Code session
in the project. The command uses stdio directly and contains no authentication
token.

For a different checkout, parameterize the command in PowerShell:

```powershell
$env:PROJECT_OS_ROOT = "E:/another/project_manage"
claude mcp add --transport stdio `
  --env "PROJECT_OS_DB=$env:PROJECT_OS_ROOT/data/project_manage.db" `
  project-os -- node "$env:PROJECT_OS_ROOT/apps/mcp/dist/stdio.js"
```
