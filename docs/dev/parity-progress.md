# 对齐任务进度追踪（parity-progress）

> 规则：每完成一个阶段就更新本文件并提交；任何会话接手时，先 `git fetch && git tag --sort=-creatordate | head` 和 `git log --oneline -15` 核对真实进度，只信远端事实。
> 任务规格见 [parity-plan.md](./parity-plan.md)。

## 阶段总览

| 阶段 | 内容 | 状态 | tag |
|---|---|---|---|
| v3.11.0 | 基线核验报告（官方功能→现状→证据）+ 差距确认 | **已完成**（报告见 parity-report-v3.11.0.md；基线复跑全绿：build 6/6、图标 88/88、单测 14/14、e2e 73/73） | v3.11.0 |
| v3.11.1 | P0-A 脚本工作台骨架 + 执行控制 + 日志 | 未开始 | — |
| v3.11.2 | P0-B 缺失步骤类型（wait/install/record/launch强停/loop/condition + 步骤公共字段） | 未开始 | — |
| v3.11.3 | P1 智能拾取 + 魔法变量 + 批量执行 + 模板库 | 未开始 | — |
| v3.12.0 | 超越项 1/2/3/5（AI 生成脚本 / 录制成脚本 / 断点续跑 / dry-run） | 未开始 | — |
| v3.12.1 | 网页端完整 CRUD + 脚本工作台 + 群控 + 镜像增强 | 未开始 | — |
| v3.12.2 | 网页端安全 / 移动端 / 实时性 + 人性化全量 | 未开始 | — |
| v3.13.0 | 官方级群控镜像（多设备同屏广播）+ 多屏协同增强 + 镜像内启动 App | 未开始 | — |

## 基线事实（2026-11-25 本地核验，可复现）

- 基线 commit：v3.10.2（b683ede8，main，远端 CI 全绿：build #29/#30、release #10、29 资产）。
- e2e：**73 项检查**（场景 S1–S13，`tests/e2e/run-e2e.mjs`）。
- executor 步骤类型：**18 种**（见 plan 第 2 节清单）。
- 页面：7 个（control / copilot / explorer / tasks / terminal / mirror / group-control）。
- web 端点：18 个（/api/chat、/api/devices、/api/login、/api/mirror/*×6、/api/runs、/api/sessions、/api/status、/api/tasks、/api/workflows 等）。
- 文案落地率（hyphen-aware 重跑）：automation 170 总 / 30 引用 / **140 未引用**；mirror 31 / 5 / **26 未引用**；device.control 128 / 114 / **14 未引用**。
- grep 确认缺失：wait/install/record/loop/condition 步骤类型、launch 强停、delayBefore/loopCount/randomRange、单步执行/执行选中/暂停/继续（脚本级）、魔法变量、批量执行变量注入表、脚本模板库、镜像窗口多设备同屏、首用指引、撤销重做、dry-run、脚本版本历史。

## 会话日志

- **2026-11-25（会话 A）**：克隆 v3.10.2；创建 2 小时定时续做提醒（cron 兜底）；重跑第 2 节核验（数据见上）；plan + progress 文档入库；依赖安装后台进行中（setsid + npmmirror 镜像，integrity 校验与 CI 等价）。待办：本地 build/单测/e2e 基线复跑 → parity-report → tag v3.11.0。
