# usb-agent 清理报告（上 U 盘前）

> 扫描时间：2025-10-11
> **清理状态：已完成 ✅**
>
> | | 清理前 | 清理后 | 回收 |
> |---|---:|---:|---:|
> | **总计** | 2062 MB | **1831 MB** | **−231 MB** |
> | data | 425 MB | 174 MB | −251 MB |
> | runtime | 1653 MB | 1653 MB | 未动 |
>
> **剩余 1831 MB 构成**：runtime 1653（node_modules 1178 + git 392 + node.exe 83）+ data 174（browser-profile 130 + home 44）+ patches 3.7 MB。
>
> 若要进一步瘦身，见文末「可选：进一步瘦身」——删 `runtime/git` 可再省 392 MB。

---

## 一、当前体积构成

| 目录 | 体积 | 文件数 | 说明 |
|---|---:|---:|---|
| `runtime/` | 1653 MB | 47858 | 运行时（node + git + 应用本体） |
| ├─ `runtime/node/node_modules` | 1178 MB | 38228 | 应用依赖包 |
| ├─ `runtime/node/node.exe` | 83 MB | 1 | 内置 Node 22 |
| └─ `runtime/git` | 392 MB | 9610 | PortableGit |
| `data/` | 425 MB | 3656 | 运行数据（home + 浏览器配置 + 缓存） |
| ├─ `data/home` | 251 MB | — | 用户数据 |
| │   ├─ `home/AppData` | 177 MB | — | **Edge 浏览器运行时数据** |
| │   ├─ `home/temp` | 71 MB | — | **临时目录** |
| │   ├─ `home/.claude` | 2 MB | — | 对话记录（重要） |
| │   └─ `home/.cloudcli` | 0.9 MB | — | auth.db + 配置（重要） |
| └─ `data/browser-profile` | 174 MB | — | **内置 Chromium 配置 + 缓存** |
| `patches/` | 3.7 MB | 29 | 补丁源码 + 快照（工具依赖，勿删） |
| `tools/`, `config/`, `workspace/` | ~0.1 MB | — | 脚本/密钥/工作区 |

---

## 二、可安全删除项（预计回收 ~330 MB）

### A. 缓存类（**工具已内置**：`node tools/prune-portable-cache.mjs --apply`）

dry-run 结果：**可回收 120.4 MB**

| 项目 | 体积 | 说明 |
|---|---:|---|
| `data/home/temp/sogou_updater_pkg13836_9650/` | **69 MB** | 搜狗输入法升级包残留（一个 72MB 的 .exe），完全无用 |
| `data/browser-profile/Default/Cache` | 20 MB | 网页缓存 |
| `data/browser-profile/Default/Service Worker` | 11 MB | SW 缓存 |
| `data/home/AppData/.../Cache` 等 | ~20 MB | Edge 运行时缓存 |
| `data/home/.npm-cache/` | 0.2 MB | npm 缓存 + 日志 |
| `data/browser-profile/component_crx_cache` | 29 MB | 组件缓存（会自动重建） |

> ⚠️ `component_crx_cache` / `ShaderCache` / `GrShaderCache` / `BrowserMetrics`（合计 ~40 MB）不在工具清单里，但同样会自动重建 —— 可手动清。

### B. 备份类（**当前会话遗留，可删**）

| 文件 | 大小 | 说明 |
|---|---:|---|
| `data/home/.cloudcli/auth.db.bak-pre-pwreset` | 229 KB | 本次改密码前备份，密码已确认可用 |
| `data/home/.cloudcli/auth.db.bak-pre-migrate` | 229 KB | 迁移前备份（保留可作保单） |
| `data/home/.cloudcli/auth.db.bak-before-portable-repair` | 229 KB | 便携化修复前备份 |
| `runtime/.../dist-server/**/*.js.bak / .bak2 / .bak-zh`（10 个） | ~240 KB | 打补丁时的手工备份 |
| `data/home/.claude.json.bak-portable` | 207 B | 便携化前备份 |

### C. 日志类（可删）

- `data/home/.npm-cache/_logs/*.log`（10 个）
- `data/browser-profile/**/settings_diagnostic.log`、`sync*.log`、`cv_debug.log*`
- `data/home/AppData/.../settings_diagnostic.log`、`favorites_diagnostic.log`
- `data/home/AppData/LocalLow/SogouPY/LOG/IME/*.log`（搜狗输入法日志，几十个）
- `data/home/AppData/LocalLow/SogouPY/.../Picface/*.bin.bak`（2.9 MB）

### D. 崩溃/指标类（可删）

- `data/browser-profile/BrowserMetrics*.pma`（4 MB × 2）
- `data/browser-profile/CrashpadMetrics-active.pma`
- `data/home/AppData/.../BrowserMetrics*.pma`（4 MB × 4）、`DeferredBrowserMetrics/`（12 MB）

### E. 无关垃圾（**强烈建议删**）

| 项目 | 体积 | 说明 |
|---|---:|---|
| `data/home/AppData/LocalLow/SogouPY/` | ~17 MB | **搜狗输入法**数据，跟本应用完全无关（是打 U 盘时宿主机的输入法污染） |
| `data/home/AppData/Local/Microsoft/Edge/` 中的 `Edge Wallet`(14MB)、`Edge Entity Extraction`(20MB)、`Subresource Filter`(12MB)、`Edge Shopping`(5MB) 等 | ~60 MB | Edge 浏览器组件，本应用用不到 |

