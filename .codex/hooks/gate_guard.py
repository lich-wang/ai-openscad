#!/usr/bin/env python3
"""Hook guard for the AI OpenSCAD gate workflow."""

from __future__ import annotations

import json
import pathlib
import re
import subprocess
import sys
from typing import Any


ROOT = pathlib.Path(__file__).resolve().parents[2]
GATES_FILE = ROOT / ".codex" / "gates" / "gates.json"
STATE_FILE = ROOT / ".codex" / "runtime" / "gate-state.json"


def load_json(path: pathlib.Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def read_hook_payload() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {"raw": raw}


def active_gate() -> str | None:
    data = load_json(STATE_FILE, {})
    gate = data.get("active_gate")
    return gate if isinstance(gate, str) and gate else None


def gate_state() -> dict[str, Any]:
    data = load_json(STATE_FILE, {})
    return data if isinstance(data, dict) else {}


def gate_config(gate: str | None) -> dict[str, Any]:
    if not gate:
        return {}
    config = load_json(GATES_FILE, {})
    value = config.get("gates", {}).get(gate, {})
    return value if isinstance(value, dict) else {}


def changed_files() -> list[str]:
    result = subprocess.run(
        ["git", "status", "--short"],
        cwd=ROOT,
        check=False,
        text=True,
        capture_output=True,
    )
    files: list[str] = []
    for line in result.stdout.splitlines():
        path = line[3:].strip()
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        if path:
            files.append(path)
    return files


def tool_name(payload: dict[str, Any]) -> str:
    for key in ("tool_name", "tool", "name"):
        value = payload.get(key)
        if isinstance(value, str):
            return value
    return ""


def command_text(payload: dict[str, Any]) -> str:
    parts: list[str] = []
    for value in payload.values():
        if isinstance(value, str):
            parts.append(value)
        elif isinstance(value, dict):
            parts.extend(str(item) for item in value.values() if isinstance(item, str))
    return "\n".join(parts)


def looks_like_write(tool: str, text: str) -> bool:
    if tool in {"apply_patch", "Edit", "Write"}:
        return True
    write_patterns = [
        r"\bapply_patch\b",
        r">\s*[^&|]",
        r"\btee\b",
        r"\brm\s+",
        r"\bmv\s+",
        r"\bcp\s+",
        r"\bmkdir\s+",
        r"\btouch\s+",
        r"\bnpm\s+install\b",
        r"\bgit\s+(commit|push|tag|merge|rebase)\b"
    ]
    return any(re.search(pattern, text) for pattern in write_patterns)


def path_allowed(path: str, patterns: list[str]) -> bool:
    normalized = path.strip("/")
    for pattern in patterns:
        pattern = pattern.strip("/")
        if pattern.endswith("/"):
            if normalized.startswith(pattern):
                return True
            continue
        if "**" in pattern:
            regex = "^" + re.escape(pattern).replace("\\*\\*", ".*").replace("\\*", "[^/]*") + "$"
            if re.match(regex, normalized):
                return True
            continue
        if normalized == pattern:
            return True
    return False


def pre_tool() -> int:
    payload = read_hook_payload()
    tool = tool_name(payload)
    text = command_text(payload)
    if not looks_like_write(tool, text):
        return 0

    gate = active_gate()
    if not gate:
        print(
            "Blocked write-like tool use because no Codex gate is active. "
            "Run `.codex/scripts/gate.py begin <gate>` first.",
            file=sys.stderr,
        )
        return 1

    config = gate_config(gate)
    if not config:
        print(f"Blocked tool use because active gate is unknown: {gate}", file=sys.stderr)
        return 1

    print(f"Codex gate active: {gate}")
    return 0


def post_tool() -> int:
    gate = active_gate()
    if not gate:
        return 0

    data = gate_state()
    baseline = set(str(item) for item in data.get("baseline_changed_files", []))
    config = gate_config(gate)
    allowed = config.get("allowed_write_paths", [])
    if not isinstance(allowed, list):
        allowed = []

    files = [path for path in changed_files() if path not in baseline]
    if not files:
        return 0

    blocked = [
        path for path in files
        if not path_allowed(path, [str(item) for item in allowed])
    ]
    if blocked:
        print(
            "Current Codex gate does not allow changes to these paths: "
            + ", ".join(blocked)
            + f". Active gate: {gate}.",
            file=sys.stderr,
        )
        return 1
    print(f"Gate file scope ok: {gate}")
    return 0


def stop() -> int:
    gate = active_gate()
    if gate:
        print(
            f"Active Codex gate has not been ended: {gate}. "
            "End it with `.codex/scripts/gate.py end ...` and required evidence.",
            file=sys.stderr,
        )
        return 1
    return 0


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "pre-tool":
        return pre_tool()
    if mode == "post-tool":
        return post_tool()
    if mode == "stop":
        return stop()
    print(f"Unknown gate guard mode: {mode}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
