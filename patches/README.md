# usb-agent 定制点总账（patches/）

> 本包在开源 CloudCLI（`@cloudcli-ai/cloudcli`）基础上做了三类定制。
> **收尾约定：所有前端行为改动只改 `patches/frontend/*.js`，然后跑 `python tools/build-frontend.py`；永远不要直接编辑 bundle。**

## 1. 前端注入器（patches/frontend/*.js）

构建脚本按文件名序拼接到底层 bundle（`_base.min.js`，含全部就地汉化与联动修改）尾部，产出
`dist/assets/index-CdjIFxM2.vN.js` 并自动更新 `index.html` 引用（破缓存铁律：每次构建换文件名）。

| 文件 | 职责 |
|---|---|
| `00-desktop-prefetch.js` | 启动即取桌面路径（/api/projects/wb-desktop），创建项目向导默认填充 |
| `01-shared.js` | **共享层 window.WB**：WB.modal 弹窗、WB.createSession 建会话+跳转、WB.spaNav、WB.token、WB.isTouch、WB.onMutate（全包唯一的 MutationObserver，其余注入器一律注册回调，禁止再 new MutationObserver） |
| `05-local-login.js` | **本机免登录**：启动即把一枚预置长期令牌写入 `localStorage["auth-token"]`，界面不再要求登录；令牌被清（点退出登录/过期）时自动补回并回主界面。令牌由本机 `data/home/.cloudcli/auth.db` 的 app_config JWT 密钥签发（有效期至 2046），随数据目录走。整库重装（密钥变化）后令牌失效，此时照常走注册/登录。**服务端鉴权未做任何改动**（仍校验 JWT）；要恢复登录页：删掉本文件 + 重新构建。<br>**令牌已外置**：源码中写的是占位符 `__WB_LOCAL_TOKEN__`，构建时由 `tools/build-frontend.py` 从 `config/local-token.txt`（不入库）注入。没有该文件时令牌为空 → 走正常注册/登录，不会报错。 |
| `10-date-sep.js` | 「最近对话」按 今天/昨天/更早 分组（apply 自带「无变化零写入」守卫防循环） |
| `20-projects-block.js` | 侧栏「项目」区：项目行（⋯选项菜单＋⊕快捷新建对话）、对话行（时间标签＋✕删除）、空项目「＋ 新建对话」；全部操作原地更新（零刷新，spaNav） |
| `30-plus-menu.js` | 顶部唯一的 ＋ 悬浮菜单：「新对话」（home）／「新项目」（原生向导）；失败用 WB.modal 不再 alert |
| `40-autotitle.js` | AI 自动命名：发消息时 + 进入会话时调用 /api/providers/wb-title 生成 ≤12 字中文标题（每会话限 3 次优化，localStorage `wb-atc-<sid>`） |
| `50-unified.js` | 隐藏原生「项目/对话」切换页签（单一列表） |
| `60-brand.js` | 品牌：标题「小张claude」＋官方 Claude 星芒图标（fill #D97757）；隐藏会话头 provider 小图标 |
| `70-fetch-create.js` | fetch 拦截：create-project 成功 → 自动创建该项目会话并 SPA 跳入（调 WB.createSession） |

通用设施全部由 `01-shared.js` 的 `window.WB` 提供：`spaNav(url)`、`WB.modal(opts)`、`WB.createSession(path)`、`WB.onMutate(fn)` 等。改界面行为时优先复用，不要再复制实现。

## 2. 服务端补丁（直接改在 dist-server 源文件内，均已带 `[patched]` 注释）

> 全部补丁已由 `patches/server/patches.json` 精确描述（原版↔补丁逐块对照），
> 升级 cloudcli 后跑 `python tools/apply-server-patches.py` 一键幂等重放，无需照本表手工补。

| 文件 | 定制 |
|---|---|
| `dist-server/.../providers/provider.routes.js` | `POST /wb-title`（AI 标题端点，多候选模型，max_tokens 2048——DeepSeek 思考模型需预算）；`filterModelsByChannel`（v13 起空转：模型全量放出，跨通道由网关解决） |
| `dist-server/.../projects/projects.routes.js` | `POST /wb-open-folder`（资源管理器打开项目文件夹）；`GET /wb-desktop`（桌面路径探测：AI_REAL_USERPROFILE → 注册表回退）；`GET/POST /wb-config`（读 keys.env 配置·密钥脱敏／改 DEFAULT_MODEL，写回到定义它的那个文件） |
| `dist-server/.../shared/utils.js` | `[patched]` 导出 `WB_PLAIN_PROJECT`（'@plain' 哨兵）与 `wbIsPlainProjectPath()`——普通对话判定全服务端统一此一份 |
| `dist-server/.../providers/services/sessions.service.js` | `[patched]` 普通对话 project_path 存 `@plain`（不绑机器绝对路径），运行时由 chat-websocket.service.js 解析为 WORKSPACES_ROOT；`getSessionDetailsById` 给普通对话返回「U盘工作区」项目（path=WORKSPACES_ROOT 真实目录，否则前端 selectedProject 为 null、聊天视图停在占位图）；listRecentSessions 原生去重（项目会话不进最近对话，普通对话始终进） |
| `dist-server/.../projects/services/projects-with-sessions-fetch.service.js` | `[patched]` 项目区/归档视图隐藏普通对话与包内部路径（调 shared/utils.js 的 wbIsPlainProjectPath） |
| `dist-server/.../providers/list/claude/claude-session-synchronizer.provider.js` | `[patched]` 磁盘 jsonl 同步时不覆盖 `@plain` 哨兵归属（换机后归属稳定） |
| `dist-server/.../websocket/services/chat-websocket.service.js` | `[patched]` `@plain` 会话运行时 cwd 解析为 WORKSPACES_ROOT（U盘工作区） |
| `dist-server/.../commands/commands.routes.js` | 内置斜杠命令描述 6 条汉化 |
| `dist-server/.../claude-models.provider.js` | 模型下拉只留「默认（当前通道）」 |
| `dist/sw.js` | `[patched]` activate 时清理缓存里累积的旧版 index-*.js bundle（以 index.html 引用的当前版为准，离线跳过） |

