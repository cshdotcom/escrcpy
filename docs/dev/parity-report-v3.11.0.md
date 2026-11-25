# v3.11.0 基线核验报告：官方 v3.3.1 功能对齐 · 差距确认

> 生成时间：2026-11-25 · 核验人：开发代理（本地全量重跑，未采信任何口头结论）
> 基线：**v3.10.2**（main = b683ede8，远端 CI 全绿）
> 任务规格：[parity-plan.md](./parity-plan.md) · 进度：[parity-progress.md](./parity-progress.md)

## 0. 核验环境与可复现命令

| 项 | 值 |
|---|---|
| 环境 | Linux 沙箱，Node v24.22.3，git 2.47.3，Xvfb present |
| 包管理 | `corepack prepare pnpm@12.21.0 --activate`（与 CI 一致） |
| 安装 | `pnpm install --frozen-lockfile --network-concurrency=32`（registry 走 npmmirror，integrity 由 lockfile sha512 保证，与 CI 内容等价） |
| 构建门禁 | `pnpm exec turbo build`（CI zero-error gate 同款） |
| 图标门禁 | `node scripts/check-icons.js` |
| 单元测试 | `node --test tests/unit/mirror.test.mjs` |
| E2E | `node tests/e2e/run-e2e.mjs`（真实构建产物 + Xvfb + fake adb :5037/:5038 + mock LLM :5039/:5040 + CDP 驱动） |
| 文案落地率 | 见第 2 节脚本（hyphen-aware 正则 `(?:automation|mirror|device|copilot)\.[\w-]+(?:\.[\w-]+)*`；官方原脚本 `\w+` 会漏掉 `mirror-group.*`、`volume-*` 等连字符 key，造成假阴性 8 条） |

## 1. 本地构建基线（全部重跑验证）

| 门禁 | 结果 | 说明 |
|---|---|---|
| `pnpm install --frozen-lockfile` | ✅ 4m06s 完成 | lockfile 未做任何修改（pnpm 12 双文档格式保持原样） |
| `pnpm exec turbo build` | ✅ 6/6 tasks，零错误 | 全部页面 + workspace 包构建成功 |
| `node scripts/check-icons.js` | ✅ 88/88 | 图标门禁全过 |
| `node --test tests/unit/mirror.test.mjs` | ✅ 14/14 | scrcpy 帧解析、控制消息编码、键位映射校验 |
| `node tests/e2e/run-e2e.mjs` | ✅ **73/73** | S1–S13 全场景通过（对话重连、定时任务、群控广播、OpenCV 识图、多设备 AI、内嵌镜像、工作流画布、网页端） |

**结论：v3.10.2 的"73 项 e2e 全绿"声明与事实一致（本地独立复跑通过）。**

## 2. 文案落地率（hyphen-aware 重跑）

| 前缀 | 总数 | 已引用 | 未引用 | 落差 |
|---|---|---|---|---|
| `automation.*` | 170 | 30 | **140** | 官方自动化脚本编辑器整页缺失 |
| `mirror.*` | 31 | 5 | **26** | 多设备同屏 + 首用指引 + 输入条 + 快捷键文案缺失 |
| `device.control.*` | 128 | 114 | **14** | 文件管理器细节、音量命名、"去查看"、启动设置、多屏提示 |

方法学说明：
- 本仓库 zh-CN.json 共 **1585 条**（官方 deb 为 1305 条；差额为 fork 自身新增 key：device.schedule.*、tasks.*、group.*、copilot.settings.* 等）。`automation.*`（170）与 `mirror.*`（31）计数与官方**完全一致**，证明官方这两组 key 在 fork 中原样保留、未被实现。
- `device.control.*` 本地 128 vs 官方 130，差 2 条（本地文件不含）→ 待官方 deb 下载复核（open item，见第 10 节）。
- `device.schedule.*`（计划任务 30+ 条未引用）与 `copilot.config/check/batch` 等未引用 key 属于**上游公开源码遗留文案**，已被本 fork 的 tasks 模块与自研 Copilot 替代实现，不计入对齐缺口。

## 3. 执行器步骤类型对表（executor.js `case`）

**已有 18 种**：`tap` `swipe` `input_text` `key` `shell`（=官方 command）`open_app`（=launch，无强停）`screenshot` `wait_image` `match_image` `notify` `http` `list_devices` `get_device_info` `get_ui_layout` `broadcast_tap` `broadcast_key` `broadcast_input_text` `broadcast_screenshot`

