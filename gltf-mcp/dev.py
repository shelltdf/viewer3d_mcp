#!/usr/bin/env python3
"""Development server (npm run dev)."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NPM = "npm.cmd" if os.name == "nt" else "npm"


def main() -> int:
    return subprocess.call([NPM, "run", "dev"], cwd=ROOT, shell=False)


if __name__ == "__main__":
    sys.exit(main())
