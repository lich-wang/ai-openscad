#!/usr/bin/env python3
"""Session-start hook that requires the project Codex guide to be readable."""

from __future__ import annotations

import hashlib
import pathlib
import sys


def main() -> int:
    root = pathlib.Path(__file__).resolve().parents[2]
    guide = root / ".codex" / "AGENTS.md"
    if not guide.is_file():
        print("Missing required Codex guide: .codex/AGENTS.md", file=sys.stderr)
        return 1

    content = guide.read_text(encoding="utf-8")
    if not content.strip():
        print("Required Codex guide is empty: .codex/AGENTS.md", file=sys.stderr)
        return 1

    digest = hashlib.sha256(content.encode("utf-8")).hexdigest()[:12]
    line_count = content.count("\n") + 1
    print(f"Read .codex/AGENTS.md ({line_count} lines, sha256:{digest}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
