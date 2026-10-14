# usb-agent 定制点总账（patches/）

> 本包在开源 CloudCLI（`@cloudcli-ai/cloudcli`）基础上做了三类定制。
> **收尾约定：所有前端行为改动只改 `patches/frontend/*.js`，然后跑 `python tools/build-frontend.py`；永远不要直接编辑 bundle。**

## 1. 前端注入器（patches/frontend/*.js）

构建脚本按文件名序拼接到底层 bundle（`_base.min.js`，含全部就地汉化与联动修改）尾部，产出
`dist/assets/index-CdjIFxM2.vN.js` 并自动更新 `index.html` 引用（破缓存铁律：每次构建换文件名）。

### 1.1 底层 bundle 的就地补丁（改 `_base.min.js`，已记录在案）

| 位置 | 改动 | 原因 |
|---|---|---|
| 会话归属解析 effect（`Workspace` 组件）：`d?.id!==e&&H.current!==e&&(...)` | 去掉 `d?.id!==e&&`，只留 `H.current!==e` | **CloudCLI 原生 bug，被「普通对话」设计踩中**：侧栏点击会话时先 `setSelectedSession(该条)` 再触发 effect，于是 `d?.id===e` 恒成立，去服务端解析归属的那段**根本不会执行** → `selectedProject` 永远为 null → 右侧永远停在「选择您的项目」占位图。项目会话不受影响（在第一步"在已加载项目里找"就能命中），所以表现为"点项目下的对话正常、点普通对话必卡"。`H.current` 这个去重闩本身已足够防重复请求。2026-10-14 定位，依据：三张复现截图的 URL id 均正确 + `GET /api/providers/sessions/<id>` 实测 200 且返回 U盘工作区 项目。 |

