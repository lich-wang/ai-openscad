# AI OpenSCAD Codex Guide

This file is the required Codex operating guide for this repository. The project
Codex config and session-start hook live in `.codex/` and are intended to make
new Codex threads load this guide before project work begins.

Canonical product documents:

- `README.md`
- `README.zh-CN.md`
- `docs/PRODUCT.md`
- `docs/PRODUCT.zh-CN.md`

## Scope Classification

Before starting work, the main agent must classify the user request.

Project work means product behavior, UI, workflow, source code, tests, build,
deployment, documentation, or release changes for AI OpenSCAD.

Codex maintenance means changes under `.codex/`, agent workflow rules, hooks,
custom agents, Codex config, or this guide.

General questions mean user questions that do not require changing this project.

The reusable project workflow below is mandatory for project work. Codex
maintenance and general questions may skip product gates, but Codex maintenance
must keep `.codex/` files organized and git-managed.

## Reusable Project Workflow

Every gate has a mechanical before/after command. The main agent must run the
before command before doing work inside that gate and the after command before
claiming the gate is complete.

Before command:

```bash
.codex/scripts/gate.py begin <gate>
```

After command:

```bash
.codex/scripts/gate.py end <gate> --evidence key=value
```

Gate definitions, required evidence, and allowed write paths are tracked in
`.codex/gates/gates.json`. Runtime gate state is written to
`.codex/runtime/gate-state.json`.

Codex hook enforcement:

- `SessionStart` reads `.codex/AGENTS.md`.
- `PreToolUse` blocks write-like tools when no gate is active.
- `PostToolUse` checks that files changed after the gate began are allowed by
  the active gate.
- `Stop` fails when a gate is still active and has not been ended with evidence.

### 1. Requirements Analysis Gate

1. The main agent receives the user request and decides whether it is project
   work, Codex maintenance, or a general question.
   - Before hook: `.codex/scripts/gate.py begin scope_classification`
   - After hook: `.codex/scripts/gate.py end scope_classification --evidence request_classification=... --evidence reason=...`
2. For project work, the main agent analyzes the requirement and updates the
   bilingual product documents before implementation:
   - `docs/PRODUCT.md`
   - `docs/PRODUCT.zh-CN.md`
3. The main agent spawns review subagents with enough context:
   - BA agent reviews from the user's point of view.
   - UX agent reviews UI/UX and interaction design.
   - SA agent reviews system design and implementation feasibility.
4. The main agent collects subagent feedback, checks for conflicts, resolves
   conflicts explicitly, updates the product documents, then starts another
   subagent review of the updated documents.
5. The document gate ends only after BA, UX, and SA feedback is consistent or
   all conflicts are explicitly resolved in the product documents.
   - Before hook: `.codex/scripts/gate.py begin requirements_analysis`
   - After hook: `.codex/scripts/gate.py end requirements_analysis ...`

### 2. Test Case Gate

1. The main agent drafts test cases from the accepted product documents.
   - Before hook: `.codex/scripts/gate.py begin test_case`
2. The main agent starts subagent showcase/review:
   - BA checks user-value coverage and missing scenarios.
   - UX checks interaction states, screenshots, accessibility, and visual risks.
   - SA checks architecture, integration boundaries, mocks, and test reliability.
3. The main agent collects feedback, resolves conflicts, updates test cases, and
   starts another subagent review of the updated cases.
4. The main agent runs red tests. If a red test result is abnormal, the test case
   must be corrected and reviewed again by subagents.
5. The red-test gate ends only when BA, UX, and SA agree the cases are adequate
   and the red tests fail for the expected reason.
   - After hook: `.codex/scripts/gate.py end test_case ...`

### 3. Coding Gate

1. The main agent writes the code.
   - Before hook: `.codex/scripts/gate.py begin coding`
2. After coding, UX and SA subagents review the code and implementation result.
3. The main agent may modify the code only after collecting and reconciling the
   review feedback.
4. Repeat implementation and review until UX and SA feedback is consistent and
   all required fixes are addressed.
   - After hook: `.codex/scripts/gate.py end coding ...`

### 4. Green Test Gate

1. The main agent runs the green tests.
   - Before hook: `.codex/scripts/gate.py begin green_test`
2. If tests fail, the main agent must not immediately modify code. It starts BA,
   UX, and SA review to classify the failure as one of:
   - Product document problem.
   - Test case problem.
   - Code problem.
   - Environment problem.
3. If the product document is wrong, restart from the Requirements Analysis Gate.
4. If the test case is wrong, restart from the Test Case Gate.
5. If the code is wrong, restart from the Coding Gate.
6. If the environment is wrong, capture evidence, rerun when reasonable, and
   document the blocker.
   - After hook: `.codex/scripts/gate.py end green_test ...`

### 5. Local E2E And Release Gate

