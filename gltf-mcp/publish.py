#!/usr/bin/env python3
"""Produce distributable output: build then print dist/ path."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NPM = "npm.cmd" if os.name == "nt" else "npm"


def main() -> int:
    code = subprocess.call([NPM, "run", "build"], cwd=ROOT, shell=False)
    if code != 0:
        return code
    dist = ROOT / "dist"
    print(f"Distributable directory: {dist}")
    print("Upload the contents of dist/ to static hosting.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