---

## 三、不可删除项（保留）

| 项目 | 原因 |
|---|---|
| `data/home/.claude/projects/` | **对话记录**，你的历史会话 |
| `data/home/.cloudcli/auth.db` | 登录库（当前使用中） |
| `data/home/.cloudcli/local-server.json`、`claude-transcript-index.json` | 应用运行配置 |
| `data/home/keys.env` (若存在) | 密钥覆盖文件 |
| `config/keys.env` | API 密钥 |
| `patches/server/pristine-1.37.4/`（15 个文件） | **补丁工具的基准快照**，删了无法重新生成 patches.json |
| `patches/frontend/_base.min.js`（3.4 MB） | 前端补丁基座 |
| `runtime/**` 全部 | 运行时必需 |
| `data/browser-profile` 的 Cookies / Login Data / Preferences | 浏览器登录态（可保留） |
| `data/run/*.pid` `*.port` | 运行时 PID 文件，可留着（启动会覆盖） |

---

## 四、额外发现的"AI 遗留"

1. **`data/home/AppData/LocalLow/SogouPY/`** —— 17 MB 搜狗输入法数据混进了便携 home。
   **根因**：`START.bat` 里 `set "LOCALAPPDATA=%HOME%\AppData\Local"`，宿主机的搜狗输入法把日志写进了这个被重定向的目录。
   **建议**：直接删除 `SogouPY` 整个目录，并考虑在启动脚本里屏蔽（不影响应用）。

2. **`data/home/temp/sogou_updater_pkg13836_9650/`** —— 69 MB 搜狗升级包，同源问题。

3. **`.workbuddy/memory/`** —— 这是项目工作日志（31 KB），**保留**（是记忆系统目录，非垃圾）。

4. **根目录无残留测试文件**（已确认干净）。

5. **无 `.wb-backup` 残留**（工具生成的都在，且已列入 B 类）。

---

## 五、建议执行顺序

```bash
# 1. 清缓存（内置工具，最安全）
runtime\node\node.exe tools/prune-portable-cache.mjs --apply

# 2. 删搜狗垃圾（手工）
rm -rf data/home/AppData/LocalLow/SogouPY
rm -rf "data/home/temp/sogou_updater_pkg13836_9650"

# 3. 删备份（确认 auth.db 可用后）
rm -f data/home/.cloudcli/auth.db.bak-pre-pwreset
rm -f data/home/.cloudcli/auth.db.bak-before-portable-repair

# 4. 删补丁备份
find runtime/node/node_modules/@cloudcli-ai/cloudcli -name "*.bak*" -delete
```

**预计总回收：约 330 MB**（2062 MB → ~1730 MB）

---

## 七、执行结果（已完成 2025-10-11）

| 步骤 | 回收 | 状态 |
|---|---:|---|
| 内置缓存清理 `prune-portable-cache.mjs --apply` | ~46 MB | ✅ |
| 删搜狗污染 `SogouPY` + `sogou_updater_pkg`（69 MB 升级包） | 76 MB | ✅ |
| 删 Edge 按需组件（Wallet/Subresource/Shopping/SafeBrowsing 等 15 项） | 38 MB | ✅ |
| 删 component_crx_cache / GPU·Shader 缓存 / BrowserMetrics | 69 MB | ✅ |
| 删 auth.db+claude.json+server 补丁备份（11 个文件） | 0.7 MB | ✅ |
| 删诊断日志（diagnostic/sync/cv_debug/npm 日志） | 1.1 MB | ✅ |
| **合计** | **≈231 MB** | ✅ |

**未清动的残留（被运行中进程占用，无影响）**：
- `data/home/AppData/LocalLow/SogouPY/LOG/IME/msedge_18108.log`（2.4 KB，宿主机搜狗输入法实时写入中）
- `.../Edge/User Data/CrashpadMetrics-active.pma`（16 KB，Edge 崩溃监控实时占用）

> 这两项在应用/输入法未运行时可直接删除，体积可忽略。

**完整性校验**：`config/keys.env`、`auth.db`、`.claude/projects`、`patches.json`（68 项）、`pristine-1.37.4`、`_base.min.js`、`node.exe`、`START.bat`、`prune-portable-cache.mjs` 全部在位 ✅

---

## 八、可选：进一步瘦身

| 项目 | 可省 | 风险 |
|---|---:|---|
| `runtime/git`（392 MB） | 392 MB | 若应用内需要 git 功能则不可删；只是便携打开网页的话可删 |
| `runtime/node/node_modules` 里的 `react-grab`(37MB)、`mermaid`(25MB)、`typescript`(23MB)、`playwright-core`(13MB)、`react-doctor`(12MB) | ~110 MB | 属于构建期依赖，运行时用不到；删除有风险，**不建议** |
| `runtime/node/node_modules/react-grab` | 37 MB | 开发调试用，建议先确认 |
| 源码 `.map` 文件 | ~10 MB | `--trim-runtime` 参数可删 |

> 若目标是「能跑就行」的最小 U 盘包，删 `runtime/git` 是最大单笔收益（-392 MB）。
