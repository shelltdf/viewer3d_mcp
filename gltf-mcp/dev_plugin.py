#!/usr/bin/env python3
"""
方式一：将「内嵌浏览器」扩展打包为 .vsix 并安装到本机 Cursor / VS Code。

前置：已安装 Node.js；可选安装 Cursor 或 VS Code 且 `cursor` / `code` 在 PATH 中。

用法（在 gltf-mcp 目录下）：
  python dev_plugin.py
  python dev_plugin.py --no-install   # 仅生成 .vsix，不执行安装
"""
from __future__ import annotations

import argparse
import glob
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EXT = ROOT / "cursor-extension"
NPM = "npm.cmd" if os.name == "nt" else "npm"
NPX = "npx.cmd" if os.name == "nt" else "npx"


def run(cmd: list[str], cwd: Path) -> int:
    return subprocess.call(cmd, cwd=cwd, shell=False)


def find_vsix() -> Path | None:
    files = sorted(EXT.glob("*.vsix"), key=lambda p: p.stat().st_mtime, reverse=True)
    return files[0] if files else None


def install_vsix(vsix: Path) -> int:
    # 某些 Cursor/Code 版本会输出 Node 的 DEP0040（punycode）弃用告警；
    # 这里只对安装子进程做降噪，不改变系统环境。
    env = os.environ.copy()
    env.setdefault("NODE_NO_WARNINGS", "1")
    for exe in ("cursor", "code"):
        try:
            return subprocess.call(
                [exe, "--install-extension", str(vsix)],
                shell=False,
                env=env,
            )
        except FileNotFoundError:
            continue
    print(
        "未找到 cursor / code 命令。请手动安装扩展：",
        vsix,
        sep="\n",
        file=sys.stderr,
    )
    return 1


def main() -> int:
    ap = argparse.ArgumentParser(description="打包并安装 gltf-mcp-viewer 本地扩展")
    ap.add_argument(
        "--no-install",
        action="store_true",
        help="只生成 .vsix，不调用 cursor/code --install-extension",
    )
    args = ap.parse_args()

    if not EXT.is_dir():
        print("缺少目录:", EXT, file=sys.stderr)
        return 1

    # 清理旧 vsix（可选）
    for old in EXT.glob("*.vsix"):
        try:
            old.unlink()
        except OSError:
            pass

    code = run([NPX, "--yes", "@vscode/vsce@latest", "package", "--no-dependencies"], cwd=EXT)
    if code != 0:
        return code

    vsix = find_vsix()
    if not vsix:
        print("未找到生成的 .vsix", file=sys.stderr)
        return 1

    print("已生成:", vsix.resolve())
    if args.no_install:
        print('安装命令示例: cursor --install-extension "' + str(vsix) + '"')
        return 0

    return install_vsix(vsix)


if __name__ == "__main__":
    sys.exit(main())
