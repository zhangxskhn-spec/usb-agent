# -*- coding: utf-8 -*-
"""
usb-agent 前端注入器构建脚本
=============================
把 patches/frontend/ 下的注入器源码（按文件名序）拼接到底层 bundle（_base.min.js）
之后，产出一个新的版本化 bundle 并更新 index.html 引用。

用法:
    python tools/build-frontend.py            # 自动递增版本号 vN -> v(N+1)
    python tools/build-frontend.py --check    # 只校验，不写文件

规则（务必遵守）:
  - 底层 bundle 含全部「就地定制」（汉化/服务端联动），永远不要手工编辑它；
    改前端行为请改 patches/frontend/*.js 后重新构建。
  - dist 静态资源带 immutable 缓存头 + sw.js 对 /assets/ cache-first，
    所以每次改动【必须】换新文件名并更新 index.html —— 本脚本自动完成。
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "runtime", "node", "node_modules", "@cloudcli-ai", "cloudcli", "dist")
ASSETS = os.path.join(DIST, "assets")
PATCHES = os.path.join(ROOT, "patches", "frontend")

# 本机免登录令牌不入库：源码里写占位符，构建时从 config/local-token.txt 注入
TOKEN_FILE = os.path.join(ROOT, "config", "local-token.txt")
PLACEHOLDER = "__WB_LOCAL_TOKEN__"


def inject_token(bundle):
    """把 __WB_LOCAL_TOKEN__ 替换成 config/local-token.txt 的内容。"""
    token = ""
    if os.path.exists(TOKEN_FILE):
        token = io.open(TOKEN_FILE, encoding="utf-8").read().strip()
    if PLACEHOLDER not in bundle:
        return bundle
    if not token:
        print("[warn] 未找到 %s —— 免登录令牌将为空，启动后会走正常登录流程。" % TOKEN_FILE)
        print("       需要免登录请把令牌写入该文件后重新构建（见 patches/README.md）。")
    else:
        print("[ok] 已注入本机免登录令牌（%d 字符，来自 %s）" % (len(token), os.path.relpath(TOKEN_FILE, ROOT)))
    return bundle.replace(PLACEHOLDER, token)


def main():
    check_only = "--check" in sys.argv

    # 1) 读底层
    base_path = os.path.join(PATCHES, "_base.min.js")
    base = io.open(base_path, encoding="utf-8").read()

    # 2) 按文件名序读注入器（00- 90- 前缀决定执行顺序）
    mods = sorted(f for f in os.listdir(PATCHES) if f.endswith(".js") and not f.startswith("_"))
    parts = [base]
    for m in mods:
        code = io.open(os.path.join(PATCHES, m), encoding="utf-8").read().rstrip() + "\n"
        parts.append(code)
        print("[mod]", m, len(code), "bytes")
    bundle = "\n".join(parts)

    # 2.5) 注入本机免登录令牌（令牌本身不入库）
    bundle = inject_token(bundle)

    # 3) 语法自检
    import subprocess
    node = os.path.join(ROOT, "runtime", "node", "node.exe")
    tmp = os.path.join(PATCHES, "_build_check.tmp.js")
    io.open(tmp, "w", encoding="utf-8", newline="").write(bundle)
    r = subprocess.run([node, "--check", tmp], capture_output=True, text=True)
    os.remove(tmp)
    if r.returncode != 0:
        print("[FAIL] syntax check:\n", r.stderr[:800])
        sys.exit(1)
    print("[ok] syntax check passed,", len(bundle), "bytes")

    if check_only:
        return

    # 4) 计算下一个版本号（读取 index.html 当前引用）
    html_path = os.path.join(DIST, "index.html")
    html = io.open(html_path, encoding="utf-8").read()
    mcur = re.search(r"assets/(index-[A-Za-z0-9._-]+\.js)", html)
    if not mcur:
        print("[FAIL] index.html 里找不到当前 bundle 引用")
        sys.exit(1)
    cur = mcur.group(1)
    mver = re.search(r"\.v(\d+)\.js$", cur)
    next_ver = (int(mver.group(1)) + 1) if mver else 1
    nxt = cur.replace(mver.group(0) if mver else ".js", ".v%d.js" % next_ver)

    # 5) 写 bundle + 更新 index.html
    io.open(os.path.join(ASSETS, nxt), "w", encoding="utf-8", newline="").write(bundle)
    html = html.replace(cur, nxt)
    io.open(html_path, "w", encoding="utf-8", newline="").write(html)
    print("[done]", cur, "->", nxt, "| index.html 已更新（纯前端改动，浏览器 Ctrl+F5 生效）")

    # 6) 清理旧版本 bundle（仅保留刚生成的 nxt），避免 dist/assets 持续累积
    for f in os.listdir(ASSETS):
        if f == nxt:
            continue
        if re.match(r"^index-.*\.v\d+\.js$", f):
            try:
                os.remove(os.path.join(ASSETS, f))
                print("[clean]", f)
            except OSError:
                pass

if __name__ == "__main__":
    main()
