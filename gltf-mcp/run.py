#!/usr/bin/env python3
"""Preview production build (requires dist/; runs npm run preview)."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NPM = "npm.cmd" if os.name == "nt" else "npm"


def main() -> int:
    return subprocess.call([NPM, "run", "preview"], cwd=ROOT, shell=False)


if __name__ == "__main__":
    sys.exit(main())
