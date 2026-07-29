# Kimi Code configuration

Build Project OS first. Create `.kimi-code/mcp.json` in the Project OS root and
replace `E:/project_manage` if the checkout lives elsewhere:

```json
{
  "mcpServers": {
    "project-os": {
      "command": "node",
      "args": [
        "E:/project_manage/apps/mcp/dist/stdio.js"
      ],
      "env": {
        "PROJECT_OS_DB": "E:/project_manage/data/project_manage.db"
      }
    }
  }
}
```

Restart Kimi Code after saving the project configuration. Keep local executable
and database paths in this file; do not add bearer tokens or other secrets.
