# AI OpenSCAD Product Document

[中文文档](PRODUCT.zh-CN.md)

## Product Positioning

AI OpenSCAD is an agent-style CAD workbench for people who want a printable or
inspectable 3D model but prefer to describe the result in natural language first.
The product turns a user requirement into OpenSCAD code, renders a draft model in
the browser, uses visual review to find modeling issues, and helps the user
iterate until the model is ready to export.

The core promise is:

> Text to OpenSCAD, OpenSCAD to model, model to visual review, review to a better
> next draft.

## Project Metadata

- Production: `https://ai.openscad.tech`
- Repository: `https://github.com/lich-wang/ai-openscad`
- License: GNU Affero General Public License v3.0 only (`AGPL-3.0-only`)
- README: `README.md` and `README.zh-CN.md`

The README files should stay intentionally short: project identity, GitHub
activity, contributor images, product-document links, quick start commands, and
license summary. Product behavior, implementation details, development workflow,
deployment notes, testing expectations, and constraints belong in this product
document.

## Target Users

- Makers who can describe the object they need but do not want to write all CSG
  code manually.
- OpenSCAD users who want a fast first draft and an editable code escape hatch.
- Product or hardware prototypers who need quick STL output for inspection.
- Chinese and English users; the app follows browser locale and mirrors the
  user's language in model feedback and comments.

## Current Product Surface

### Workbench Layout

The first screen is the working app, not a landing page. It is organized into
three columns:

- Left control panel: basic settings and project import/export first, then the
  new model action and local model list.
- Center agent panel: pipeline stage arrows, Codex-style chat run stream,
  requirement composer, workflow actions, and advanced OpenSCAD code editing.
- Right result panel: large front/top/right views and asset downloads.

### Main Workflow

1. User writes a requirement, for example a six-slot organizer or a 30 ml cup.
2. User clicks **Generate**.
3. The code model streams OpenSCAD into the center chat stream in real time.
4. After the complete code arrives, the run stream collapses the code preview
   and the render adapter compiles the generated OpenSCAD in the browser.
5. The app captures front, top, and right PNG views from the STL.
6. User clicks **Review**.
7. The vision model checks the three views against the original requirement and
   returns a summary, issue list, confidence score, and correction prompt.
8. The correction prompt becomes editable in the composer and gives concrete
   instructions about which OpenSCAD areas or geometry relationships should be
   changed.
9. User clicks **Iterate Again** to send the latest accepted/rendered
   OpenSCAD, the original requirement, review findings, and editable iteration
   guidance to the LLM, then generate and render the next draft.
10. User clicks **Final Export** when satisfied.
11. The app normalizes the model to final precision and downloads `.scad` and
    `.stl` files.

### User Control Rules

- Visual review only reviews. It must not automatically call the text LLM.
- The user can edit the correction prompt before another generation.
- A pending revision must be accepted and rendered before project export.
- Accepting a revision clears the old review, forcing a fresh review for the new
  rendered model.
- OpenSCAD code remains editable through the advanced code panel.
- The workbench shows the current workflow stage across the top of the agent
  panel as a cyclic pipeline arrow: code generation -> model rendering -> model
  review -> next iteration.
- Visual review output belongs in the center agent run stream and its correction
  prompt is copied into the editable composer; the right result panel does not
  duplicate review text, compiler logs, or history.
- The center run stream uses chat-style records before and after each LLM
  interaction, similar to Codex desktop. User instructions, streaming assistant
  output, renderer tool progress, render completion, review output, and iteration
  events are visible as separate records.
- The primary composer action follows project state: generate before rendering,
  review after rendering, and iterate again after review.
- Token estimates and duplicate ready status badges are hidden from the normal
  workbench surface to keep more room for the model list and the three views.
- AI prompt trace details are not part of the normal workbench surface.

Workbench acceptance criteria:

- Left panel order is stable on desktop and in narrower stacked layouts: basic
  settings, project import/export, new model button, then the local model list
  for navigation. The local model list scrolls internally when it grows and is
  distinct from run history.
- The No key invitation hint shows the invite image at 50% of its source size,
  preserving the source aspect ratio and constrained by the available viewport.
  It must not crop the invite image into a square or upscale it in a way that
  makes it blurry.
- Token estimates are removed from the normal workbench surface. Busy progress,
  pending revision warnings, and errors remain visible through the agent stage
  strip and center agent stream.
- The stage strip is informational and not interactive. It has exactly three
  arrow-shaped stages: code generation, model rendering, and model review. Each
  stage can show waiting, active, complete, or blocked/error state, and the
  rendering stage becomes active during the automatic render after generation.
  The visual treatment should imply that review feedback can cycle back into
  code generation for another iteration.