| 文件 | 职责 |
|---|---|
| `00-desktop-prefetch.js` | 启动即取桌面路径（/api/projects/wb-desktop），创建项目向导默认填充 |
| `01-shared.js` | **共享层 window.WB**：WB.modal 弹窗、WB.createSession 建会话+跳转、WB.spaNav、**WB.openSessionSafe（点会话的唯一入口：软跳转 + 「地址没变/主视图没换」整页兜底）**、WB.token、WB.isTouch、WB.onMutate（全包唯一的 MutationObserver，其余注入器一律注册回调，禁止再 new MutationObserver）。<br>**会话链接「首点必达」**：捕获阶段听 pointerdown/pointerup，记下按下的 `a[href*="/session/"]` 对应会话；抬起 120ms 后若地址还没变，就补一次导航。原因：刚打开页面时侧栏列表还在被数据回填重渲染，按下与抬起之间节点被替换，浏览器按规范不会派发 click，表现为「第一次点对话没反应」。带 `[data-wb-action]`（行内改名/删除按钮）与 `[data-wb-pmenu]` 的元素跳过。 |
| `05-local-login.js` | **本机免登录**：启动即把一枚预置长期令牌写入 `localStorage["auth-token"]`，界面不再要求登录；令牌被清（点退出登录/过期）时自动补回并回主界面。令牌由本机 `data/home/.cloudcli/auth.db` 的 app_config JWT 密钥签发（有效期至 2046），随数据目录走。整库重装（密钥变化）后令牌失效，此时照常走注册/登录。**服务端鉴权未做任何改动**（仍校验 JWT）；要恢复登录页：删掉本文件 + 重新构建。<br>**令牌已外置**：源码中写的是占位符 `__WB_LOCAL_TOKEN__`，构建时由 `tools/build-frontend.py` 从 `config/local-token.txt`（不入库）注入。没有该文件时令牌为空 → 走正常注册/登录，不会报错。 |
| `10-date-sep.js` | 「最近对话」按 今天/昨天/更早 分组（apply 自带「无变化零写入」守卫防循环） |
| `20-projects-block.js` | 侧栏「项目」区：项目行（⋯选项菜单＋⊕快捷新建对话）、对话行（时间标签＋✕删除）、空项目「＋ 新建对话」；全部操作原地更新（零刷新，spaNav）<br>**不变量（v51 起）**：删除一条会话必须同时清 `sessionCache[pid]` + `loadedOffsets[pid]` + `sessionMeta.total`（`purgeSession()`）并打墓碑 `deletedSids`。`refreshData()` 会用 `mergeCachedPages()` 把缓存页并回服务端结果，只清 DOM 不清缓存会让删掉的会话被重新并回来（"删了又补上一条"），而徽标取服务端 `total` → 行数比数字多（"条数不对"）；点这种幽灵行的 ✕ 再删，服务端早已无此行 → `HTTP 404`。`reconcileCounts()` 兜底按服务端 `total` 裁掉多余行，删除遇 404 视为"已不存在"本地摘除（自愈）。 |
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
| `tools/anthropic-gw.mjs` | 本地模型网关（127.0.0.1:4567）：按 model 前缀路由 mimo-*→MiMo、其余→DeepSeek；SSE 流式透传；剥 `[1m]` 后缀；keys.env 30s 热重载（config → data/home/keys.env 覆盖）；/health 判活；令牌校验；客户端断连中断上游 + 10 分钟上游超时兜底；`GW_LOG=1` 写请求日志到 data/home/logs/gw.log。<br>**忽略 SIGINT/SIGBREAK**：网关与启动器共享控制台（见 `portable-runtime.mjs`），关黑窗时随控制台被系统终止；但 Ctrl+C 会打到同一个控制台，故显式忽略，避免终端模式按 Ctrl+C 顺手把网关杀掉。 |
| `tools/open-when-ready.bat` | 只做转发的壳：`node tools\open-browser.mjs <端口>`。原来的批处理版有两个坑（找不到 Edge 就 `start <url>` 走系统默认浏览器 → profile 落到被重定向的 LOCALAPPDATA，也就是 **U 盘**上；`start` 出的浏览器脱离控制台，关黑窗带不走、crashpad handler 一直占盘），现已全部由 Node 版承担。 |
| `tools/open-browser.mjs` | 轮询端口就绪再开浏览器（替代固定 ping 延时）。用 `ProgramFiles(x86)/ProgramFiles/真实用户目录` 四处探测 Edge→Chrome，强制 `--user-data-dir=<配置目录>`，**detached:false（共享控制台）**；<br>**⚠ 配置目录默认在本机** `%LOCALAPPDATA%\usb-agent-browser-profile`（`USB_BROWSER_PROFILE` 可改）——早先放在包里时，Edge 残留进程一直握着包里的浏览器数据，U 盘就弹不出来；<br>**⚠ 开完浏览器后本进程必须原地待命**（`setInterval` 保活）——同样是 Job Object：父进程一退出，刚开的浏览器立刻被杀，表现就是「点了 1 什么都没出来」；<br>**⚠ 找不到 Edge/Chrome 的兜底**，用系统默认浏览器时**必须把被重定向到 U 盘的 `LOCALAPPDATA`/`USERPROFILE`/`APPDATA` 还原成真机的**（`spawn` 传 `env`），否则默认浏览器把 profile 建在被重定向的目录（＝U 盘）里，而 Edge 的后台常驻进程关窗口也不退。`--dry-run` 只打印探测结果 |
| `tools/migrate-plain-chats.py` | 一次性幂等迁移：把旧版落在 homedir 绝对路径的普通对话改为 `@plain` 哨兵并删除伪项目行（`--dry` 预览） |
| `tools/repair-portable-state.mjs` | 启动前幂等修复：按当前 U 盘重定位 Claude JSONL transcript、U 盘 workspace 项目和 `.claude.json` 信任路径；`--check` 只检查不写入 |
| `tools/apply-server-patches.py` | 升级 cloudcli 后一键重放全部服务端补丁（幂等；锚点被上游改动时明确告警并指向 pristine 快照手工合并） |
| `tools/make-server-patches.py` | 维护用：有意改动 dist-server/dist 补丁后，对比 unpkg 官方原版重新生成 `patches/server/patches.json` |
| `tools/stop-gw.bat` | 一键停止后台网关（按 4567 监听端口找 PID 并 taskkill） |
| `tools/portable-runtime.mjs` | 端口探测（find-port）与网关启停。<br>**⚠ Windows Job Object 陷阱**：`detached:false` 的子进程会被挂进父进程的 Job，父进程一退出内核就把子进程一起杀掉；而 `detached:true` / `windowsHide` 又会脱离控制台、关黑窗带不走它。两者兼顾的办法是 **`supervise`（常驻监督者）**：它拉起网关后**原地不退出**（由 `START.bat` 用 `start "" /b` 启动、与启动器共享控制台），控制台一关，它和网关一起被系统终止，U 盘才弹得出来。命令：`find-port` / `supervise <端口>` / `start-gateway` / `stop-gateway` / `stop-all` |
| `tools/portable-runtime.mjs` 的 `stop-all` | `[0] 退出` 走它：网关 + 监督者 + 浏览器监督者 + **浏览器本身**。关浏览器用两种方式：命令行里带「包内配置目录」的（覆盖 crashpad）、以及**加载了包内文件的**（Edge 后台常驻 `msedge.exe --no-startup-window` 命令行里一个字路径都没有，只能这样认）。⚠ 扫模块时必须写 `Get-Process` 全量再回来过滤，不能写 `Get-Process msedge,chrome`——chrome 不存在会让整条命令报错退出、结果全空 |
| `tools/release-usb.mjs` | 释放 U 盘：**两轮扫描**——① 命令行/可执行文件里命中**包内** `runtime\`/`tools\`/`app\`/`node_modules\`/`data\` 的进程（只认"命令行提到包根目录"会误杀 IDE——它的命令行常因 cwd 而带上路径，实测把 WorkBuddy.exe 判成了占用者）；② `Get-Process \| $_.Modules` 里加载了本包 DLL/EXE 的进程（命令行看不到路径的那类隐藏占用者，实测抓到过 Edge 子进程）；跳过 cmd/powershell/explorer 等宿主外壳与自身。枚举优先 PowerShell CIM（强制 UTF-8 输出 + GBK 兜底解码，否则中文路径比对永不命中），失败退回 wmic。`--check` 只列出；`--root <path>` 指向别的副本；`--fast` 跳过第二轮 |
| `tools/eject-usb.bat` | release-usb.mjs 的双击入口（启动器菜单 `[4]` 也调它） |
| `tools/runtime-home.bat` | 解析「本机可用的 runtime」并 `set USBAI_RUNTIME=`：A) 包内有 `runtime\node\node.exe` → 就地布局；B) 只有 `runtime.zip`+`runtime.sha256` → 展开到 `%LOCALAPPDATA%\usb-agent-runtime\<sha256前32位>`（`.part` 临时目录 + move，失败回滚）。这是「U 盘上只有 1 个 runtime 文件」的关键，全部 .bat 都改用它而不是硬编码 `%ROOT%\runtime` |
| `tools/deploy-to-usb.mjs` / `.bat` | 一条命令部署到 U 盘：① robocopy `/MIR /MT:32` 同步程序（排除 `runtime`/`data`/`.git`，`/XF` 保护 runtime.zip/sha256）；② `data` 用 `/E /XO` 只补新增；③ 调 `zip-util.mjs` 把 `runtime\` 打成一个 `runtime.zip` 直接顺序写到 U 盘并算 sha256；④ 删掉目标机上旧的 `runtime\` 目录（`--keep-runtime` 可保留，`--inline` 走老布局，`--skip-runtime` 只同步程序） |
| `tools/zip-util.mjs` | **自己写的 zip 打包器**（Node，deflateRaw + 手写 zip 结构，UTF-8 名，无需 zip64）。**不能改用系统 tar.exe 打包**，两个致命坑：① `git/etc/mtab` 是 Git for Windows 的 junction 型 reparse point（目标 `/proc/mounts`），libarchive stat 报 EINVAL 直接让整次打包失败；② 更严重——从祖先目录递归打包时 bsdtar 会**静默丢掉 `git/bin/*`（bash.exe 等）**，目录项在、文件不在、零报错，到了目标机才会发现 Claude Code 的 Bash 废了。解压端仍用 tar.exe（读标准 zip 正常） |
| `tools/forget-runtime-cache.bat` | 清除本机上的 runtime 展开缓存（`%LOCALAPPDATA%\usb-agent-runtime`） |
| `tools/pack-for-usb.mjs` / `.bat` | 把整包（或 `--runtime` 只把 runtime）用系统 `tar.exe` 打成单个 zip，绕过「4.8 万个小文件拷 U 盘极慢」的问题；默认排除 data 缓存/浏览器 profile |
| `tools/sync-to-usb.bat` | `deploy-to-usb.mjs <盘符> --skip-runtime` 的壳：只同步程序文件与 `data`，不动 U 盘上的 runtime（改了补丁后的日常更新） |
| `tools/unpack-on-usb.bat` | 在 U 盘上解开 zip（优先 tar.exe，退回 PowerShell Expand-Archive） |
| `START.bat` | 菜单（网页/终端/自检/释放U盘/退出）+ 自动拉起网关（`start "" /b` **静默无窗口**，验 /health 判活）+ env 指向 4567；`[0] 退出`停网关并提示，`[4]` 调 eject-usb.bat 全量释放。**启动时先 `call tools\runtime-home.bat` 拿到 `%USBAI_RUNTIME%`**，之后全部用它（不再硬编码 `%ROOT%\runtime`），因此 U 盘可以用「只有 runtime.zip」的瘦身布局 |
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
