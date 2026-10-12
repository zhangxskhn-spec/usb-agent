# -*- coding: utf-8 -*-
"""
usb-agent 服务端补丁重放器
==========================
npm 升级 @cloudcli-ai/cloudcli 会覆盖 dist-server 与 dist 里的定制。
本脚本按 patches/server/patches.json 把全部补丁幂等重放回去：

  - 每个补丁块带 marker：文件里已存在 → 跳过（幂等，可反复跑）；
  - marker 不存在但官方原文（find）能唯一匹配 → 替换为补丁内容；
  - find 匹配不上（上游新版改了相关代码）→ 明确告警，需人工核对，
    对照 patches/server/pristine-<旧版>/ 与新版文件手工合并。

用法:
  python tools/apply-server-patches.py          # 重放
  python tools/apply-server-patches.py --check  # 只报告状态，不写文件

前端补丁不在这里：改完 patches/frontend/*.js 跑 tools/build-frontend.py。
"""
import io
import json
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKG = os.path.join(ROOT, "runtime", "node", "node_modules", "@cloudcli-ai", "cloudcli")
DEF = os.path.join(ROOT, "patches", "server", "patches.json")


def main():
    check_only = "--check" in sys.argv
    if not os.path.exists(DEF):
        print("[FAIL] 找不到补丁定义:", DEF)
        print("       请先运行 python tools/make-server-patches.py 生成")
        sys.exit(1)
    with io.open(DEF, encoding="utf-8") as f:
        payload = json.load(f)
    patches = payload.get("patches", [])
    print("[info] 补丁定义基于 cloudcli", payload.get("cloudcliVersion"), "，共", len(patches), "块")

    stats = {"ok": 0, "skip": 0, "miss": 0}
    by_file = {}
    for p in patches:
        by_file.setdefault(p["file"], []).append(p)

    for rel, items in by_file.items():
        path = os.path.join(PKG, rel)
        if not os.path.exists(path):
            print("[MISS] 文件不存在（升级后路径变了？）:", rel)
            stats["miss"] += len(items)
            continue
        with io.open(path, encoding="utf-8") as f:
            content = f.read()
        dirty = False
        for p in items:
            if p["marker"] and p["marker"] in content:
                stats["skip"] += 1
                continue
            n = content.count(p["find"])
            if n == 1:
                content = content.replace(p["find"], p["replace"], 1)
                dirty = True
                stats["ok"] += 1
                print("[apply]", rel, "<-", (p["marker"] or "补丁块")[:60])
            else:
                stats["miss"] += 1
                print("[WARN] 锚点%s: %s <- %s" % (
                    "不唯一（%d 处）" % n if n else "未命中", rel, (p["marker"] or "")[:60]))
                print("       上游新版可能改了这段代码，请对照 patches\\server\\pristine-* 手工合并")
        if dirty and not check_only:
            bak = path + ".wb-backup"
            if not os.path.exists(bak):
                shutil.copy2(path, bak)
            with io.open(path, "w", encoding="utf-8", newline="") as f:
                f.write(content)

    print("\n[done] 新打 %d 块，已存在跳过 %d 块，锚点未命中 %d 块%s" % (
        stats["ok"], stats["skip"], stats["miss"], "（check 模式，未写盘）" if check_only else ""))
    if stats["miss"]:
        sys.exit(2)


if __name__ == "__main__":
    main()
