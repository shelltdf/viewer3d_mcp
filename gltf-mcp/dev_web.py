#!/usr/bin/env python3
"""
方式二：启动 Vite 开发服务器，并在浏览器中打开（可选尝试 Cursor/VS Code 内置 Simple Browser）。

用法（在 gltf-mcp 目录下）：
  python dev_web.py
  python dev_web.py --port 5173
  python dev_web.py --no-open          # 只启动 dev，不自动打开浏览器
  python dev_web.py --external-only    # 仅系统默认浏览器（兼容保留）
"""
from __future__ import annotations

import argparse
import os
import socket
import subprocess
import sys
import time
import urllib.parse
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NPM = "npm.cmd" if os.name == "nt" else "npm"
_VITE_LOCAL = ROOT / "node_modules" / ".bin" / ("vite.cmd" if os.name == "nt" else "vite")


def stop_process_tree(proc: subprocess.Popen, timeout: float = 6.0) -> None:
    """尽量彻底结束 dev 进程及其子进程（Windows 下包含 npm/node/vite 整棵树）。"""
    if proc.poll() is not None:
        return
    if os.name == "nt":
        # /T 杀子进程树；/F 保证不会残留 vite/node
        subprocess.call(
            ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            shell=False,
        )
        return
    proc.terminate()
    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()


def wait_port(host: str, port: int, timeout: float = 60.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=1.0):
                return True
        except OSError:
            time.sleep(0.25)
    return False


def wait_port_any(port: int, timeout: float = 60.0) -> tuple[bool, str]:
    """
    在本机不同回环地址上等待端口可用，兼容仅监听 localhost/::1 的情况。
    返回 (ok, chosen_host)。
    """
    hosts = ("127.0.0.1", "localhost", "::1")
    deadline = time.time() + timeout
    while time.time() < deadline:
        for h in hosts:
            if wait_port(h, port, timeout=0.6):
                return True, h
        time.sleep(0.2)
    return False, hosts[0]


def try_open_simple_browser(url: str) -> bool:
    """仅用 cursor:// 协议打开 Cursor 内置 Simple Browser。"""
    encoded = urllib.parse.quote(url, safe="")
    uri = f"cursor://vscode.simple-browser/show?url={encoded}"
    if os.name == "nt":
        try:
            os.startfile(uri)  # type: ignore[attr-defined]
            return True
        except OSError:
            return False
    for opener in ("xdg-open", "open"):
        try:
            subprocess.Popen(
                [opener, uri],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return True
        except FileNotFoundError:
            continue
    return False


def main() -> int:
    ap = argparse.ArgumentParser(description="gltf-mcp：网页交互开发模式")
    ap.add_argument("--port", type=int, default=5173, help="期望的 Vite 端口（需与 vite 输出一致）")
    ap.add_argument("--no-open", action="store_true", help="不自动打开任何浏览器")
    ap.add_argument(
        "--external-only",
        action="store_true",
        help="仅使用系统默认浏览器打开 http URL，不尝试 cursor:// Simple Browser",
    )
    args = ap.parse_args()

    if not _VITE_LOCAL.is_file():
        print(
            "未找到本地 Vite（缺少 node_modules）。请先在 gltf-mcp 目录执行：npm install",
            file=sys.stderr,
        )
        return 1

    env = os.environ.copy()
    env.setdefault("GLTF_MCP_BRIDGE_TOKEN", "dev-gltf-mcp-token")

    print("启动: npm run dev（Ctrl+C 结束）…")
    proc = subprocess.Popen([NPM, "run", "dev"], cwd=ROOT, env=env, shell=False)

    try:
        ok, host = wait_port_any(args.port, timeout=90.0)
        if not ok:
            print("等待端口超时:", args.port, file=sys.stderr)
            print("提示: Vite 可能只监听 localhost/IPv6，或端口被占用后自动切换。", file=sys.stderr)
            return 1

        url = f"http://{host}:{args.port}/"
        if not args.no_open:
            if args.external_only:
                webbrowser.open(url)
                print("已用系统默认浏览器打开:", url)
            else:
                if try_open_simple_browser(url):
                    print("已尝试在 Cursor 内置 Simple Browser 打开:", url)
                else:
                    print("未能自动拉起 Cursor 内置 Simple Browser。请在 Cursor 命令面板打开 Simple Browser 并粘贴:", url)

        return proc.wait()
    except KeyboardInterrupt:
        stop_process_tree(proc)
        return 0
    finally:
        # 如果主流程因异常返回，确保不留后台 dev 进程。
        stop_process_tree(proc)


if __name__ == "__main__":
    sys.exit(main())
