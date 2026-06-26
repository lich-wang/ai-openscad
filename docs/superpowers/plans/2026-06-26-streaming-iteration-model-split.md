# Streaming Iteration And Model Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` for implementation. When tasks have disjoint file ownership and no dependencies, dispatch them in parallel waves; use `superpowers:executing-plans` only when subagents are unavailable or sequential execution is required. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LLM generation stream visibly, support review-driven re-iteration, separate LLM and vision API keys/model selection, and keep Chinese user workflows in Chinese.

**Architecture:** Add small pure modules for streaming chunk parsing and language instruction. Extend the model gateway to proxy OpenAI-compatible streaming responses. Frontend generation and revision use streaming callbacks to update code/proposed code and prompt trace while the response arrives; vision remains structured non-streaming JSON. Project state stores separate LLM and vision model choices, while API keys stay in browser-only local storage.

**Tech Stack:** React, TypeScript, Vite, Vitest, Playwright, Cloudflare Pages Functions.

---

### Task 1: Pure Streaming And Language Tests

**Files:**
- Create: `src/lib/streaming.ts`
- Create: `src/lib/streaming.test.ts`
- Create: `src/lib/languageSkill.ts`
- Create: `src/lib/languageSkill.test.ts`

- [ ] Write failing tests for OpenAI SSE delta parsing.
- [ ] Write failing tests for Chinese input generating Chinese output instructions.
- [ ] Implement the pure helpers.

### Task 2: Prompt And Iteration Tests

**Files:**
- Modify: `src/lib/openscadSkills.ts`
- Modify: `src/lib/apiClient.ts`
- Create: `src/lib/apiClient.test.ts`

- [ ] Write tests that revision prompts include review feedback and optional user iteration notes.
- [ ] Write tests that Chinese requirements add Chinese response instructions.
- [ ] Implement streaming generation/revision APIs with `onToken` callbacks.

### Task 3: Gateway Streaming

**Files:**
- Modify: `functions/_shared/modelGateway.ts`
- Modify: `functions/_shared/modelGateway.test.ts`

- [ ] Add `stream?: boolean` to gateway body.
- [ ] Proxy upstream streaming responses as `text/event-stream`.
- [ ] Keep non-streaming JSON behavior for vision.

### Task 4: UI Model/Key Split And Iteration

**Files:**
- Modify: `src/lib/project.ts`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [ ] Add separate LLM API key and Vision API key inputs.
- [ ] Add separate LLM Model and Vision Model selectors.
- [ ] Stream code text into the editor during generation.
- [ ] Add user iteration notes and an `Iterate Again` action that combines requirement, current code, vision review, and notes.
- [ ] Show separate LLM/Vision token estimates.

### Task 5: E2E And Screenshot Coverage

**Files:**
- Modify: `tests/review.spec.ts`
- Modify: `tests/ui.spec.ts`
- Add/update snapshots.

- [ ] Test streaming code appears before the request finishes.
- [ ] Test review-driven iteration creates proposed code.
- [ ] Update screenshot snapshot for the split model/key UI.

### Task 6: Verify And Deploy

**Files:**
- Existing files only.

- [ ] Run `npm test`.
- [ ] Run `npm run test:e2e`.
- [ ] Run `npm run build`.
- [ ] Deploy to Cloudflare Pages.