1. Run the local E2E suite after green tests.
   - Before hook: `.codex/scripts/gate.py begin local_e2e_release`
2. UI changes require screenshot coverage and image-based confirmation that the
   intended visual change is present.
3. After local E2E passes, prepare the release path through GitHub and GitHub
   Actions.
4. Deployment target is Cloudflare.
   - After hook: `.codex/scripts/gate.py end local_e2e_release ...`

## Project Requirements Management

### Product Documents

There is one current product document in two languages, and both must stay in
sync:

- English: `docs/PRODUCT.md`
- Chinese: `docs/PRODUCT.zh-CN.md`

Avoid dated historical requirement files that compete with the current product
truth. Update the current bilingual documents together.

### README Documents

Keep setup and operating documentation bilingual:

- English: `README.md`
- Chinese: `README.zh-CN.md`

### Source Code

Write source code in a Linux-kernel-like style: simple, direct, efficient, and
low ceremony. Prefer small reusable modules, clear ownership boundaries, and
minimal abstractions that earn their keep. Avoid decorative layers, sprawling
helpers, and speculative extensibility.

### Tests

Keep one authoritative test suite. It should include unit tests, feature tests,
and E2E tests.

Mocking rule: when external-service mocks are needed, base mock payloads and
request shapes on real requests captured from the external service or its
current official contract. Do not invent unsupported provider behavior.

E2E rule: cover the complete user workflow, not only the feature under active
development.

UI rule: UI tests require screenshots, and visual changes should be confirmed
with image recognition or equivalent visual inspection evidence.

### Environment Files And Secrets

Use `.env` files for local secrets and provider keys. Secret-bearing files must
not enter git. Keep `.env`, `.env.local`, `.dev.vars`, and similar files ignored.

Document required variables without committing their values.

### Codex Files

All Codex-specific project files belong under `.codex/` and should be tracked by
git unless they contain secrets or machine-local runtime output.

## Agents

### Main Agent

The main agent owns all generated artifacts and final integration. It must call
subagents for required gates, provide enough context in every subagent task, wait
for their feedback, and use that feedback to drive the next step. The main agent
must not skip subagent review or assume a subagent conclusion.

Required gate reviews are project-workflow authorization to use subagents. The
main agent does not need the user to explicitly request BA, UX, or SA subagents
again before running a required gate review.

### BA Agent

The BA agent reviews from the user's point of view. It checks whether the
requirement, document, test, or implementation helps the user complete the real
workflow, identifies missing scenarios, and flags confusing or low-value output.

### UX Agent

The UX agent reviews as a UI/UX designer. It checks information architecture,
interaction states, visual hierarchy, accessibility, responsive behavior,
screenshot expectations, and whether UI changes are actually visible to users.

### SA Agent

The SA agent reviews from a system architecture and implementation-design point
of view. It checks module boundaries, data flow, provider contracts, rendering
pipeline behavior, failure modes, CI/CD impact, and maintainability.

## CI/CD

The project uses GitHub and GitHub Actions for source control automation and CI.
The system deploys to Cloudflare.

Before release, run the expected local gates:

```bash
npm test
npm run test:e2e
npm run build
```

Production target:

- Cloudflare Pages project: `ai-openscad`
- Domain: `https://ai.openscad.tech`

## Product Invariants

AI OpenSCAD is a browser workbench for natural-language to OpenSCAD modeling.
Preserve these behaviors unless the bilingual product documents are intentionally
updated:

- The first screen is the usable workbench.
- The workflow is requirement -> code generation -> browser render -> visual
  review -> user-confirmed iteration -> final export.
- Visual review must not automatically trigger another text LLM call.
- The user can edit the review-generated correction prompt before iterating.
- Accepting a revision clears stale review state and requires a fresh review.
- Draft iteration uses low precision for speed; final export uses higher
  precision.
- Project data, API keys, prompt traces, and history are local browser state
  unless the user exports JSON or calls a model provider.
- Advanced OpenSCAD code editing remains available.

## Important Paths

- `src/App.tsx` - main workbench workflow and UI state.
- `src/lib/apiClient.ts` - model calls, review parsing, revision requests, token
  estimates.
- `src/lib/models.ts` - model presets and provider routing.
- `src/lib/openscadSkills.ts` - prompt assembly for code, revision, and vision
  review.
- `src/lib/render.ts` - OpenSCAD compile/render adapter.
- `src/lib/renderWorker.ts` - worker compile path.
- `src/lib/capture.ts` - STL to front/top/right PNG capture.
- `src/lib/project.ts` - project persistence, import, and export.
- `src/lib/i18n.ts` - English and Chinese UI strings.
- `functions/_shared/modelGateway.ts` - Cloudflare provider proxy.
- `tests/` - Playwright workflow and screenshot coverage.