- Starting another iteration resets the current-cycle stage states so code
  generation becomes active again, rendering waits until code completion, and
  review waits for the new rendered views.
- The composer primary action is disabled while any generation, render, review,
  or export task is running. It shows Generate when no rendered views exist,
  Review when views exist and there is no current review, and Iterate Again
  after review when no pending revision is waiting for acceptance. Missing
  inputs, provider-key failures, compile failures, and review failures appear in
  the center stream without changing the right panel contract. While a pending
  revision is waiting for acceptance, the composer shows an acceptance hint
  instead of Generate, Review, or Iterate Again; the user must accept or reject
  the revision before continuing the main workflow.
- The center agent stream remains the place for user request records, streaming
  generated code, collapsed completed code, compiler output, render start,
  render progress, render completion, render errors, review summary, review
  issues, confidence, correction prompt, and iteration events. Completed code is
  collapsed by default so it does not dominate the center panel, while the
  advanced OpenSCAD editor remains available below the composer.
- For a new or empty task, the center agent stream still keeps the same Agent
  Run header text at the top of the panel and uses the same stream container,
  spacing, and basic structure as populated chat runs without showing a separate
  AI Thinking placeholder card. The first run should add records into the same
  surface instead of causing a major layout jump.
- Chat run records include user request, assistant generation/revision,
  renderer tool start/progress/finished, review start/result, correction prompt
  ready, iteration start, and error records. Render records may be backed by the
  MCP/render adapter internally, but the user-facing copy should say render or
  renderer tool instead of unexplained implementation terms.
- Streaming and stage status updates should use polite live-region behavior or
  equivalent accessible status text. Collapsed code controls expose expanded or
  collapsed state through accessible labels.
- The right result panel contains only the three orthographic views and asset
  download controls. It must not contain compiler logs, review text, prompt
  trace, or iteration history. On desktop, the front view is the largest view,
  top and right views stay visible below it, and the panel reserves most of its
  height for images rather than text. The view grid should use at least half of
  the visible right-panel height at a 1440 px desktop viewport.
- Manual OpenSCAD edits can be recompiled with the secondary rerender action
  whenever code exists. Rerender failures appear in the center stream and keep
  the workbench interactive.
- Render timeouts explain that the draft exceeded the browser render complexity
  budget, keep the render stage in an error state, preserve the current
  editable OpenSCAD, and leave rerender available after the user simplifies the
  draft or edits the code.
- A representative textured model such as a 20 cm wavy cup should be generated
  for draft review with coarse, inspectable wave geometry, without 100-layer
  stacked `linear_extrude()` bodies, dense polygon wave rings, or per-layer
  boolean hollowing. The generated draft should stay within the 45 second
  browser render timeout and produce visible front, top, and right views.
- The same browser render complexity budget applies to first drafts,
  review-driven revisions, and user-edited correction-prompt iterations.
- Stage strip and action states use text labels plus visual treatment, not color
  alone, and preserve keyboard focus order from left panel to agent panel to
  result panel. Chat records distinguish user, assistant, renderer tool, and
  review roles with labels and layout, not color alone.
- Automated E2E coverage should use structural, accessibility, geometry, and
  state assertions for the arrow pipeline stage strip,
  current-cycle reset after iteration, Codex-style chat records, collapsed
  completed code with expand access, render start/done notices, absence of
  normal-surface prompt trace UI, review-to-correction handoff, iteration
  requests containing original requirement, latest accepted code, and editable
  guidance, left-panel ordering
  on desktop and narrower stacked layouts, hidden token/duplicate ready UI,
  right-panel ownership, enlarged views, and primary action transitions across
  generate, render, review, pending-revision, rerender-failure, and iterate
  states, including non-color state labels and keyboard focus order.
  Playwright pixel screenshot checks run only in local visual-regression checks
  and must be skipped in CI.
- Local E2E render coverage must include the full user-reported 20 cm wavy cup
  OpenSCAD file with layered `linear_extrude()` wave rings, verify that the
  browser renderer completes, and confirm the three rendered views contain
  visible model pixels.

## Feature Inventory

### Generation

- Uses a code-focused system prompt that asks for valid, deterministic, complete
  OpenSCAD.
- Bundles the practical `lich-3D/SCAD` printable-modeling skill into text LLM
  prompts. The web app does not read local Codex skill folders at runtime;
  instead, the product prompt includes the source-derived modeling patterns,
  printability heuristics, tolerances, BOSL2 preferences, and physical-part
  workflow needed for generated models.
- Models in millimeters.
- Requests named parameters, stable CSG, clear module boundaries, and printable
  geometry.
