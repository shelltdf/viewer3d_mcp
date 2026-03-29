#!/usr/bin/env python3
"""
无参数入口：始终保证运行的是最新 exe。

行为：
1) 若不存在可执行文件 -> 先构建，再运行；
2) 若源码时间晚于 exe -> 重新构建，再运行；
3) 若 exe 已是最新 -> 直接运行；
4) 构建失败 -> 直接退出，不运行旧 exe。
"""

from __future__ import annotations

import glob
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NPM = "npm.cmd" if os.name == "nt" else "npm"
WATCH_EXTS = {".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".vue", ".json", ".html", ".css"}
IGNORE_DIRS = {"node_modules", "dist", "electron-release", ".git", ".idea", ".vscode"}


def collect_exes() -> list[Path]:
    release_root = ROOT / "electron-release"
    paths: list[Path] = []
    if (release_root / "win-unpacked").is_dir():
        paths.extend(Path(p) for p in glob.glob(str(release_root / "win-unpacked" / "*.exe")))
    paths.extend(Path(p) for p in glob.glob(str(release_root / "*.exe")))
    paths.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return paths


def latest_source_mtime() -> float:
    latest = 0.0
    for p in ROOT.rglob("*"):
        if not p.is_file():
            continue
        if any(part in IGNORE_DIRS for part in p.parts):
            continue
        if p.suffix.lower() not in WATCH_EXTS:
            continue
        try:
            mtime = p.stat().st_mtime
        except OSError:
            continue
        latest = max(latest, mtime)
    return latest


def build_latest() -> int:
    print("开始构建最新 exe（离线模式）...", flush=True)
    env = os.environ.copy()
    env["ELECTRON_BUILDER_OFFLINE"] = "true"
    env["npm_config_offline"] = "true"
    env["npm_config_prefer_offline"] = "true"
    code = subprocess.call([NPM, "run", "electron:dist"], cwd=ROOT, env=env, shell=False)
    if code != 0:
        print("构建失败，已退出。", file=sys.stderr, flush=True)
    return code


def run_exe(exe: Path) -> int:
    print(f"启动 exe: {exe}", flush=True)
    if os.name == "nt":
        os.startfile(str(exe))  # type: ignore[attr-defined]
        return 0
    return subprocess.call([str(exe)], cwd=ROOT, shell=False)


def main() -> int:
    exes = collect_exes()
    if not exes:
        if build_latest() != 0:
            return 1
        exes = collect_exes()
        if not exes:
            print("构建后仍未找到 exe，已退出。", file=sys.stderr, flush=True)
            return 1
        return run_exe(exes[0])

    newest_exe = exes[0]
    if latest_source_mtime() > newest_exe.stat().st_mtime:
        print("检测到源码更新，重新构建...", flush=True)
        if build_latest() != 0:
            return 1
        exes = collect_exes()
        if not exes:
            print("构建后未找到 exe，已退出。", file=sys.stderr, flush=True)
            return 1
        return run_exe(exes[0])

    print("当前 exe 已是最新版。", flush=True)
    return run_exe(newest_exe)


if __name__ == "__main__":
    sys.exit(main())
