# tools/ 工具目录

启动只经过 `START.bat` → 下面「日常运行」这一组。其余脚本都是开发/维护时手动执行，
**不要**在启动链路里加新依赖。

## 日常运行（启动链路）

| 脚本 | 作用 |
|---|---|
| `portable-runtime.mjs` | 端口探测、网关启停、常驻监督者（`find-port` / `supervise` / `start-gateway` / `stop-gateway` / `stop-all`） |
| `anthropic-gw.mjs` | 本地模型网关：按模型名前缀路由到 MiMo / DeepSeek，剥掉 `[1m]` 标记 |
| `open-when-ready.bat` → `open-browser.mjs` | 轮询端口就绪，再用固定 profile 打开浏览器 |
| `repair-portable-state.mjs` | 每次启动幂等修复：会话路径、`settings.json`（模型别名 / 状态行 / 权限默认值）、`keybindings.json`、工作区信任 |
| `runtime-home.bat` | 解析运行时目录：就地 `runtime/` 或把 `runtime.zip` 展开到本机缓存 |
| `cli-statusline.mjs` | Claude Code 状态行（模型名 + 按键提示 + 模式中文对照） |
| `selfcheck.bat` | 环境自检（运行时、密钥、端口） |
| `test-connection.bat` | 单独测上游连通性，不动启动链路 |
| `stop-gw.bat` | 只停本包记录的网关 |
| `usb-eject.bat` + `usb-eject.ps1` | 停止占用 → 卷锁判定 → 真正弹出 U 盘。**启动器不再有弹出菜单项**，这是手动工具（双击即用） |
| `eject-usb.bat` | 旧文件名兼容入口，纯转发到 `usb-eject.bat` |

## 部署与维护

| 脚本 | 作用 |
|---|---|
| `deploy-to-usb.mjs` / `.bat` | 部署到 U 盘：程序 robocopy + data 增量 + `runtime.zip` 顺序写盘 |
| `sync-to-usb.bat` | 只同步程序与 data，不动 U 盘上的 `runtime.zip`（改补丁后几秒完事） |
| `pack-for-usb.mjs` / `.bat` | 把整包打成单个 zip（`--runtime` 只打包运行时） |
| `unpack-on-usb.bat` | 在一台新机器上展开整包 |
| `zip-util.mjs` | 自写 zip 打包器（**不要换回系统 tar**，会静默丢文件） |
| `prune-portable-cache.mjs` | 清理本机展开缓存与可重建缓存 |
| `forget-runtime-cache.bat` | 清掉本机 `%LOCALAPPDATA%\usb-agent-runtime` |

## 开发与补丁

| 脚本 | 作用 |
|---|---|
| `build-frontend.py` | 把 `patches/frontend/*.js` 拼到 `_base.min.js` 后，产出新的版本化 bundle |
| `apply-server-patches.py` | 升级 cloudcli 后，幂等重放 `patches/server/patches.json` |
| `make-server-patches.py` | 维护用：对比 unpkg 官方原版，重新生成 `patches.json` 与 pristine 快照 |

## archive/（已完成，仅留档）

| 文件 | 为什么归档 |
|---|---|
| `migrate-plain-chats.py` | 一次性的 `@plain` 会话迁移，存量数据迁完即失效 |
| `release-usb.mjs` | 旧版 Node 弹出实现，正常弹出已改用 `usb-eject.bat` |

## 约定

1. **启动脚本自己算绝对路径**：先 `call tools\runtime-home.bat` 拿 `%USBAI_RUNTIME%`，
   不要硬编码 `%ROOT%\runtime`（U 盘可能是 `runtime.zip` 瘦身布局）。
2. **编码**：`.bat` 一律 **ASCII + CRLF**；`.ps1` 含中文必须 **UTF-8 with BOM**。
   不要用编辑器随手存成 UTF-8 + LF，控制台会解析错位。
3. **运行数据在 `data/`，密钥在 `config/`**，两者都不入库、不进备份包。
4. **前端只改 `patches/frontend/*.js` 再跑 `build-frontend.py`**；服务端只改 `dist-server`
   再用补丁工具生成/重放，永远不要直接改生成物。
5. 新增脚本前先看这张表：能复用就不新建；确实要加，归到上面四组之一并补一行说明。
