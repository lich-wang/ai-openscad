#!/usr/bin/env python3
"""Manage AI OpenSCAD Codex workflow gates."""

from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys
import time
from typing import Any


ROOT = pathlib.Path(__file__).resolve().parents[2]
GATES_FILE = ROOT / ".codex" / "gates" / "gates.json"
STATE_FILE = ROOT / ".codex" / "runtime" / "gate-state.json"


def load_json(path: pathlib.Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: pathlib.Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


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


def gates() -> dict[str, Any]:
    return load_json(GATES_FILE, {})


def state() -> dict[str, Any]:
    return load_json(
        STATE_FILE,
        {
            "active_gate": None,
            "completed_gates": [],
            "events": []
        },
    )


def event(data: dict[str, Any], action: str, gate: str, evidence: dict[str, str] | None = None) -> None:
    data.setdefault("events", []).append(
        {
            "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "action": action,
            "gate": gate,
            "evidence": evidence or {}
        }
    )


def require_gate_name(config: dict[str, Any], gate: str) -> dict[str, Any]:
    gate_config = config.get("gates", {}).get(gate)
    if not gate_config:
        raise SystemExit(f"Unknown gate: {gate}")
    return gate_config


def begin(args: argparse.Namespace) -> int:
    config = gates()
    gate_config = require_gate_name(config, args.gate)
    data = state()

    if data.get("active_gate"):
        raise SystemExit(f"Cannot begin {args.gate}; active gate is {data['active_gate']}. End it first.")

    completed = set(data.get("completed_gates", []))
    missing = [gate for gate in gate_config.get("required_before", []) if gate not in completed]
    if missing:
        raise SystemExit(f"Cannot begin {args.gate}; missing completed gate(s): {', '.join(missing)}")

    data["active_gate"] = args.gate
    data["active_gate_started_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    data["baseline_changed_files"] = changed_files()
    event(data, "begin", args.gate, parse_evidence(args.evidence))
    write_json(STATE_FILE, data)
    print(f"Gate begun: {args.gate}")
    return 0


def end(args: argparse.Namespace) -> int:
    config = gates()
    gate_config = require_gate_name(config, args.gate)
    data = state()

    if data.get("active_gate") != args.gate:
        raise SystemExit(f"Cannot end {args.gate}; active gate is {data.get('active_gate')}.")

    evidence = parse_evidence(args.evidence)
    missing = [item for item in gate_config.get("required_evidence", []) if not evidence.get(item)]
    if missing:
        raise SystemExit(f"Cannot end {args.gate}; missing evidence: {', '.join(missing)}")

    completed = data.setdefault("completed_gates", [])
    if args.gate not in completed:
        completed.append(args.gate)
    data["active_gate"] = None
    data.pop("active_gate_started_at", None)
    data.pop("baseline_changed_files", None)
    event(data, "end", args.gate, evidence)
    write_json(STATE_FILE, data)
    print(f"Gate ended: {args.gate}")
    return 0


def status(_: argparse.Namespace) -> int:
    print(json.dumps(state(), indent=2, ensure_ascii=False))
    return 0


def reset(args: argparse.Namespace) -> int:
    if not args.yes:
        raise SystemExit("Refusing to reset gate state without --yes.")
    write_json(
        STATE_FILE,
        {
            "active_gate": None,
            "completed_gates": [],
            "baseline_changed_files": [],
            "events": []
        },
    )
    print("Gate state reset.")
    return 0


def parse_evidence(items: list[str]) -> dict[str, str]:
    evidence: dict[str, str] = {}
    for item in items:
        if "=" not in item:
            raise SystemExit(f"Evidence must use key=value form: {item}")
        key, value = item.split("=", 1)
        evidence[key.strip()] = value.strip()
    return evidence


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    begin_parser = subparsers.add_parser("begin")
    begin_parser.add_argument("gate")
    begin_parser.add_argument("--evidence", action="append", default=[])
    begin_parser.set_defaults(func=begin)

    end_parser = subparsers.add_parser("end")
    end_parser.add_argument("gate")
    end_parser.add_argument("--evidence", action="append", default=[])
    end_parser.set_defaults(func=end)

    status_parser = subparsers.add_parser("status")
    status_parser.set_defaults(func=status)

    reset_parser = subparsers.add_parser("reset")
    reset_parser.add_argument("--yes", action="store_true")
    reset_parser.set_defaults(func=reset)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
