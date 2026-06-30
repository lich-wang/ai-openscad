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
- Right result panel: a large interactive STL preview, fixed multi-angle review
  views, and asset downloads.

### Main Workflow

1. User writes a requirement, for example a six-slot organizer or a 30 ml cup.
2. User clicks **Generate**.
3. The code model streams OpenSCAD into the center chat stream in real time.
4. After the complete code arrives, the run stream collapses the code preview
   and the render adapter compiles the generated OpenSCAD in the browser.
   Compile failure automatically triggers a bounded compiler-repair text
   generation using the failed code and readable diagnostics.
5. The app shows the compiled STL in a large interactive preview in the right
   result panel so the user can rotate, zoom, and pan the model directly.
6. The app captures fourteen PNG views from the STL: six orthographic
   directions (front, back, left, right, top, bottom) and eight isometric
   directions around the model.
7. User clicks **Review**.
8. The vision model checks the multi-angle views against the original
   requirement and returns a summary, issue list, confidence score, and
   correction prompt.
9. The correction prompt becomes editable in the composer and gives concrete
   instructions about which OpenSCAD areas or geometry relationships should be
   changed.
10. User clicks **Iterate Again** to send the latest accepted/rendered
   OpenSCAD, the original requirement, review findings, and editable iteration
   guidance to the LLM, then generate and render the next draft.
11. User clicks **Final Export** when satisfied.
12. The app normalizes the model to final precision and downloads `.scad` and
    `.stl` files.

### User Control Rules

- Visual review only reviews. It must not automatically call the text LLM or
  start an image-driven rewrite loop.
- The interactive preview is for human inspection only. Dragging, zooming, or
  panning the preview must not change the fourteen fixed review images and must
  not affect the provider payload sent for visual review.
- Browser compile failures may directly trigger a bounded text-to-OpenSCAD
  compiler-repair loop. Each user-initiated generation, rerender, accepted
  revision, or iteration may make at most two automatic compiler-repair text
  requests before stopping with diagnostics.
- The compiler-repair loop applies to the compile step owned by that user
  action, whether it follows first generation, manual rerender, accepted
  revision, or user-confirmed iteration. The two-attempt limit is counted per
  user action and resets only when the user starts another generation, rerender,
  accepted revision, or iteration.
- This borrows the useful part of verified text-to-OpenSCAD workflows:
  compiler evidence can repair invalid code automatically, while rendered image
  evidence remains user-controlled review context.
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
  workbench surface to keep more room for the model list and the multi-angle
  views.
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
  compiler-repair, or export task is running. It shows Generate when no current
  fourteen-view render exists, Review only when all fourteen current rendered
  view keys are non-empty and there is no current review, and Iterate Again only
  after the current fourteen-view render has been reviewed and no pending
  revision is waiting for acceptance.
  Missing inputs, provider-key failures, compile failures, and review failures
  appear in the center stream without changing the right panel contract. While a
  pending revision is waiting for acceptance, the composer shows an acceptance
  hint instead of Generate, Review, or Iterate Again; the user must accept or
  reject the revision before continuing the main workflow.
- If generated or manually edited code fails to compile, the failing draft
  cannot advance to visual review or export. Any stale review, stale STL, and
  stale view images from the current cycle are blocked from review/export for
  that failing draft. The center stream shows readable diagnostics and
  immediately starts the bounded compiler-repair generation when a code model
  key is available. If the repair limit is exhausted or a key is missing, the
  composer keeps visible editable diagnostic guidance for a manual retry while
  preserving the current failing OpenSCAD code for inspection/editing.
