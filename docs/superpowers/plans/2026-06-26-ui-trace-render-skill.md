# UI Trace And Render Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` for implementation. When tasks have disjoint file ownership and no dependencies, dispatch them in parallel waves; use `superpowers:executing-plans` only when subagents are unavailable or sequential execution is required. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate project workflow concerns from 3D model/rendering concerns, improve the workspace layout, show AI prompt traffic, and add Playwright screenshot coverage.

**Architecture:** Keep project state and prompt trace in project/workflow files, while 3D modeling instructions and precision policy live in dedicated model/render skill files. The frontend consumes those focused modules and renders a denser workbench with prompt trace above a smaller code editor. Playwright covers both behavior and UI screenshot stability.

**Tech Stack:** React, TypeScript, Vite, Vitest, Playwright, Cloudflare Pages, OpenSCAD WASM.

---

### Task 1: Project Trace Domain

**Files:**
- Modify: `src/lib/project.ts`
- Create: `src/lib/promptTrace.ts`
- Test: `src/lib/promptTrace.test.ts`

- [ ] Write failing tests for prompt trace entries that record model, phase, system prompt, user prompt, and timestamp.
- [ ] Implement prompt trace helpers and add `promptTrace` to project persistence.
- [ ] Run `npm test -- src/lib/promptTrace.test.ts`.

### Task 2: 3D Model Skill And Render Precision

**Files:**
- Create: `src/lib/modelSkill.ts`
- Create: `src/lib/renderSkill.ts`
- Modify: `src/lib/openscadSkills.ts`
- Modify: `src/lib/apiClient.ts`
- Test: `src/lib/renderSkill.test.ts`

- [ ] Write failing tests for draft/final render skill prompts and code precision normalization.
- [ ] Move model-specific OpenSCAD/BOSL2 guidance into `modelSkill.ts`.
- [ ] Add render precision policy in `renderSkill.ts`: draft is low precision for compile/review, final is high precision for export.
- [ ] Make generation/revision prompts use draft precision by default and expose final export guidance.
- [ ] Run targeted tests.

### Task 3: Workspace Layout And Prompt Trace UI

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [ ] Show Prompt Trace in the center column above the smaller code editor.
- [ ] Prevent left action buttons from overflowing by using a stable action grid.
- [ ] Add an explicit high-precision export action that prompts before final generation/export.
- [ ] Keep views, compiler, review, and history in a stable right rail.

### Task 4: Playwright UI Screenshot Coverage

**Files:**
- Modify: `tests/review.spec.ts`
- Add: `tests/ui.spec.ts`

- [ ] Add screenshot assertions for the desktop workbench.
- [ ] Verify Prompt Trace is visible and actions do not overlap.
- [ ] Run `npm run test:e2e`.

### Task 5: Verification And Deploy

**Files:**
- Existing files only.

- [ ] Run `npm test`.
- [ ] Run `npm run test:e2e`.
- [ ] Run `npm run build`.
- [ ] Deploy with Wrangler Pages.
