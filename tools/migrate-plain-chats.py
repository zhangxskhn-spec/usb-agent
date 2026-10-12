# -*- coding: utf-8 -*-
"""
usb-agent 普通对话归属迁移（一次性，幂等）
==========================================
背景：旧版把「新对话」产生的普通问答 project_path 补成当时的 homedir 绝对路径，
文件夹一移动，旧普通对话就会从「最近对话」消失并被扫描成伪项目。

本脚本：
  1. 把 project_path 指向「包内 data\\home」（任意旧位置）的会话改为便携哨兵 '@plain'
  2. 删除 projects 表里对应的伪项目行（如旧「普通对话」项目）

用法: python tools/migrate-plain-chats.py        # 执行
      python tools/migrate-plain-chats.py --dry  # 只预览
"""
import os
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, "data", "home", ".cloudcli", "auth.db")
SENTINEL = "@plain"


def main():
    dry = "--dry" in sys.argv
    if not os.path.exists(DB):
        print("[skip] 数据库不存在:", DB)
        return
    con = sqlite3.connect(DB)
    cur = con.cursor()

    rows = list(cur.execute(
        "SELECT session_id, project_path FROM sessions "
        "WHERE project_path LIKE '%\\data\\home' OR project_path LIKE '%\\data\\home\\%' "
        "OR project_path LIKE '%/data/home' OR project_path LIKE '%/data/home/%'"
    ))
    print("[sessions] 待迁移普通对话:", len(rows))
    for sid, pp in rows:
        print("   ", sid[:8], "...", repr(pp), "->", SENTINEL)

    prows = list(cur.execute(
        "SELECT project_id, project_path, custom_project_name FROM projects "
        "WHERE project_path LIKE '%\\data\\home' OR project_path LIKE '%\\data\\home\\%' "
        "OR project_path LIKE '%/data/home' OR project_path LIKE '%/data/home/%'"
    ))
    print("[projects] 待删除伪项目:", len(prows))
    for pid, pp, name in prows:
        print("   ", repr(name or ""), repr(pp))

    if dry:
        print("[dry] 未做任何修改")
        con.close()
        return

    cur.execute(
        "UPDATE sessions SET project_path = ? "
        "WHERE project_path LIKE '%\\data\\home' OR project_path LIKE '%\\data\\home\\%' "
        "OR project_path LIKE '%/data/home' OR project_path LIKE '%/data/home/%'",
        (SENTINEL,),
    )
    cur.execute(
        "DELETE FROM projects "
        "WHERE project_path LIKE '%\\data\\home' OR project_path LIKE '%\\data\\home\\%' "
        "OR project_path LIKE '%/data/home' OR project_path LIKE '%/data/home/%'"
    )
    # 哨兵对应的项目行由服务端按需自动创建（外键需要），这里若已存在则保留
    con.commit()
    con.close()
    print("[done] 迁移完成")


if __name__ == "__main__":
    main()