- During automatic compiler repair, the code generation stage is active, the
  model rendering stage is waiting until repaired code streams, and no visual
  review stage is active. The run stream states the repair attempt number, for
  example `Compiler repair 1 of 2`, and primary, rerender, review, and export
  actions stay disabled until that repair attempt finishes.
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
- The right result panel contains only the interactive 3D preview, the fourteen
  named view tiles, and asset download controls. It must not contain compiler
  logs, review text, prompt trace, or iteration history. The interactive preview
  is the largest visual area at the top of the panel after a successful render.
  It renders the current STL in a Three.js canvas, supports pointer drag orbit,
  wheel zoom, and pan gestures, and stays within the result panel without
  growing the page. The preview region or canvas exposes the accessible name
  `Interactive STL preview` in English and the localized equivalent in Chinese;
  empty and invalid-STL states remain labelled, and keyboard focus must not be
  trapped inside the preview controls. It must show an empty framed preview area
  before an STL is available, dispose WebGL resources when the model changes or
  unmounts, and recover cleanly from an invalid STL without breaking the rest of
  the workbench. The fourteen fixed view tiles remain below the interactive
  preview and keep the review-evidence order: front, back, left, right, top,
  bottom,
  iso-front-right-top, iso-front-left-top, iso-back-right-top,
  iso-back-left-top, iso-front-right-bottom, iso-front-left-bottom,
  iso-back-right-bottom, then iso-back-left-bottom. On desktop, the front tile
  remains the main/largest fixed orthographic evidence tile within the
  multi-angle grid and the remaining thirteen angles are visible below it in a
  dense, scrollable grid. In narrow stacked layouts, all fourteen tiles keep the
  same reading order and stable accessible image names. The interactive preview
  plus fixed view grid should use the majority of the visible right-panel height
  at a 1440 px desktop viewport. The right panel may scroll internally, but the
  overall workbench must not grow vertically in a way that hides the composer,
  workflow actions, code editor access, or asset download controls. PNG, SCAD,
  and STL download controls remain reachable from the result panel without
  mixing logs, review text, or prompt traces into that panel.
- Every view tile uses the visible label and image alt text for its angle:
  Front, Back, Left, Right, Top, Bottom, Iso Front Right Top, Iso Front Left
  Top, Iso Back Right Top, Iso Back Left Top, Iso Front Right Bottom, Iso Front
  Left Bottom, Iso Back Right Bottom, and Iso Back Left Bottom. Each PNG
  download button uses a matching accessible name and filename:
  `ai-openscad-front.png`, `ai-openscad-back.png`,
  `ai-openscad-left.png`, `ai-openscad-right.png`,
  `ai-openscad-top.png`, `ai-openscad-bottom.png`,
  `ai-openscad-iso-front-right-top.png`,
  `ai-openscad-iso-front-left-top.png`,
  `ai-openscad-iso-back-right-top.png`,
  `ai-openscad-iso-back-left-top.png`,
  `ai-openscad-iso-front-right-bottom.png`,
  `ai-openscad-iso-front-left-bottom.png`,
  `ai-openscad-iso-back-right-bottom.png`, and
  `ai-openscad-iso-back-left-bottom.png`.
  Long view labels and download button labels must fit without overlap or
  horizontal overflow on desktop and narrow layouts; they may wrap or truncate
  visually only when the accessible name remains complete.
- The asset download controls include the current OpenSCAD source file whenever
  `currentCode` is non-empty. The source download uses the accessible name
  `Source SCAD` and filename `ai-openscad-source.scad`. It downloads the current
  editable source, not the high-precision final-export normalized source. The
  existing Final Export action still downloads high-precision `.scad` and `.stl`
  files after the user confirms export.
- Manual OpenSCAD edits can be recompiled with the secondary rerender action
  whenever code exists. Rerender failures appear in the center stream and keep
  the workbench interactive. Render errors must include readable OpenSCAD
  diagnostics, including missing include files, ignored or unknown modules, and
  stderr warnings/errors; the UI must not show only numeric worker or runtime
  codes.
- Render timeouts explain that the draft exceeded the browser render complexity
  budget, keep the render stage in an error state, preserve the current
  editable OpenSCAD, and leave rerender available after the user simplifies the
  draft or edits the code.
- A representative textured model such as a 20 cm wavy cup should be generated
  for draft review with coarse, inspectable wave geometry, without 100-layer
  stacked `linear_extrude()` bodies, dense polygon wave rings, or per-layer
  boolean hollowing. The generated draft should stay within the 45 second
  browser render timeout and produce all fourteen visible orthographic and
  isometric views.
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
  E2E coverage should also verify the interactive STL preview is the largest
  top visual area in the result panel, exposes its accessible name, can be
  dragged without changing the fourteen fixed review images or the vision
  provider payload, and keeps PNG/SCAD/STL downloads reachable with expected
  accessible names on desktop and narrow layouts.
  Playwright pixel screenshot checks run only in local visual-regression checks
  and must be skipped in CI.
