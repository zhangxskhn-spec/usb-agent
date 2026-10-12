# U 盘 AI 助手（便携版）

把 **Claude Code** + **网页界面**装进 U 盘：插到任意 Windows 电脑，双击 `START.bat` 就能用 AI。
模型走 **MiMo（小米）** 与 **DeepSeek** 双通道，配置、会话、记忆全部存在 U 盘内，随身携带、不污染别人的电脑。

> 本包在开源 **CloudCLI**（`@cloudcli-ai/cloudcli`）基础上做了三层定制：
> 前端注入器、服务端补丁、本地模型网关。定制点全账见 [`patches/README.md`](patches/README.md)。

---

## 仓库包含什么

仓库只保留**定制层源码**（约 4 MB），体积巨大的便携运行时与用户数据不入库：

| 目录 / 文件 | 入库 | 说明 |
|---|---|---|
| `START.bat` | ✅ | 启动器（菜单 + 拉起网关 + 拉起网页/终端） |
| `README.md` `CLEANUP-REPORT.md` | ✅ | 说明与清理记录 |
| `config/keys.env.example` | ✅ | 密钥模板。真实 `keys.env` 含 API Key，已 `.gitignore` |
| `patches/` | ✅ | 前端注入器 `*.js`、服务端补丁、`patches.json` 总账 |
| `tools/` | ✅ | 模型网关 `anthropic-gw.mjs`、自检、构建与修复脚本 |
| `workspace/` | ✅ | Claude 的默认工作目录 |
| `app/webui/` | ✅（仅占位） | 网页壳运行目录，用 `.gitkeep` 保留空目录 |
| `runtime/` | ❌ | 约 1.6 GB：便携 Node.js + CloudCLI + 便携 Git |
| `data/` | ❌ | 运行时产生的用户数据（浏览器 profile、会话、记忆、日志） |

### 克隆后必做两步

1. **填写密钥**（否则 `START.bat` 会报 `Missing config\keys.env` 并退出）：

   ```cmd
   copy config\keys.env.example config\keys.env
   ```

   然后用记事本打开 `config\keys.env`，填入 MiMo / DeepSeek 的 API Key 并保存。

2. **自备运行时目录** `runtime\`：下载便携版 Node.js，把 CloudCLI 装到
   `runtime\node\`（需提供 `node.exe`、`cloudcli.cmd`、`claude.cmd`），
   便携 Git 解压到 `runtime\git\`。目录结构见下方「目录结构」。
   > 这一步体积约 1.6 GB，故未纳入版本库。

3. **（可选）恢复本机免登录**：`patches/frontend/05-local-login.js` 里的令牌已外置，
   源码中只有占位符。想免登录就把令牌写进 `config/local-token.txt`（不入库），
   然后跑 `python tools\build-frontend.py`；不写则照常走注册/登录，不影响使用。

---

## 快速开始

1. 双击 `START.bat`（或 `启动.bat`）
2. 选择 `[1] 网页界面` → 浏览器自动打开聊天界面
3. 用完回到启动器选择 `[0] 退出`，再安全弹出 U 盘

> 第一次启动稍慢（几十秒），之后正常。

## 菜单说明

| 选项 | 作用 |
|---|---|
| [1] 网页界面 | 浏览器图形界面；模型在页面右下角下拉随意切换 MiMo / DeepSeek，无需重开 |
| [2] 终端版 | 命令行界面（Claude Code 原生 TUI），默认 DeepSeek Flash |
| [3] 环境自检 | 一键检查运行时/密钥是否正常 |

## 目录结构

```
usb-agent\
├─ START.bat            主入口（双击这个）
├─ 启动.bat             别名，作用相同
├─ config\
│   ├─ keys.env.example 密钥与模型设置模板（入库，值为空）
│   └─ keys.env         填入真实密钥后由启动器读取（不入库，已 gitignore）
├─ patches/            前端注入器源码 + 定制点总账（改界面改这里，勿改 bundle）
├─ runtime\
│   ├─ node\            便携 Node.js（含全局安装的 Claude Code 与网页壳）
│   └─ git\             便携 Git（Claude Code 依赖的 Git Bash）
├─ data\                所有数据，随身携带
│   └─ home\            重定向后的用户目录（.claude 配置、会话、缓存）
├─ app\
│   └─ webui\           网页壳运行目录
├─ tools\
│   ├─ selfcheck.bat    环境自检
│   ├─ anthropic-gw.mjs 本地模型网关（MiMo/DeepSeek 自动路由，默认从 4567 起选空闲端口）
│   └─ build-frontend.py 前端界面补丁构建器
└─ workspace\           Claude 的默认工作目录
```

## 换模型 / 换密钥

用记事本编辑 `config\keys.env`（若不存在则先从模板复制：`copy config\keys.env.example config\keys.env`），
保存后下次启动生效：

```ini
MIMO_API_KEY=sk-xxxx          # MiMo 密钥
MIMO_MODEL=mimo-v2.6-flash   # 默认使用 MiMo V2.6 Flash