**对照官方 1.1 的缺口**：

| 缺口 | 官方语义 | 影响 |
|---|---|---|
| `wait` 步骤 | 纯延时步骤类型 | P0-B |
| `install` 步骤 | APK 路径 + 可选先卸载（`adb install -r` / `pm uninstall`） | P0-B |
| `record` 步骤 | screenrecord，来源=屏幕/摄像头、时长、保存目录 | P0-B |
| `loop` 步骤 | 循环次数包裹子步骤 | P0-B |
| `condition` 步骤 | 条件分组：图像存在/设备在线/变量比较 | P0-B |
| `launch` 强停 | `am force-stop` 后再 `monkey -p ... 1` | P0-B |
| 步骤公共字段 | `delayBefore` / `loopCount` / `randomRange`（坐标 n×5px、时间 n×500ms，0=禁用） | P0-B |

## 4. 官方「自动化脚本编辑器」能力对照（1.1 → 现状 → 证据）

| 官方能力 | 现状 | 证据 |
|---|---|---|
| 脚本管理（列表/新建/删除确认/保存/按设备） | ❌ 缺 | 无 `pages/automation/`；tasks 模块是"定时任务+工作流"，非按设备的可编辑脚本 |
| 导入导出（替换确认） | ❌ 缺 | 无 automation.script.import/export 实现 |
| 步骤类型 10 种 + 公共字段 | 部分 | executor 18 种见第 3 节；`delayBefore/loopCount/randomRange` 全缺（grep MISS） |
| 步骤分组（基础/条件/扩展） | ❌ 缺 | 无 group.basic/conditional/extended 引用 |
| 识图判断（imageMatch 挂任意步骤） | ✅ 已有 | v3.9.0：templatePath/threshold/followMatchPoint/未匹配跳过（e2e S11.5 实测 TM_CCOEFF_NORMED） |
| 智能拾取（实时截图裁剪/取坐标/画轨迹） | ❌ 缺 | 模板上传+即时测试有；`automation.picker.*` 0/2 引用 |
| 执行控制（单步/选中/全量/暂停/继续/停止/状态机） | ❌ 缺（任务级有启停） | `automation.run.*` 0/14 引用；grep 单步/暂停（脚本级）MISS |
| 执行日志（独立面板/清空/逐条状态） | 部分 | 任务运行历史有（run-history + /api/runs），非脚本执行日志面板 |
| 批量执行（变量注入表格/添加行/终止） | ❌ 缺 | `automation.batch.*` 0/8 引用 |
| 魔法变量（自定义 CRUD/内置 4 种/{var} 语法） | ❌ 缺 | `automation.magic.*` 0/22 引用；grep 无 {var} 解析器 |
| 模板库（4 套官方模板/从模板创建） | ❌ 缺 | `automation.template.*` 0/18 引用 |
| 内置按键（返回/删除/回车/主页/菜单/电源/最近任务/音量±） | 部分 | group-control 窗口有部分按键；脚本步骤的 key 选择器无内置键位表 |

## 5. 官方「群控镜像」能力对照（1.2 → 现状 → 证据）

| 官方能力 | 现状 | 证据 |
|---|---|---|
| 单窗口承载 N 台设备 + 「打开所有设备」 | ❌ 缺 | mirror 窗口单设备（session.js 每设备一条 session）；`mirror.devices`/`mirror.header.openAllDevices` 0 引用 |
| 主控手势广播到设备组 | 部分 | group-control 窗口可广播（无视频画面）；mirror 窗口不广播 |
| 首次使用三步指引（可不再提示） | ❌ 缺 | `mirror.guide.*` 0/15 引用 |
| 置顶/取消置顶、全屏/退出全屏 | ✅ 已有 | v3.10.0 镜像窗口体验（但 `mirror.header.exitAlwaysOnTop/exitFullscreen` 文案用的是自有 key） |
| 输入条 + Enter 发送 + 关闭 | ❌ 缺 | `mirror.input.*` 0/4 引用 |
| 返回/主页/最近任务快捷键 | ✅ 功能有 | v3.10.0 快捷指令（文案用自有 key） |
| 连接中/已断开/重新连接 | ✅ 已有 | 连接状态/错误重试（v3.10.0） |
| 技术底座 | ✅ 已有 | WebCodecs optimizeForLatency + CSD 拼接 + 丢帧保护 + konva + scrcpy:* 通道（e2e S12 实测） |