- Local visual-regression screenshots must explicitly cover the right result
  panel: the interactive preview is the largest top visual area after render,
  the front fixed tile remains primary/largest within the fourteen-view grid,
  the thirteen supporting views appear below it in the stable order, any
  internal scrolling is constrained to the result panel/grid, labels do not
  overlap, there is no horizontal overflow, and PNG/SCAD/STL download controls
  remain visible or reachable.
- Tests must verify that compile failure triggers only the bounded compiler
  repair text requests, while render completion, visual review completion, and
  image evidence never trigger an unprompted `/api/llm` request.
- Local E2E render coverage must include the full user-reported 20 cm wavy cup
  OpenSCAD file with layered `linear_extrude()` wave rings, verify that the
  browser renderer completes, and confirm the multi-angle rendered views contain
  visible model pixels. Tests must assert that all fourteen named view images
  appear in order, each has non-background model pixels, and each matching PNG
  download control has the expected accessible name.

## Feature Inventory

### Generation

- Uses a code-focused system prompt that asks for valid, deterministic, complete
  OpenSCAD.
- Treats generated OpenSCAD as a complete artifact that must compile before it
  can advance through the workflow. Compile diagnostics can trigger bounded
  automatic compiler-repair generation; rendered views become evidence for
  review and later user-confirmed iteration, not a trigger for automatic image
  rewrite loops.
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
- OpenSCAD WASM runtimes are treated as one compile use: the worker remains
  persistent, but each initialized OpenSCAD instance is consumed by a single
  compile, cleaned up on a best-effort basis, and then replaced by a prewarmed
  next instance. This avoids the observed `callMain()` instability where the
  same WASM runtime succeeds once and later throws non-text runtime codes on
  rerender.
- Enforces a default 45 second render timeout.
- Uses draft precision for normal iteration by normalizing `$fn` to 32.
- Captures fourteen multi-angle views from generated STL. Camera directions are
  stable vectors from the model center to the camera; front/back/left/right use
  screen-up `+Z`, top/bottom use screen-up `+Y`, and isometric views use
  screen-up `+Z` unless that is parallel to the camera direction:
  - Front
  - Back
  - Left
  - Right
  - Top
  - Bottom
  - Iso Front Right Top
  - Iso Front Left Top
  - Iso Back Right Top
  - Iso Back Left Top
  - Iso Front Right Bottom
  - Iso Front Left Bottom
  - Iso Back Right Bottom
  - Iso Back Left Bottom
- Uses Three.js lighting and STL parsing to create PNG data URLs.
- Uses the same current STL for a local-only Three.js interactive preview in
  the result panel. The preview is user-draggable inspection UI and is never
  added to the visual-review provider payload.
- Stable view directions:
  - `front`: camera direction `(0, -1, 0)`, up `(0, 0, 1)`
  - `back`: camera direction `(0, 1, 0)`, up `(0, 0, 1)`
  - `left`: camera direction `(-1, 0, 0)`, up `(0, 0, 1)`
  - `right`: camera direction `(1, 0, 0)`, up `(0, 0, 1)`
  - `top`: camera direction `(0, 0, 1)`, up `(0, 1, 0)`
  - `bottom`: camera direction `(0, 0, -1)`, up `(0, 1, 0)`
  - `isoFrontRightTop`: camera direction `normalize(1, -1, 0.75)`
  - `isoFrontLeftTop`: camera direction `normalize(-1, -1, 0.75)`
  - `isoBackRightTop`: camera direction `normalize(1, 1, 0.75)`
  - `isoBackLeftTop`: camera direction `normalize(-1, 1, 0.75)`
  - `isoFrontRightBottom`: camera direction `normalize(1, -1, -0.75)`
  - `isoFrontLeftBottom`: camera direction `normalize(-1, -1, -0.75)`
  - `isoBackRightBottom`: camera direction `normalize(1, 1, -0.75)`
  - `isoBackLeftBottom`: camera direction `normalize(-1, 1, -0.75)`
