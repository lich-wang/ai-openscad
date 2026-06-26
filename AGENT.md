# AI OpenSCAD Agent Operating Guide

This project is operated by a main agent plus specialist review subagents. The process below is mandatory for every product, UI, workflow, test, or deployment change.

## Roles

### Main Agent

The main agent owns communication with the user and final integration.

Responsibilities:

- Clarify the user's request when needed.
- Start the required subagents before implementation.
- Collect and reconcile subagent feedback.
- Update the design or requirement document before writing tests or code.
- Write failing tests first.
- Implement the change.
- Turn tests green.
- Run local E2E, including screenshot tests, before deployment.
- Deploy only after all required gates pass.
- Report what changed, what was verified, and what remains.

### User Review Subagent

The User Review subagent reviews from the target user's perspective.

Responsibilities:

- Describe how a user expects to complete the task.
- Identify likely confusion, blocked states, and missing feedback.
- Check whether the proposed behavior helps the user deliver a model.
- Review final UX changes against the user's real task flow.

### UX Review Subagent

The UX Review subagent reviews information architecture and interaction design.

Responsibilities:

- Check layout hierarchy, visual priority, and interaction clarity.
- Verify that the Agent workflow, model preview, and STL delivery remain primary.
- Identify layout instability, overflow, awkward scrolling, or confusing controls.
- Define screenshot and UI regression expectations.

### SA Review Subagent

The SA Review subagent reviews from system architecture and design consistency.

Responsibilities:

- Check whether the change fits the Web Agent architecture.
- Verify that Render MCP, LLM, vision review, project state, and persistence boundaries stay clean.
- Identify whether a request needs document, test, code, or architecture changes.
- Review risks around deployment, async behavior, data flow, and future MCP replacement.

## Required Workflow

Every request follows this order.

### 1. Intake

The main agent reads the user request and identifies the affected workflow:

- Agent UX
- OpenSCAD generation
- Render MCP
- Vision review
- Project history
- API key/model settings
- Export/download
- Testing/deployment

The main agent must not start implementation during intake.

### 2. Start Subagents

For every non-trivial request, the main agent starts:

- User Review subagent
- UX Review subagent
- SA Review subagent

The subagents provide opinions before implementation. If the request is extremely small, such as a typo or one-line documentation correction, the main agent may skip subagents only after explicitly stating why the request is trivial.

### 3. Consolidate Design

The main agent summarizes the subagent feedback into a project document before writing tests or code.

Use one of these locations:

- `docs/superpowers/specs/` for design or product behavior.
- `docs/superpowers/plans/` for implementation plans.
- `AGENT.md` for agent operating rules.

The document must state:

- User goal.
- Intended workflow.
- UI/UX behavior.
- Data flow.
- Test expectations.
- Deployment verification.

If the existing document is wrong or incomplete, update it before changing tests or code.

### 4. Red Tests

The main agent writes failing tests that prove the requested behavior is missing.

Required test types depend on scope:

- Unit tests for pure logic, parsing, prompt assembly, adapters, persistence, and state transitions.
- Playwright E2E tests for user workflow.
- Screenshot tests for layout and visual hierarchy.
- Online smoke tests for deployed behavior when deployment is part of the request.

The main agent must run the new tests and confirm they fail for the expected reason.

### 5. Implementation

The main agent writes code only after red tests exist.

Implementation rules:

- Keep changes scoped to the documented request.
- Preserve the Web Agent workflow:
  - user requirement
  - OpenSCAD skill plus text LLM
  - Render MCP
  - three views plus STL
  - vision review
  - editable correction prompt
  - user-confirmed next iteration
- Do not let vision review automatically call the text LLM.
- Do not let history, logs, or settings dominate the main workflow.
- Update documents if implementation reveals the design was incomplete.

### 6. Green Tests

The main agent reruns the failing tests and confirms they pass.

Then run the broader checks:

- `npm test`
- `npm run test:e2e`
- `npm run build`

For deployed changes, run Playwright against the Pages preview. Use a 60s timeout because the OpenSCAD worker bundle is large.

### 7. Test Failure Review Loop

When tests fail, do not immediately change code or tests.

The main agent must restart or consult the relevant subagents and classify the failure:

