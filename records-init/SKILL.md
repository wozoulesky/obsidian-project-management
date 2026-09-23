---
name: records-init
description: >-
  【是什么】给当前项目一键建记录骨架：`records/SPEC.md`（草稿）+ `records/任务计划.md` + `records/变更/.gitkeep`。
  本 skill 是 `project-records` 的子 skill，只管「建骨架」这一件事；骨架建好之后的 SPEC 起草、变更认领、
  收尾流程走父 skill。
  【何时用】用户说 `/records-init`、`records-init`、「初始化记录」，或新项目要开工但还没有 `records/` 时。
  【何时不用】项目已有 `records/`（改走父 skill 的常规流程）；记录根本身在 Vault 里的项目目录（那不是本子 skill 的范围）。
---

# 初始化记录（records-init）

在**当前项目目录**建最小骨架：**只补缺、不覆盖、可重复运行**；不碰 Vault、不动 `.gitignore`、不 `git add`。

## 怎么跑

脚本在**父 skill 的 `scripts/`**（本文件所在目录的 `../scripts/`）：

```bash
# <skill-dir> ＝ project-records skill 的根目录（本子 skill 位于 <skill-dir>/records-init/）
bash <skill-dir>/scripts/init-records.sh                    # 不传目录＝当前 git 仓库根（没有 git 就用当前目录）
bash <skill-dir>/scripts/init-records.sh /path/to/project    # 或指定项目目录
powershell -NoProfile -File <skill-dir>\scripts\init-records.ps1 [-Path C:\path\to\project]
```

跑之前先看 `records/` 在不在：已在的跑一遍读 skipped 清单即可，**不要为了重跑而删目录**。

## 落盘

| 文件 | 初始内容 |
| --- | --- |
| `records/SPEC.md` | 草稿，`状态: 待确认`（模板见 `../scripts/skeleton/SPEC.md`） |
| `records/任务计划.md` | 阶段表空表（模板见 `../scripts/skeleton/任务计划.md`） |
| `records/变更/.gitkeep` | 空占位；**不受「变更目录只允许五种文件名」约束**——那条管的是 `变更/<日期 主题>/` 内部 |

## 建完之后（交回父 skill）

1. 起草 `SPEC.md` 的「系统是什么」「当前阶段与范围」，请用户确认；
2. 按父 skill「开发流程」认领第一个变更；
3. 是否把 `records/` 纳入版本控制由用户与 Agent 协商（本子 skill 不规定）；
4. 向用户回报新建/跳过的文件清单。