DEEPSEEK_API_KEY=             # ← 在这里粘贴 DeepSeek 密钥
DEEPSEEK_MODEL=deepseek-flash  # V4.1 Flash（最新）；也可改 deepseek-v4-pro
```

- DeepSeek 密钥获取：https://platform.deepseek.com
- 想加第三个模型（Kimi / GLM / 通义等）：同样的套路，任何「Anthropic 兼容端点」都能接。
- 网页界面里可按会话随时切换模型（见下文「网页壳说明」的模型下拉）；启动器会自动拉起本地模型网关，按模型名自动路由 MiMo / DeepSeek 两个上游。
- **网关是后台静默运行的（不弹任何窗口）**：启动时从 4567 开始寻找空闲端口，窗口会显示实际端口；`tools\stop-gw.bat` 只停止本启动器记录的网关。
- **密钥想与程序分开存放**：把 `keys.env`（或仅密钥那几行）挪到 `data\home\keys.env` 即可——它是数据区覆盖文件，优先级更高；这样拷贝/分享程序文件夹时不会带出密钥。

## 拷到 U 盘

1. 把整个 `usb-agent` 文件夹拷到 U 盘（建议放根目录，文件夹名保持英文）；
2. U 盘建议格式化为 **NTFS**（exFAT 上 Node 运行会明显变慢，FAT32 不支持大文件）；
3. 注意：格式化会清空 U 盘，先备份。

## 注意事项

- **需要联网**：模型在云端，断网无法使用（本地文件操作类功能不受影响）。
- **不需要管理员权限**，不写注册表，不装驱动。
- 数据都在 U 盘 `data\` 里；网页优先使用 U 盘 `data\browser-profile` 的独立 Edge/Chrome 配置，避免把登录令牌写入宿主浏览器；找不到 Edge/Chrome 时才回退系统默认浏览器。
- 杀毒软件 / SmartScreen 首次可能拦截，选择「仍要运行」即可。
- 拔盘前：先回到启动器选择 `[0] 退出`，确认网页和终端已关闭，再安全弹出；不要在请求进行中强拔。

## 网页壳说明（CloudCLI）

- 默认从 `http://127.0.0.1:3001` 开始寻找空闲端口，且**只允许本机访问**（更安全）；端口被占用时启动器会自动选择下一个端口，并显示实际地址；
- **本机免登录**：本包已内置免登录——打开即自动登入本机账号 `zhx`，不会再弹注册/登录页（令牌由本机数据库签发，随 U 盘携带）。万一令牌失效（例如把 `data\home\.cloudcli\` 整个删掉重装），界面会回到注册/登录，此时账号密码自己新设即可（仅用于保护本界面，与模型密钥无关）；
- **切换中文界面**：登录后 → Settings（设置）→ Account（账户）→ Language（显示语言）→ 选择「简体中文」（内置完整中文词条，设置会记住）；
- **聊天里直接选模型**：输入框旁可切换 MiMo V2.6 Flash、DeepSeek Flash 等模型（经本地网关跨通道切换，选择即生效无需重开）；
- **项目管理一体化**：项目行右侧 ⊕ 一键在该项目里新建对话；⋯ 菜单（打开文件夹／重命名／清空对话／移除项目）全部弹窗确认、原地生效零刷新；新建项目完成后自动直接进入新对话；
- 界面已全面汉化（会话菜单、Git 源代码管理面板、斜杠命令描述、Token 统计等）；
- **升级后界面没变化**：把旧标签页关掉重开一次即可（已内置版本化文件名，普通刷新就会加载新版）；顽固时可 `Ctrl + F5`；
- 想让手机/平板在同一局域网里访问：编辑
  `runtime\node\node_modules\@cloudcli-ai\cloudcli\.env`，把 `HOST=127.0.0.1` 改成 `HOST=0.0.0.0` 后重启；
- 网页壳的登录库、会话数据都存放在 `data\home\.cloudcli\` 与 `data\home\.claude\`（随身携带）；
- **普通对话归属**：「新对话」产生的普通问答在数据库里记为便携哨兵 `@plain`（不绑定某台电脑的绝对路径），运行时工作目录自动解析到 `workspace\`——拷到 U 盘换电脑后旧普通对话依然可见、不会被识别成伪项目。从旧版升级后跑一次 `python tools\migrate-plain-chats.py` 即可把历史普通对话一并迁移（`--dry` 可预览）；
- **换电脑/换盘符自动修复**：启动器会先运行 `tools\repair-portable-state.mjs`，把数据库里旧电脑的 Claude JSONL transcript 路径重新定位到当前 `data\home\.claude\projects\`，并修复 U 盘工作区项目与 Claude 信任路径。迁移只改能在当前 U 盘找到的文件，外部电脑项目仍会保留为本机路径；可运行 `runtime\node\node.exe tools\repair-portable-state.mjs --check` 查看状态。
- **Transcript 增量同步**：Claude 会话首次发现后把文件大小、修改时间和相对路径索引保存到 `data\home\.cloudcli\claude-transcript-index.json`。后续扫描只重新解析新增或实际变化的 JSONL，换盘符时按相对路径继续命中；索引损坏会自动回退为完整扫描。
- **清理可重建缓存**：需要腾出 U 盘空间时运行 `runtime\node\node.exe tools\prune-portable-cache.mjs` 先预览，确认后加 `--apply`；加 `--trim-runtime` 会同时删除 Node 依赖里的 source map（不影响运行）。不会清理会话、数据库、登录状态或 workspace。
- 终端版无需任何服务，直接就是 Claude Code 原生界面。

## 界面速查（网页版）

**侧边栏顶部「＋」只有一个，悬停/点击会弹出两个选项**

| 选项 | 作用 |
|---|---|
| 新对话 | 立刻开聊，**不用选文件夹**（日常问答、写文案、分析都选它） |
| 新项目 | 选一个文件夹，让 AI 在这个文件夹里读写代码（走原生创建向导） |

**左侧栏 = 单一列表：项目 + 最近对话**（跟 Claude 一样的布局，无需切换页签）

- 上面是「项目」（绑定了文件夹的任务），下面是「最近对话」（含普通问答）；
- **对话自动命名**：新对话发出第一句话后，自动用这句话给对话起名（手动改过名的不会覆盖）；
- **删除**：左侧栏会话行悬停出现红 **✕** = 删除这条对话；项目行悬停出现 **⋯** = 清空该项目全部对话 / 重命名项目 / 移除项目；
- 每条对话标注所属项目与时间（如"普通对话 · 1 小时前"），点击直接进会话；
- 会话右侧「⋯」菜单：重命名会话 / 派生会话 / 复制会话 ID / 归档或删除会话。

**新建文件夹项目（让它在一个文件夹里干活）**

1. ＋ → 「新项目」→ 弹出"选择文件夹"；
2. 弹窗默认打开 **「此电脑」视图**：桌面 / C 盘 / D 盘 / U 盘工作区 / 文档 / 下载——点盘符逐层进入（点".."返回上一层）；也可以直接在路径框打完整路径，路径不存在会自动创建；
3. 选好文件夹 → "使用此文件夹" → 下一步 → 确认；侧边栏出现项目，点进去开始工作。
   - 想用 U 盘自带的随身工作区：直接点列表里的 **「U 盘工作区」** 即可
   - GitHub URL 一般留空（仅从仓库克隆时才填）

**换到别的电脑**：普通对话和 U 盘内的 workspace 项目会在启动时自动重定位；电脑外部项目（例如原电脑的 `D:\xiazai`）仍绑定原路径，需要在新电脑重新建项目或移除旧卡片。U 盘场景应选择当前盘符下的 `usb-agent\workspace`，不要把 workspace 的子目录误当成独立本机项目。

## 故障排查

- 双击 `tools\selfcheck.bat` 一键体检（Node / Claude Code / Git / 密钥 / 网关 / 前端补丁，含「改了源码忘构建」检测）。
- **启动后浏览器没自动打开**：服务其实已经在跑了，手动访问启动窗口中显示的实际地址即可；端口被占用时不一定是 `3001`。
- **升级过 cloudcli（npm）后界面/功能异常**：依次跑 `python tools\apply-server-patches.py`（重放服务端补丁）和 `python tools\build-frontend.py`（重建前端），再 Ctrl+F5。
- **排查回复速度**：在启动器前临时执行 `set USBAI_PERF=1` 和 `set GW_LOG=1`，再运行 `START.bat`。provider 阶段日志会显示在启动窗口，网关分段日志写入 `data\home\logs\gw.log`；重点看 `sdk.first_assistant_event`（首个模型事件）与网关的 `upstreamHeadersMs` / `firstChunkMs`。诊断完成后关闭这两个环境变量即可。
- 网页打不开：看窗口里提示的端口，再手动访问；重新双击 `START.bat` 时会自动避开占用端口。
- **界面看着"没变化"（菜单/按钮还是旧的）**：浏览器按 `Ctrl + F5` 强制刷新一次。
- 终端模式：输入 `/exit` 退出 Claude Code 回到菜单。
- 提示「还没有配置 xx 密钥」：编辑 `config\keys.env` 填好后重试。

---

*技术栈：Claude Code (npm) · CloudCLI 网页壳 · 便携 Node.js 22 · PortableGit · 全部数据本地化*