## 3. 独立组件

| 文件 | 职责 |
|---|---|
| `tools/anthropic-gw.mjs` | 本地模型网关（127.0.0.1:4567）：按 model 前缀路由 mimo-*→MiMo、其余→DeepSeek；SSE 流式透传；剥 `[1m]` 后缀；keys.env 30s 热重载（config → data/home/keys.env 覆盖）；/health 判活；令牌校验；客户端断连中断上游 + 10 分钟上游超时兜底；`GW_LOG=1` 写请求日志到 data/home/logs/gw.log |
| `tools/open-when-ready.bat` | 轮询端口就绪后再开浏览器（替代固定 ping 延时），START.bat 启动网页界面时调用 |
| `tools/migrate-plain-chats.py` | 一次性幂等迁移：把旧版落在 homedir 绝对路径的普通对话改为 `@plain` 哨兵并删除伪项目行（`--dry` 预览） |
| `tools/repair-portable-state.mjs` | 启动前幂等修复：按当前 U 盘重定位 Claude JSONL transcript、U 盘 workspace 项目和 `.claude.json` 信任路径；`--check` 只检查不写入 |
| `tools/apply-server-patches.py` | 升级 cloudcli 后一键重放全部服务端补丁（幂等；锚点被上游改动时明确告警并指向 pristine 快照手工合并） |
| `tools/make-server-patches.py` | 维护用：有意改动 dist-server/dist 补丁后，对比 unpkg 官方原版重新生成 `patches/server/patches.json` |
| `tools/stop-gw.bat` | 一键停止后台网关（按 4567 监听端口找 PID 并 taskkill） |
| `START.bat` | 菜单（网页/终端/自检/退出）+ 自动拉起网关（`start "" /b` **静默无窗口**，验 /health 判活）+ env 指向 4567 |
| `config/keys.env` | 密钥与默认模型。可整体或部分挪到 `data/home/keys.env`（数据区覆盖文件，优先级更高）——拷贝/分享程序文件夹时不会带出密钥 |

## 4. 备份位置（包外，原始开发目录下）

备份在 `C:\Users\zhx\WorkBuddy\2026-10-09-22-26-34\usb-agent-bakex\`（即最初 `../usb-agent-bakex/`，包从 WorkBuddy 临时目录拷到桌面后不再相邻）：

- `removed-frontend-versions/`：历版 bundle（原始 index-CdjIFxM2.js 与 v2~v13）
- `assets/`：各阶段 .bak-zh* 汉化备份
- `removed-deps/`：`codex-win32-x64`（248M，OpenAI Codex 二进制，不用 OpenAI 故移除；需要时移回原位）
- `removed-caches/`、`START.bat.bak-v10`、`provider.routes.js`、`projects.routes.js`：对应阶段快照

> 建议：拷 U 盘前把该文件夹一并挪到与 `usb-agent` 同级（或压缩存档），避免依赖 WorkBuddy 临时目录长存。

## 5. 重建/升级流程

1. **npm 升级 cloudcli** 会覆盖 dist 与 dist-server 定制 → 升级后跑 `python tools/apply-server-patches.py`（幂等重放 23 个补丁块，基于 1.37.4 官方原版对照；锚点失配会告警），前端再跑 `python tools/build-frontend.py`。
2. **改前端**：编辑 `patches/frontend/*.js` → `python tools/build-frontend.py` → 浏览器 Ctrl+F5。
3. **改服务端补丁**：直接改 dist-server 源文件（带 `[patched]` 注释）→ 然后跑 `python tools/make-server-patches.py` 重新生成补丁定义 → 重启面板。
4. **自检**：`tools/selfcheck.bat` 会检查补丁完整性和「源码比 bundle 新（忘构建）」。

## 6. 批处理约定（踩过坑，务必遵守）

- **`.bat` / `.cmd` 一律用 GBK(cp936) 编码 + CRLF 换行保存；禁止在批处理里写 `chcp 65001` 或存 UTF-8。**
  cmd 是按字节偏移读取批处理文件的，中途切换码页会让后续行**间歇性错位**，把中文注释的碎片当成命令执行——曾导致 `open-when-ready.bat` 整个失效（浏览器不再自动打开）、START.bat 偶发 `'xx' is not recognized`、项目根多出 `nul)` 垃圾文件。GBK 多字节字符的字节值不含 0x0A/0x0D，解析上天然安全；控制台默认码页就是 936，中文正常显示。Node 子进程（网关/云壳）输出走 Windows 宽字符 API，不受码页影响。
- **批处理判定不要用「`(命令A & 命令B) | findstr … && 成功 || 失败`」**：括号组里失败命令的退出码会污染整条链，导致随机误报（曾让自检随机显示「MiMo: 未配置」）。改用「单命令 + `&& set "FLAG=1"` + `if defined FLAG`」的确定性写法。
- 改完 .bat 后用 `tools/selfcheck.bat` 跑几次确认无 `not recognized` 输出，并检查根目录有无 `nul)` 之类垃圾文件。