- Draft capture uses a bounded browser payload budget for vision review. Each
  PNG is capped at the configured review capture size and encoded as a data URL;
  if the combined provider request would exceed the browser/gateway payload
  budget, the app stops before calling the vision endpoint, shows a readable
  error in the center stream, and keeps rerender/retry available.

### Review And Iteration

- Sends the original requirement, current OpenSCAD, and the multi-angle rendered
  images to the vision endpoint.
- Visual review is allowed only when all fourteen view keys have non-empty images.
  The image array sent to the provider must follow the stable view order:
  front, back, left, right, top, bottom, isoFrontRightTop, isoFrontLeftTop,
  isoBackRightTop, isoBackLeftTop, isoFrontRightBottom, isoFrontLeftBottom,
  isoBackRightBottom, isoBackLeftBottom. If capture fails or fewer than fourteen
  views are available, the app stays in render/error state and does not call the
  vision endpoint.
- Legacy three-view or six-view projects, partial capture results such as
  13/14 views, and stale reviews attached to incomplete current views must block
  Review, Final Export, and Iterate Again until the current code rerenders all
  fourteen views.
- Review requests include the latest compile/render evidence so the vision model
  can check both visual fit and obvious artifact quality issues. This feedback
  produces a user-editable correction prompt only; it does not directly call the
  text model.
- Render evidence is a bounded provider contract, not localized UI copy. It
  includes compile status, readable diagnostics, render precision, backend, and
  rendered view count. `viewCount` equals the number of non-empty rendered view
  images in the stable view set and must be `14` for visual review. STL bodies,
  screenshots beyond the requested review images, and prompt traces are not sent
  unless they are explicitly part of the current model request.
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
- Compile failures from generated or manually edited code remain visible in the
  run stream and are folded into bounded compiler-repair text requests
  automatically. When the repair limit is exhausted, the same diagnostic-derived
  guidance remains editable for a manual retry. Visual review findings still
  require the user to choose the iteration action before the text model runs.
- Stores prompt traces for generation, compilation, review, revision, and final
  export in local project data for export/debugging, but normal users do not see
  a prompt trace panel in the workbench.

### Export

- Draft outputs:
  - Current source SCAD
  - Front PNG
  - Back PNG
  - Left PNG
  - Right PNG
  - Top PNG
  - Bottom PNG
  - Iso Front Right Top PNG
  - Iso Front Left Top PNG
  - Iso Back Right Top PNG
  - Iso Back Left Top PNG
  - Iso Front Right Bottom PNG
  - Iso Front Left Bottom PNG
  - Iso Back Right Bottom PNG
  - Iso Back Left Bottom PNG
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
  a Web Worker. Three.js parses STL output, captures multi-angle PNG views, and
  renders the interactive preview in the result panel.
- Model gateway: Cloudflare Pages Functions under `functions/api`.
- Persistence: browser `localStorage`; there is no server-side project database.
- Deployment: Cloudflare Pages project `ai-openscad`.

Important source areas:

- `src/App.tsx`: main workbench UI and user workflow state.
- `src/lib/apiClient.ts`: LLM, vision, revision, and token-estimate client.
- `src/lib/models.ts`: supported model presets and provider routing.
- `src/lib/render.ts`: browser OpenSCAD compile/render adapter.
- `src/lib/renderWorker.ts`: worker compile path.
- `src/lib/capture.ts`: STL to multi-angle PNG capture.
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
- Runtime output: `compilerOutput`, `renderEvidence`, `review`, `runEvents`
- Audit trail: `iterations`, `promptTrace`

`views` is a keyed object with the stable `ViewKey` order:

- `front`
- `back`
- `left`
- `right`
- `top`
- `bottom`
- `isoFrontRightTop`
- `isoFrontLeftTop`
- `isoBackRightTop`
- `isoBackLeftTop`
- `isoFrontRightBottom`
- `isoFrontLeftBottom`
- `isoBackRightBottom`
- `isoBackLeftBottom`

Every value is a PNG data URL or an empty string. The UI, downloads, render
evidence, and vision payload use this same order. A project imported from an
older three-view or six-view export fills missing keys with empty strings until
rerendered.

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
- STL download is available only after a successful compile; source SCAD
  download is available whenever current code exists.
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
