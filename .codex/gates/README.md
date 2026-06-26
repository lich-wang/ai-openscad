# Codex Gates

This directory defines the enforceable Codex workflow gates for AI OpenSCAD.

Gate state is runtime data and is written to `.codex/runtime/gate-state.json`.
That runtime directory is ignored by git; gate definitions and scripts are
tracked.

## Commands

Start a gate:

```bash
.codex/scripts/gate.py begin <gate>
```

End a gate with required evidence:

```bash
.codex/scripts/gate.py end <gate> --evidence key=value
```

Show current state:

```bash
.codex/scripts/gate.py status
```

Reset local runtime state:

```bash
.codex/scripts/gate.py reset --yes
```

## Gate Order

Project work must follow this order:

1. `scope_classification`
2. `requirements_analysis`
3. `test_case`
4. `coding`
5. `green_test`
6. `local_e2e_release`

Codex workflow maintenance uses `codex_maintenance`.

## Hook Enforcement

- `SessionStart` reads `.codex/AGENT.md`.
- `PreToolUse` blocks write-like tools when no gate is active.
- `PostToolUse` checks that files changed after the gate began fit the active
  gate's allowed write paths.
- `Stop` fails when a gate is still active and has not been ended with evidence.

Each gate has a before/after command:

- Before hook: `.codex/scripts/gate.py begin <gate>`
- After hook: `.codex/scripts/gate.py end <gate> --evidence ...`

The required after-hook evidence is defined in `gates.json`.