- Document problem: the design or requirement is wrong or incomplete.
- Test problem: the test does not match the documented requirement.
- Code problem: implementation does not satisfy the document and tests.
- Environment problem: network, Pages cold start, provider outage, or local tooling issue.

Required response by classification:

- If the document is wrong, update the document first, then update tests and code.
- If the test is wrong, update the test and explain why the documented behavior did not change.
- If the code is wrong, fix code while keeping the test.
- If the environment is wrong, rerun with evidence or document the external blocker.

No failure may be handled by silently weakening tests.

### 8. Release

Before production deployment:

- Local unit tests pass.
- Local E2E tests pass.
- Local screenshot tests pass.
- Production build passes.
- Required documents are updated.
- Git status is understood; unrelated user artifacts are not committed.

Deployment target:

- Cloudflare Pages project: `ai-openscad`
- Production domain: `https://ai.openscad.tech`

After deployment:

- Run E2E against the Pages preview.
- Run key workflow tests against `https://ai.openscad.tech`.
- Verify `curl -I https://ai.openscad.tech` returns HTTP 200.

## Webhook Stage Gate

A webhook must be used to prevent skipped stages. The webhook should receive lifecycle events from the main agent or CI and reject out-of-order transitions.

### Required Stage Order

1. `request.received`
2. `subagents.started`
3. `subagents.completed`
4. `design.updated`
5. `tests.red_written`
6. `tests.red_confirmed`
7. `code.changed`
8. `tests.green_confirmed`
9. `local.e2e_passed`
10. `screenshot.passed`
11. `build.passed`
12. `deploy.started`
13. `preview.e2e_passed`
14. `production.smoke_passed`
15. `release.completed`

### Webhook Payload

Each event should include:

```json
{
  "project": "ai-openscad",
  "stage": "tests.green_confirmed",
  "requestId": "stable-request-id",
  "commit": "git-sha-or-empty-before-commit",
  "actor": "main-agent",
  "timestamp": "ISO-8601",
  "evidence": {
    "commands": ["npm test", "npm run test:e2e"],
    "documents": ["docs/superpowers/specs/example.md"],
    "subagents": ["user-review", "ux-review", "sa-review"]
  }
}
```

### Webhook Enforcement Rules

The webhook must reject:

- `code.changed` before `tests.red_confirmed`.
- `tests.green_confirmed` before `code.changed`.
- `deploy.started` before local tests, screenshot tests, and build pass.
- `release.completed` before preview E2E and production smoke pass.
- Any code-only change when the failure classification says the document is wrong.
- Any test-only weakening without a linked document update or written justification.

### Minimum Evidence

Required evidence by stage:

- `subagents.completed`: summaries from User Review, UX Review, and SA Review.
- `design.updated`: changed design/spec/plan file path.
- `tests.red_confirmed`: command output showing expected failure.
- `tests.green_confirmed`: command output showing pass.
- `screenshot.passed`: Playwright screenshot test output.
- `build.passed`: production build output.
- `preview.e2e_passed`: preview URL and Playwright output.
- `production.smoke_passed`: production URL and smoke output.

## Testing Standards

### Core E2E Coverage

The Playwright suite should protect:

- User enters a requirement and generates SCAD.
- SCAD generation streams visibly.
- Render MCP returns front/top/right images and STL.
- STL download is enabled only when STL exists.
- Vision review sends images to the vision model.
- Vision review does not call the text LLM automatically.
- Vision review returns an editable correction prompt.
- User edits or confirms correction prompt before next generation.
- Regeneration clears stale review and requires a fresh review.
- Invalid OpenSCAD does not freeze the page.

### UI Screenshot Coverage

Screenshot tests should protect:

- Three-view layout.
- STL download prominence.
- Agent stage rail.
- Composer placement.
- Collapsible basic settings.
- Stable sidebar history placement.
- OpenSCAD code collapsed by default.
- Run details collapsed by default.

## Documentation Rules

Documents are part of the product.

Update documentation when:

- User workflow changes.
- UI hierarchy changes.
- Render MCP contract changes.
- Vision review contract changes.
- Test expectations change.
- Deployment or webhook rules change.

Do not fix only code or only tests when the design changed.

## Current Design References

- `docs/superpowers/specs/2026-06-26-ai-openscad-design.md`
- `docs/superpowers/specs/2026-06-26-agent-workbench-uiux-design.md`

These documents guide future work unless superseded by a newer dated spec.
