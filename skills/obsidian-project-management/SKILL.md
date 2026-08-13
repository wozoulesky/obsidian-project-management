---
name: obsidian-project-management
description: Use when starting, planning, implementing, reviewing, pausing, or handing off a software-development task that must be tracked in the local Obsidian vault, especially when scope, progress, verification, or ownership could drift between agents.
---

# Obsidian Project Management

Treat `E:\obsidian_warehouse` as the source of truth for local project coordination. Keep one project per folder, one task per task file, and use `SPEC.md` to prevent unapproved scope drift.

## Required layout

```text
E:\obsidian_warehouse\
├─ 软件开发\<项目名>\
│  ├─ README.md
│  ├─ SPEC.md
│  ├─ 任务计划.md
│  ├─ 任务\<任务-ID> <任务名>.md
│  ├─ handoff\YYYY-MM-DD <主题>.md
│  ├─ 决策\
│  └─ 日志\
└─ 每日数据抓取\YYYY-MM-DD\
   ├─ 数据.md
   ├─ 来源.md
   └─ 运行日志.md
```

Create a project from the Vault templates at `软件开发\模板` when it does not exist. Use `每日数据抓取\模板` only for date-based data collection; never put development progress there.

Read [vault-templates.md](references/vault-templates.md) before creating a project, task, handoff, or collection-day record.

## Development lifecycle

### 1. Before work

1. Locate the project under `软件开发`.
2. Read `README.md`, `SPEC.md`, `任务计划.md`, and the target task file.
3. Check the task frontmatter. If another agent owns a task in `进行中` state, do not overwrite it; choose another task or ask for coordination.
4. Set the target task to `进行中`, set `负责人` to the current agent identity, update `最后更新`, and add a timestamped entry to `进度记录` explaining what was read and what will be done.

Do not start implementation without a SPEC. If one is absent, create a draft and ask the user to approve it before implementing beyond exploration.

### 2. Keep work aligned

Use `SPEC.md` as the test of scope:

- Deliver only work required by `范围` and `验收标准`.
- Treat `非目标` and `约束` as hard boundaries.
- If the latest explicit user instruction conflicts with the SPEC, record that instruction in `范围变更记录`, revise the relevant SPEC sections, and then continue.
- If scope is unclear or materially expands without an explicit user instruction, stop implementation, record the question under the task's `阻塞与风险`, and ask the user.

Update `进度记录` when a meaningful decision, blocker, verification result, or change in plan occurs. Keep task plans specific and ordered; update `任务计划.md` when dependencies, phases, or priorities change.

### 3. Close or transfer work

Before declaring work complete or stopping for any reason:

1. Record verification commands, outputs, review evidence, or the reason verification could not run in `验收`.
2. Update `状态`, `最后更新`, `阻塞与风险`, and `下一步` in the task file.
3. Create a new handoff file in `handoff/`, even for a blocked task. State completed work, unfinished work, exact next step, verification evidence, risks, and any SPEC deviation.
4. Link the handoff from the task file.

Use `已完成` only when the task's relevant SPEC acceptance criteria have evidence. Use `受阻` when external input or a decision is needed. Never silently mark incomplete work as complete.

## Daily data collection

For a data collection run, create `每日数据抓取\YYYY-MM-DD\` and copy the three templates. Record the output in `数据.md`, every source or local input in `来源.md`, and commands, times, errors, and results in `运行日志.md`.

## Non-negotiable rules

- Do not store project status only in chat; write it to the Vault.
- Do not modify another agent's active task record except to add a clearly attributed coordination note.
- Do not rewrite or remove earlier progress and handoff records; append corrections with timestamps.
- Do not treat a code change as task completion without SPEC-based verification.
- Do not create a second source of truth in Project OS, a database, or a private scratch file.