## 6. 官方 device.control 缺口（14 条未引用）

| key | 官方语义 | 现状 |
|---|---|---|
| `capture.success.message` | 截图成功后"是否前往截屏位置查看" | ❌ 只提示成功，无"去查看" |
| `file.manager.select.all/invert/none` | 全选/反选/取消全选 | ❌ 缺 |
| `file.manager.rename.success` | 重命名成功 | ❌ 缺重命名 |
| `file.manager.download.failed` / `upload.current.file` | 下载失败/上传进度 | ❌ 缺 |
| `file.push.error` | 推送文件失败重试提示 | ❌ 缺 |
| `gnirehtet.stop.success` | 停止服务成功 | ❌ 缺 |
| `launch.settings` | 启动设置（目标窗口选择） | ❌ 缺 |
| `mirror-group.open/close/tips/appClose.tips` | 多屏协同开窗数/关闭/ROM 兼容提示 | 部分：v3.10.2 已实现多屏协同主体（`mirror-group.name` 已引用），细节提示文案 4 条待接 |

## 7. 官方 Copilot 对等性（1.4，非 1:1 对象）

自研版**强于官方**：多供应商 + 自定义 baseUrl/model/apiKey、工具循环、定时任务、上下文压缩、多设备对话、网页端同步、断线重连与错误隔离（e2e S3/S10 实测）。官方走 api.moark.com 网关无自定义入口。维持"不弱于官方"的验收口径即可，无新增缺口。

## 8. 网页端现状（18 端点实测）

已有：设备列表 / 会话列表+删除 / 对话（SSE 流式+中止）/ 任务列表+运行+启停 / 运行历史 / 工作流列表+运行 / 镜像（状态+启动+停止+控制+SSE 码流+键位方案）/ 登录。
缺口（对齐第 5 节目标）：任务/工作流/脚本的**创建与编辑**（无 POST-create/PUT）、脚本工作台、群控面板、多设备同屏镜像、会话重命名/搜索/导出、消息重发/编辑、多模态上传、运行历史详情（每步耗时/IO）、供应商设置修改（apiKey 不回显）、移动端适配、SSE 心跳+断线重连、密码 bcrypt/限流/只读模式、空态/骨架/深色/i18n。

## 9. 差距汇总 → 交付映射

| 差距 | 规模 | 计划 tag |
|---|---|---|
| automation 页面整页 + 执行控制 + 日志（140 条文案的工作清单已全部列于核验脚本输出，按 batch/magic/picker/run/script(s)/state/step/template 分组） | 大 | v3.11.1 (P0-A) |
| wait/install/record/launch强停/loop/condition + delayBefore/loopCount/randomRange | 中 | v3.11.2 (P0-B) |
| 智能拾取 / 魔法变量 / 批量执行 / 模板库 | 中 | v3.11.3 (P1) |
| AI 生成脚本 / 录制转脚本 / 断点续跑 / dry-run | 中 | v3.12.0 |
| 网页端 CRUD + 工作台 + 群控 + 镜像增强 | 大 | v3.12.1 |
| 网页端安全/移动端/实时性 + 人性化 | 中 | v3.12.2 |
| 镜像多设备同屏广播 + 多屏协同增强 + 镜像内启动 App | 大 | v3.13.0 |

## 10. 待复核项（open items）

1. **官方 deb 复核**：重新下载官方 `Escrcpy-3.3.1-linux-amd64.deb`（123,461,804 字节，需 sha256 校验），核对 `device.control.*` 差 2 条 key 与 automation 步骤字段细节（randomRange 官方语义已由本地 locale 佐证）。安排：后台下载，v3.11.1 开工前完成。
2. `automation.step.*` 52 条逐条对应 P0-A/P0-B 的 UI 字段清单（已含本报告第 4 节）。
3. 人性化清单（第 6 节 plan）无既有实现，全部为新增项，随 v3.12.2 验收。

---

**差距确认结论**：官方 v3.3.1 付费功能中，**识图判断、镜像技术底座、多屏协同主体、群控广播（独立窗口）、多设备 AI 已具备**；**自动化脚本工作台整页、5 类步骤类型、智能拾取、魔法变量、批量执行、模板库、镜像多设备同屏、网页端完整 CRUD 为主要缺口**。按 parity-plan 第 9 节节奏推进，v3.11.1 起逐 tag 交付。