- Draft-generation prompts include a browser render complexity budget: generated
  code should avoid many-layer stacked extrusions, dense decorative arrays,
  per-layer boolean operations, and high segment counts during normal
  iteration. Textured or wavy surfaces should use coarse, inspectable
  approximations for draft review. Final export recompiles the accepted source
  at final precision; it does not automatically regenerate a more expensive
  model.
- Applies the same printable-modeling skill context to first-generation and
  review-driven revision text requests so iterations preserve printable walls,
  gaps, orientation, and assembly constraints instead of only matching the
  visual review.
- Detects Chinese vs English input and asks the model to use the same natural
  language for feedback and comments.
- Streams OpenAI-compatible response chunks into the chat run stream and the
  editable code state at the same time.

### Rendering

- Uses `openscad-wasm` in the browser.
- Runs compile work in a Web Worker when available.
- Uses the OpenSCAD Manifold backend for browser STL generation when available,
  with a safe fallback to the default backend if Manifold fails.
- Keeps a persistent render worker and reuses the initialized OpenSCAD WASM
  instance across render jobs. The workbench prewarms this worker so the first
  visible render pays less initialization cost.
- Enforces a default 45 second render timeout.
- Uses draft precision for normal iteration by normalizing `$fn` to 32.
- Captures three orthographic views from generated STL:
  - Front
  - Top
  - Right
- Uses Three.js lighting and STL parsing to create PNG data URLs.

### Review And Iteration

- Sends the original requirement, current OpenSCAD, and three rendered images to
  the vision endpoint.
- Expects JSON with:
  - `summary`
  - `issues`
  - `correctionPrompt`
  - `confidence`
- Falls back gracefully when the model returns malformed or non-JSON review text.
- The `correctionPrompt` should be specific enough for the text LLM to act on:
  it should reference the original requirement, the visible view or affected
  model area, the observed mismatch, constraints to preserve, the affected
  OpenSCAD modules or geometry relationships when inferable, and sizing,
  placement, or proportion guidance when available. It must not return revised
  code.
- Iteration requests send the latest accepted/rendered OpenSCAD code, original
  requirement, review summary, issue list, and editable review guidance to the
  text LLM so the next draft is a targeted modification rather than a fresh
  unrelated generation.
- Stores prompt traces for generation, compilation, review, revision, and final
  export in local project data for export/debugging, but normal users do not see
  a prompt trace panel in the workbench.

### Export

- Draft outputs:
  - Front PNG
  - Top PNG
  - Right PNG
  - STL
- Final output:
  - High-precision SCAD
  - High-precision STL
- Final export asks for confirmation because it recompiles the accepted source
  at higher precision and can be slower than draft render.

### Projects

- Stores the active project and model list in browser `localStorage`.
- Supports legacy single-project storage and the current multi-model list.
- Allows JSON project import and export.
- Keeps iteration history and prompt traces with the project.

### Internationalization

- Browser locale resolves to Chinese when any preferred locale starts with `zh`.
- All other locales use English.
- UI strings are maintained in `src/lib/i18n.ts`.

## System Architecture

- Frontend: React, Vite, and TypeScript.
- Rendering: `openscad-wasm` compiles OpenSCAD in the browser, preferably inside
  a Web Worker. Three.js parses STL output and captures orthographic PNG views.
- Model gateway: Cloudflare Pages Functions under `functions/api`.
- Persistence: browser `localStorage`; there is no server-side project database.
- Deployment: Cloudflare Pages project `ai-openscad`.

Important source areas:

- `src/App.tsx`: main workbench UI and user workflow state.
- `src/lib/apiClient.ts`: LLM, vision, revision, and token-estimate client.
- `src/lib/models.ts`: supported model presets and provider routing.
- `src/lib/render.ts`: browser OpenSCAD compile/render adapter.
- `src/lib/renderWorker.ts`: worker compile path.
- `src/lib/capture.ts`: STL to front/top/right PNG capture.
- `src/lib/project.ts`: project persistence, import, and export.
- `src/lib/i18n.ts`: English and Chinese UI strings.
- `functions/_shared/modelGateway.ts`: provider proxy for MiMo and DeepSeek.
- `tests/`: Playwright workflow coverage with structural, state, geometry, and
  accessibility assertions.

## Data Model

The core project state contains:

- Project identity: `id`, `title`, `updatedAt`
- User input: `requirement`, `originalRequirement`
- Model settings: `codeModelId`, `visionModelId`
- Model assets: `currentCode`, `proposedCode`, `stl`, `views`
- Runtime output: `compilerOutput`, `review`, `runEvents`
- Audit trail: `iterations`, `promptTrace`

Data is local to the browser unless the user explicitly exports a project JSON
file or calls an external model provider through the gateway.

## API And Provider Behavior

The frontend calls:

- `POST /api/llm` for code generation and revision.
- `POST /api/vision` for visual review.

Both endpoints are Cloudflare Pages Functions that proxy OpenAI-compatible chat
completion requests to configured providers.

Supported providers:

- MiMo at `https://api.xiaomimimo.com/v1`
- DeepSeek at `https://api.deepseek.com`

Authentication behavior:

- If the browser supplies an API key, the gateway forwards it to the provider.
- MiMo can fall back to `MiMo_KEY` or `MIMO_KEY` from the Pages environment.
- DeepSeek does not have a hosted fallback in the current app.

Current model presets:

- Code models:
  - MiMo V2.5 (`mimo-v2.5-pro`)
  - DeepSeek V4 Pro (`deepseek-v4-pro`)
- Vision models:
  - MiMo V2.5 (`mimo-v2.5`)

API keys entered in the browser are stored in `localStorage` and sent as bearer
tokens to the Pages Function gateway.

## Quality Bar

The app should preserve these guarantees:

- The primary workflow fits on desktop without hiding key actions.
- Draft generation and review make progress visible.
- Invalid OpenSCAD surfaces an error and leaves the page usable.
- STL download is available only after a successful compile.
- Review requests include rendered images.
- Review does not trigger text generation.
- New iterations clear stale review state.
- Text LLM requests include the built-in printable-modeling skill context used
  by the app, so prompt traces can show why generated code favors practical
  OpenSCAD modules, explicit tolerances, and 3D-printable geometry.
- CI E2E tests protect the desktop workbench layout and the left-panel order in
  narrower stacked layouts with structural and geometry assertions; Playwright
  screenshot assertions are local-only.

## Local Development

Use Node.js 24 or newer for local development and release checks.

Install dependencies:

```bash
npm install
```

Start the Vite development server:

```bash
npm run dev
```

Run unit tests:

```bash
npm test
```

Run Playwright tests:

```bash
npm run test:e2e
```

Build production assets:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Testing Coverage

The current test suite covers:

- Browser-locale UI switching between Chinese and English.
- Streaming code generation and automatic draft rendering.
- Vision review requests with rendered images.
- Review-driven iteration without automatic LLM calls during review.
- Revision accept/reject behavior.
- Invalid OpenSCAD error handling.
- Desktop workbench layout and narrow stacked left-panel order coverage.
- Model gateway behavior.

## Current Non-Goals

- Server-side accounts, shared workspaces, or team collaboration.
- Persistent cloud project storage.
- Parametric UI controls generated from OpenSCAD variables.
- Direct 3MF/STEP export.
- A full OpenSCAD language server.
- Automated printability certification.

## Release Checklist

Before production deployment:

```bash
npm test
npm run test:e2e
npm run build
```

Deployment target:

- Cloudflare Pages project: `ai-openscad`
- Production domain: `https://ai.openscad.tech`
- GitHub Actions workflow: `.github/workflows/deploy.yml`
  - Pull requests run `npm test`, `npm run test:e2e`, and `npm run build`.
    The clean runner installs dependencies with `npm ci`, sets up Node 24, and
    installs Chromium with `npx playwright install --with-deps chromium`.
    The `node-version` setting controls project commands; each `uses:` action
    should also be kept on a version whose action metadata runs on the Node 24
    runtime to avoid deprecated Node 20 runtime warnings.
  - Pushes to `main` execute the same checks, then deploy with
    `npx wrangler pages deploy dist --project-name ai-openscad --branch main`.
  - Manual `workflow_dispatch` production deploys are restricted to the `main`
    branch and use the same command. Manual runs from other refs run checks and
    skip production deploy.
  - Cloudflare Pages production branch for the `ai-openscad` project must be
    `main`.
  - The `deploy / checks` job should be configured as a required
    branch-protection status before merging to `main`.
  - Required GitHub repository secrets:
    - `CLOUDFLARE_API_TOKEN`
    - `CLOUDFLARE_ACCOUNT_ID`
  - `CLOUDFLARE_API_TOKEN` must be scoped with permission to edit/deploy the
    target Cloudflare Pages project in the account identified by
    `CLOUDFLARE_ACCOUNT_ID`.
- Optional Cloudflare Pages environment variable: `MiMo_KEY` or `MIMO_KEY` is
  used only when the user has not supplied a browser key. It is configured in
  Cloudflare Pages, not as a GitHub Actions secret.

After deployment:

- Verify the production page returns HTTP 200.
- Run a smoke test for generate, draft render, review, and export behavior when
  provider credentials are available.

## License Policy

AI OpenSCAD uses AGPL-3.0-only because the project should remain strongly
copyleft even when modified versions are offered as a network service. Modified
deployments that users interact with over a network must provide corresponding
source code under the same license.
