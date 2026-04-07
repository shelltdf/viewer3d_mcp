#!/usr/bin/env python3
"""
启动 animal-studio 的 Vite 开发服务器，并可选在浏览器中打开。

用法（在 animal-studio 目录下）：
  python run_web.py
  python run_web.py --port 5174
  python run_web.py --no-open
  python run_web.py --external-only
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
    if proc.poll() is not None:
        return
    if os.name == "nt":
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
    hosts = ("127.0.0.1", "localhost", "::1")
    deadline = time.time() + timeout
    while time.time() < deadline:
        for h in hosts:
            if wait_port(h, port, timeout=0.6):
                return True, h
        time.sleep(0.2)
    return False, hosts[0]


def try_open_simple_browser(url: str) -> bool:
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
    ap = argparse.ArgumentParser(description="animal-studio：启动 Vite 开发服务器")
    ap.add_argument(
        "--port",
        type=int,
        default=5174,
        help="期望的 Vite 端口（默认 5174，避免与 plant-studio 等并行时常用 5173 冲突）",
    )
    ap.add_argument("--no-open", action="store_true", help="不自动打开浏览器")
    ap.add_argument(
        "--external-only",
        action="store_true",
        help="仅使用系统默认浏览器打开 http URL，不尝试 cursor:// Simple Browser",
    )
    args = ap.parse_args()

    if not _VITE_LOCAL.is_file():
        print(
            "未找到本地 Vite（缺少 node_modules）。请先在 animal-studio 目录执行：npm install",
            file=sys.stderr,
        )
        return 1

    print("启动: npm run dev（Ctrl+C 结束）…")
    proc = subprocess.Popen([NPM, "run", "dev"], cwd=ROOT, env=os.environ.copy(), shell=False)

    try:
        ok, host = wait_port_any(args.port, timeout=90.0)
        if not ok:
            print("等待端口超时:", args.port, file=sys.stderr)
            print("提示: Vite 可能监听其他地址/端口，或端口被占用后自动切换。", file=sys.stderr)
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
                    print("未能自动拉起 Cursor 内置 Simple Browser。请手动打开:", url)

        return proc.wait()
    except KeyboardInterrupt:
        stop_process_tree(proc)
        return 0
    finally:
        stop_process_tree(proc)


if __name__ == "__main__":
    sys.exit(main())
