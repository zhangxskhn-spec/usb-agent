# -*- coding: utf-8 -*-
"""
usb-agent 服务端补丁定义生成器（维护用，平时不需要跑）
=====================================================
把「当前 dist / dist-server 里的补丁文件」与「unpkg 上的官方原版」做行级 diff，
自动生成 patches/server/patches.json（供 apply-server-patches.py 消费），
并把官方原版快照存到 patches/server/pristine-<version>/（供三方合并参考）。

什么时候跑：
  - 有意改了 dist-server / dist 里的补丁代码后，重新生成补丁定义；
  - 日常升级 cloudcli 后不需要跑它（跑 apply-server-patches.py 即可）。

用法:  python tools/make-server-patches.py
"""
import difflib
import io
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKG = os.path.join(ROOT, "runtime", "node", "node_modules", "@cloudcli-ai", "cloudcli")
OUT_DIR = os.path.join(ROOT, "patches", "server")
CTX = 2          # find/replace 块两端各带的上下文行数
MERGE_GAP = 6    # 两个改动块之间未变行数小于此值则合并

# 所有被打过补丁的文件（相对包根）
FILES = [
    "dist-server/server/shared/utils.js",
    "dist-server/server/modules/providers/services/sessions.service.js",
    "dist-server/server/modules/projects/services/projects-with-sessions-fetch.service.js",
    "dist-server/server/modules/providers/list/claude/claude-session-synchronizer.provider.js",
    "dist-server/server/modules/providers/list/claude/claude-runtime.provider.js",
    "dist-server/server/modules/websocket/services/chat-websocket.service.js",
    "dist-server/server/modules/providers/provider.routes.js",
    "dist-server/server/modules/projects/projects.routes.js",
    "dist-server/server/modules/projects/services/project-delete.service.js",
    "dist-server/server/modules/user/user.service.js",
    "dist-server/server/modules/database/repositories/session-drafts.db.js",
    "dist-server/server/modules/providers/list/claude/claude-models.provider.js",
    "dist-server/server/modules/providers/services/provider-models.service.js",
    "dist-server/server/modules/providers/services/provider-capabilities.service.js",
    "dist-server/server/modules/commands/commands.routes.js",
    "dist/sw.js",
]


def pkg_version():
    try:
        with io.open(os.path.join(PKG, "package.json"), encoding="utf-8") as f:
            return json.load(f)["version"]
    except Exception:
        return "unknown"


def fetch(rel, version):
    url = "https://unpkg.com/@cloudcli-ai/cloudcli@%s/%s" % (version, rel)
    req = urllib.request.Request(url, headers={"User-Agent": "usb-agent-make-server-patches"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8")


def hunks_for(pristine_lines, patched_lines):
    """把两份文本的行级 diff 转成 [{find, replace, marker}] 列表。"""
    sm = difflib.SequenceMatcher(None, pristine_lines, patched_lines, autojunk=False)
    ops = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag != "equal":
            ops.append([i1, i2, j1, j2])
    if not ops:
        return []
    # 合并相邻改动
    merged = [ops[0]]
    for i1, i2, j1, j2 in ops[1:]:
        m = merged[-1]
        if i1 - m[1] <= MERGE_GAP:
            m[1], m[3] = i2, j2
        else:
            merged.append([i1, i2, j1, j2])
    out = []
    for i1, i2, j1, j2 in merged:
        a = max(0, i1 - CTX)
        b = min(len(pristine_lines), i2 + CTX)
        c = max(0, j1 - CTX)
        d = min(len(patched_lines), j2 + CTX)
        find = "".join(pristine_lines[a:b])
        replace = "".join(patched_lines[c:d])
        # marker：replace 块里带 [patched] 或 wb 特征的第一行；找不到则取首个非上下文行
        marker = ""
        for ln in patched_lines[c:d]:
            if "[patched]" in ln or "wb-" in ln or "wb_" in ln.lower():
                marker = ln.strip()
                break
        if not marker:
            mid = c + max(0, (j1 - c) if j1 > c else 0)
            marker = patched_lines[min(mid, d - 1)].strip()
        out.append({"find": find, "replace": replace, "marker": marker})
    return out


def main():
    version = pkg_version()
    print("[info] cloudcli 版本:", version)
    pristine_dir = os.path.join(OUT_DIR, "pristine-" + version)
    os.makedirs(pristine_dir, exist_ok=True)

    patches = []
    for rel in FILES:
        cur_path = os.path.join(PKG, rel)
        if not os.path.exists(cur_path):
            print("[skip] 本地文件不存在:", rel)
            continue
        with io.open(cur_path, encoding="utf-8") as f:
            patched = f.read()
        try:
            pristine = fetch(rel, version)
        except Exception as e:
            local_snap = os.path.join(pristine_dir, rel.replace("/", "__"))
            if os.path.exists(local_snap):
                with io.open(local_snap, encoding="utf-8") as f:
                    pristine = f.read()
                print("[warn] 无法下载官方原版，使用本地基线:", rel)
            else:
                print("[FAIL] 下载官方原版失败:", rel, "-", e)
                sys.exit(1)
        snap = os.path.join(pristine_dir, rel.replace("/", "__"))
        with io.open(snap, "w", encoding="utf-8", newline="") as f:
            f.write(pristine)
        hs = hunks_for(pristine.splitlines(True), patched.splitlines(True))
        print("[file] %-72s 补丁块 %d 个" % (rel, len(hs)))
        for n, h in enumerate(hs, 1):
            patches.append({
                "file": rel,
                "marker": h["marker"],
                "find": h["find"],
                "replace": h["replace"],
            })

    out_path = os.path.join(OUT_DIR, "patches.json")
    payload = {
        "cloudcliVersion": version,
        "note": "由 tools/make-server-patches.py 自动生成；apply-server-patches.py 消费。marker 存在即视为已打补丁。",
        "patches": patches,
    }
    with io.open(out_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(payload, ensure_ascii=False, indent=1))
    print("[done]", out_path, "共", len(patches), "个补丁块")


if __name__ == "__main__":
    main()
