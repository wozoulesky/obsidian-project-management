# 数据与备份指南

Project OS 使用 Node.js 内置 SQLite 驱动。REST、Web、stdio MCP 和
Streamable HTTP MCP 只要指向同一路径，就会共享同一份持久化数据。

## 默认路径与环境变量

| 内容 | 默认路径/变量 |
|---|---|
| 主数据库 | `data/project_manage.db` |
| SQLite WAL 辅助文件 | `data/project_manage.db-wal`、`data/project_manage.db-shm` |
| 备份目录 | `data/backups` |
| API 数据库覆盖 | `PROJECT_OS_DATABASE_PATH` |
| stdio 数据库覆盖 | `PROJECT_OS_DB`，否则使用 `PROJECT_OS_DATABASE_PATH` |
| 备份目录覆盖 | `PROJECT_OS_BACKUP_ROOT` |

API 的相对路径从仓库根目录解析；stdio 的相对路径从启动进程的当前目录解析。
生产或多客户端环境建议使用规范化绝对路径，避免意外产生两份数据库。

数据库启用 WAL 和外键约束。运行中不要只复制主 `.db` 文件；使用设置页/API
创建一致性备份，或在服务完全停止后一起处理数据库及其 WAL 辅助文件。

`data/` 已被版本控制忽略。数据库、备份和业务 JSON 不应提交到仓库。

## 创建与恢复备份

Web 设置 → **数据**：

1. 选择“创建备份”。
2. 记录界面返回的文件名；文件位于 `PROJECT_OS_BACKUP_ROOT`。
3. “恢复此备份”只恢复本次界面已知的备份，并要求确认。

REST：

```text
POST /api/v1/backups
POST /api/v1/backups/restore
```

创建请求可省略 JSON 正文，由服务生成唯一 `.sqlite` 文件名；也可提供安全的
`filename`。恢复正文必须提供备份目录中的文件名，不能使用任意路径。

恢复会替换当前数据库内容并记录活动。操作前：

1. 停止其他写入者或安排维护窗口；
2. 为当前状态再创建一份备份；
3. 执行恢复；
4. 刷新 Web，并检查健康、关键记录和活动日志。

备份目录应由操作系统权限保护，并复制到独立介质。项目没有自动保留策略、
加密或异地复制，需由部署者配置。

## JSON 导出与导入

Web 设置页提供“导出 JSON”和“导入 JSON”。REST 端点：

```text
GET /api/v1/export
POST /api/v1/import
```

导入要求：

- `multipart/form-data`；
- 单一文件字段名 `file`；
- 文件媒体类型 `application/json`；
- 最大 25 MiB；
- 文档必须符合当前导出结构，并保留当前本地操作者身份。

导入在事务中替换 actors、projects、project members、tasks、requirements、
defects、sessions、handoffs、deliverables 和外观设置，并保留兼容的活动审计锚点。成功响应会返回各业务集合数量。
验证失败不会部分导入。

JSON 导出包含业务记录和外观设置，但不包含访问令牌、令牌摘要或完整活动历史。
它适合迁移业务记录，不替代完整 SQLite 灾难恢复备份；令牌元数据、审计历史和
完整数据库级状态应通过 SQLite 备份保留。

## 令牌数据

令牌明文只在签发响应和设置页中显示一次。数据库只保存摘要和元数据，备份也
无法恢复明文。请把明文放入专用秘密管理器，不要放入：

- 源码、Markdown、Issue 或聊天记录；
- `.env` 或客户端配置的已跟踪副本；
- JSON 导出和测试快照。

丢失明文时应撤销旧令牌并签发新令牌。恢复旧数据库备份可能恢复当时的令牌
撤销状态，恢复后必须复核令牌列表并撤销不再需要的凭据。

## 验证与灾难恢复演练

恢复或迁移后至少检查：

1. `GET /api/v1/health` 返回数据库正常；
2. Web 项目、负责人和任务数量符合预期；
3. 默认连接验证仍报告 27 tools；
4. Agent 配置指向恢复后的数据库路径；
5. 创建一份新的备份并验证它位于预期目录。

连接验证：

```bash
npm run build
node integrations/project-os/scripts/verify-connection.mjs
```

建议定期在隔离目录演练：复制备份、用临时
`PROJECT_OS_DATABASE_PATH`/`PROJECT_OS_BACKUP_ROOT` 启动、检查数据，然后
销毁临时环境。不要用生产数据库做首次恢复演练。

## 常见问题

- **启动后出现另一套演示数据**：通常是 API 与 stdio 使用了不同的相对路径。
- **备份恢复失败**：确认文件在配置的备份根目录、名称以 `.sqlite` 结尾，并且
  当前进程具有读写权限。
- **导入被拒绝**：检查 25 MiB 上限、字段名、媒体类型、JSON 结构和本地操作者
  身份是否一致。
- **数据库锁或损坏警告**：立即停止写入，保留数据库及 WAL 辅助文件，用最近
  的已验证备份恢复；不要直接编辑 SQLite 二进制文件。
