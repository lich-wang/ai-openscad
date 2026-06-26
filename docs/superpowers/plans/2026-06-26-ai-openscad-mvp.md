# AI OpenSCAD MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` for implementation. When tasks have disjoint file ownership and no dependencies, dispatch them in parallel waves; use `superpowers:executing-plans` only when subagents are unavailable or sequential execution is required. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy the first Cloudflare Pages MVP for AI-assisted OpenSCAD generation, browser rendering, vision review, and user-confirmed iteration.

**Architecture:** Use a Vite React frontend with focused TypeScript modules for model orchestration, project persistence, prompt skills, rendering, and iteration state. Use Cloudflare Pages Functions as a stateless BYOK model gateway. Keep rendering behind a `RenderAdapter` so browser WASM can later be replaced by MCP.

**Tech Stack:** React, TypeScript, Vite, Vitest, Cloudflare Pages Functions, Wrangler, openscad-wasm.

---

### Task 1: Project Foundation

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/test/setup.ts`
- Create: `.gitignore`
- Create: `wrangler.toml`

- [ ] Add Vite React, Vitest, TypeScript, Wrangler, and OpenSCAD WASM dependencies.
- [ ] Add build, test, preview, and deploy scripts.
- [ ] Verify `npm install` and `npm test` run.

### Task 2: Core Domain Tests First

**Files:**
- Create: `src/lib/models.test.ts`
- Create: `src/lib/project.test.ts`
- Create: `src/lib/workflow.test.ts`
- Create: `src/lib/render.test.ts`

- [ ] Write failing tests for model presets and request normalization.
- [ ] Write failing tests for project import/export without API keys.
- [ ] Write failing tests for user-confirmed iteration transitions.
- [ ] Write failing tests for render adapter fallback.

### Task 3: Core Domain Implementation

**Files:**
- Create: `src/lib/models.ts`
- Create: `src/lib/project.ts`
- Create: `src/lib/workflow.ts`
- Create: `src/lib/render.ts`
- Create: `src/lib/openscadSkills.ts`

- [ ] Implement model presets and normalized gateway payloads.
- [ ] Implement local project serialization.
- [ ] Implement iteration state helpers.
- [ ] Implement `BrowserOpenScadAdapter` and fallback behavior.
- [ ] Implement OpenSCAD/BOSL2 skill prompt context.
- [ ] Run tests until green.

### Task 4: Cloudflare Model Gateway

**Files:**
- Create: `functions/api/llm.ts`
- Create: `functions/api/vision.ts`
- Create: `functions/_shared/modelGateway.ts`
- Create: `functions/_shared/cors.ts`

- [ ] Implement stateless BYOK CORS endpoints.
- [ ] Normalize MiMo V2.5 and DeepSeek V4 request shapes through generic payloads.
- [ ] Return normalized errors without logging keys.

### Task 5: Frontend Workspace

**Files:**
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/styles.css`
- Create: `src/lib/apiClient.ts`
- Create: `src/lib/capture.ts`

- [ ] Build the no-login workspace UI.
- [ ] Add API key input, model selectors, prompt box, code editor, render/review controls, view thumbnails, review panel, iteration history, import, and export.
- [ ] Wire generation, compile, vision review, proposed revision, and user confirmation.

### Task 6: Verify And Deploy

**Files:**
- Modify: existing files only if verification exposes defects.

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Deploy with Wrangler Pages using `.env` Cloudflare credentials.
- [ ] Report deployed URL and known limitations.
