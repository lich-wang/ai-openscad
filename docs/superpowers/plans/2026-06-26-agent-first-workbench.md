# Agent-First Workbench Implementation Plan

> **For agentic workers:** This change is tightly coupled across `src/App.tsx`, `src/styles.css`, and UI tests. Use `superpowers:executing-plans` and keep TDD red/green checkpoints.

**Goal:** Rework the UI from a code-centered editor into an Agent-centered workbench where the user sees the request, AI progress, generated output, preview, and review first.

**Architecture:** Keep the existing React state and model/render APIs. Reorder the layout into settings, agent stream, and preview columns; move OpenSCAD into a collapsed details panel; and make generation automatically compile a draft render after the model finishes streaming.

**Tech Stack:** React, TypeScript, CSS, Playwright, Vitest, Cloudflare Pages.

---

### Task 1: UI Regression Tests

**Files:**
- Modify: `tests/ui.spec.ts`
- Modify: `tests/review.spec.ts`

- [x] Add Playwright expectations for an `Agent Run` primary panel.
- [x] Add Playwright expectations that the OpenSCAD editor is collapsed by default.
- [x] Add Playwright expectations that the invite tooltip opens to the right of its trigger.
- [x] Add an E2E regression proving Generate triggers compile/render automatically.

### Task 2: Agent-First Layout

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/lib/i18n.ts`
- Modify: `src/styles.css`

- [x] Replace the center code-first layout with an agent run panel, compact prompt composer, and collapsed code details.
- [x] Move the code editor out of the primary visual path.
- [x] Keep settings and result panels compact.
- [x] Make invite tooltip open to the right.

### Task 3: Auto Render

**Files:**
- Modify: `src/App.tsx`
- Test: `tests/review.spec.ts`

- [x] Extract compile/render work into a reusable function.
- [x] After successful generation, compile draft precision and capture views automatically.
- [x] Keep manual compile available as rerender.

### Task 4: Verify And Deploy

**Files:**
- Existing files only.

- [x] Run `npm test`.
- [x] Run `npm run test:e2e`.
- [x] Run `npm run build`.
- [ ] Commit and deploy to Cloudflare Pages.
