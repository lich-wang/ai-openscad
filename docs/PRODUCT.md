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

- Left control panel: basic settings, bounded auto-iteration controls, and
  project import/export first, then the new model action and local model list.
- Center agent panel: pipeline stage arrows, Codex-style chat run stream,
  requirement composer, workflow actions, and advanced OpenSCAD code editing.
- Right result panel: a large interactive STL preview, fixed multi-angle review
  views, and asset downloads.

### Main Workflow

1. User writes a requirement, for example a six-slot organizer or a 30 ml cup,
   or clicks the reference-image action, selects one or more local images, and
   asks the vision model to draft an editable target-model prompt from them.
2. The reference-image prompt draft, when used, replaces the composer text but
   does not submit the model request. The user can edit the generated prompt
   before continuing.
3. User clicks **Generate**.
4. The code model streams OpenSCAD into the center chat stream in real time.
5. After the complete code arrives, the run stream collapses the code preview
   and the render adapter compiles the generated OpenSCAD in the browser.
   Compile failure, or a "successful" STL with unsafe OpenSCAD diagnostics that
   indicate invalid or missing geometry, automatically triggers a bounded
   compiler-repair text generation using the failed code and readable
   diagnostics.
6. After a clean render, or after a successful compiler repair produces a clean
   render, the app shows the STL in a large interactive preview in the right
   result panel so the user can rotate, zoom, and pan the model directly.
7. The app captures fourteen PNG views from the STL: six orthographic
   directions (front, back, left, right, top, bottom) and eight isometric
   directions around the model.
8. If bounded auto-iteration is disabled, user clicks **Review** after a clean
   render. If the user preset automatic iterations before clicking
   **Generate**, the app runs the visual review automatically after each clean
   render in that bounded run.
9. The vision model checks the multi-angle views against the original
   requirement and returns a summary, issue list, confidence score as a review
   conclusion, and correction prompt.
10. The review event displays the confidence percentage together with the
   summary. The correction prompt is shown once for that review, then becomes
   editable in the composer for manual iteration and gives concrete
   instructions about which OpenSCAD areas or geometry relationships should be
   changed. Review confidence is displayed as part of the review conclusion,
   but is not copied into the correction prompt and is not sent to the text LLM.
11. User clicks **Iterate Again** to send the latest accepted/rendered
   OpenSCAD, the original requirement, review findings, and editable iteration
   guidance to the LLM, then generate and render the next draft. If the user
   preset automatic iterations before clicking **Iterate Again**, the app can
   continue with bounded follow-up review and revision cycles until the target
   confidence is reached or the iteration limit is exhausted.
12. User clicks **Final Export** when satisfied.
13. The app normalizes the model to final precision and downloads `.scad` and
    `.stl` files.

### User Control Rules

- Visual review only reviews by default. It must not automatically call the text
  LLM or start an image-driven rewrite loop unless the user has explicitly
  started a bounded confidence run by clicking **Generate** or **Iterate Again**
  with automatic iterations set above zero.
- Reference-image input is a separate, user-triggered prompt-drafting action
  before code generation. The user clicks the inline `Reference images` button,
  selects one or more local image files in the picker, and the app immediately
  calls the configured vision model to describe the intended target model. The
  user then receives a concise editable prompt in the same composer used for
  text requirements. This action must never call the code model, render
  OpenSCAD, start visual review, or start a bounded confidence loop by itself.
- Reference images are transient browser inputs for the current prompt-drafting
  request. They are sent only to `/api/vision` for the explicit drafting action,
  are not stored in exported project JSON, are not included in later code or
  review provider requests, and are discarded when the picker is canceled or the
  drafting request finishes. There is no persistent selected-image state for the
  user to clear before generation.
- The generated reference-image prompt replaces the composer requirement text
  and clears stale render/review output exactly like a manual requirement edit.
  The generated prompt is shown as editable text before **Generate** becomes the
  next user action, so the user can correct hallucinated dimensions, missing
  printability constraints, or ambiguous object details.
- In a bounded confidence run, each clean render is followed by visual
  review. If review confidence meets or exceeds the user preset target
  confidence, the run stops with that review conclusion. If confidence is below
  target and automatic iterations remain, the app may send one follow-up text
  revision using the latest rendered OpenSCAD, original requirement, review
  summary, issue list, and correction prompt, then render and review again.
  The run stops when the target confidence is reached, the automatic iteration
  limit is exhausted, or a provider/compile/review error occurs.
- Before each follow-up automatic revision, the app keeps a checkpoint of the
  current rendered and reviewed draft. If the newly rendered draft receives a
  lower confidence score than that checkpoint, the app must restore the
  checkpoint code, STL, fourteen views, render evidence, and review state
  before any further revision. It then performs a fresh visual review of the
  restored checkpoint to get a current correction prompt; any later automatic
  revision must use that restored model and fresh review guidance, not the
  lower-confidence draft. The failed follow-up revision still counts as an
  automatic iteration; rollback and re-review do not refund it.
- Review confidence is a displayed/stored conclusion, not prompt input. It must
  never be inserted into the editable correction prompt and must never be
  included in generation or revision text LLM prompts. Text prompts may include
  the review summary, issue list, and correction prompt, but not the numeric
  confidence value or a confidence-threshold instruction.
- The user can preset target confidence as a percentage and automatic iteration
  count as a bounded integer. The default automatic iteration count is zero so
  the current manual review-and-iterate workflow remains unchanged. The count
  means automatic follow-up text revision attempts after the user-started
  action begins: **Generate**'s initial draft does not count, **Iterate Again**'s
  user-clicked revision does not count, and each automatic follow-up revision
  after a review counts once.
- The target confidence control is a percent slider with accessible name
  `Target confidence` in English and the localized equivalent in Chinese, range
  1-100, step 1, and default 85. The automatic iteration control is an integer
  stepper/input with accessible name `Auto iterations` in English and the
  localized equivalent in Chinese, range 0-5, step 1, and default 0. Persisted
  out-of-range values are clamped to those ranges before use. The stored target
  is a percent value and is compared to normalized review confidence as
  `confidence >= target / 100`.
- The interactive preview is for human inspection only. Dragging, zooming, or
  panning the preview must not change the fourteen fixed review images and must
  not affect the provider payload sent for visual review.
- Browser compile failures and unsafe render diagnostics must directly trigger a
  bounded text-to-OpenSCAD compiler-repair loop when a code model key is
  available. Unsafe diagnostics include
  ignored unknown variables or modules, undefined operations, failed numeric or
  vector parameter conversions, missing include/use files, NaN or non-finite
  geometry, or other OpenSCAD warnings/errors that mean the captured STL is
  incomplete or not faithful to the source intent. Each compile step may make at
  most two automatic compiler-repair text requests before stopping with
  diagnostics. If no code model key is available, the app stops with readable
  diagnostics and keeps manual retry guidance editable.
- The compiler-repair loop applies to the compile step being executed, whether
  it follows first generation, manual rerender, accepted revision,
  user-confirmed iteration, or an automatic follow-up revision inside a bounded
  confidence run. The two-attempt compiler-repair counter is counted per compile
  step and is separate from the review-driven automatic iteration count.
- This borrows the useful part of verified text-to-OpenSCAD workflows:
  compiler evidence can repair invalid code automatically, while rendered image
  evidence remains user-controlled review context unless the user has opted into
  a bounded confidence run with a visible target and attempt limit.
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
- The composer also provides a compact reference-image action before
  generation. The secondary action is an inline button named `Reference images`
  in English and `参考图片` in Chinese. It sits in the same action row as the
  primary workflow button, such as **Generate**, instead of a separate
  reference-image panel or text label. Clicking it opens the local image picker
  with multi-select enabled; after the user chooses one or more images, the
  workbench immediately sends those images to the vision model to draft the
  target-model prompt. The composer does not show a persistent vertical list of
  filenames, thumbnails, remove controls, clear controls, or a separate
  `Reference images` label. If the picker is canceled, no request is sent. The
  action is enabled only when a vision model can be called, the workbench is
  idle, and no pending revision is waiting for acceptance.
- The left settings surface lets the user set a target review confidence and
  automatic iteration count before starting **Generate** or **Iterate Again**.
  These controls affect only future user-started runs; changing them while idle
  does not mutate existing review conclusions or prompt traces.
- Token estimates and duplicate ready status badges are hidden from the normal
  workbench surface to keep more room for the model list and the multi-angle
  views.
- AI prompt trace details are not part of the normal workbench surface.

Workbench acceptance criteria:

- Left panel order is stable on desktop and in narrower stacked layouts: basic
  settings with target confidence and auto-iteration controls, project
  import/export, new model button, then the local model list for navigation.
  The local model list scrolls internally when it grows and is distinct from
  run history.
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
  automatic confidence run, compiler-repair, or export task is running. It shows
  Generate when no current clean fourteen-view render exists, Review only when
  all fourteen current rendered view keys are non-empty, render diagnostics are
  clean, there is no active or failed repair for the current draft, and there is
  no current review. It shows Iterate Again only after the current clean
  fourteen-view render has been reviewed and no pending revision is waiting for
  acceptance.
  Missing inputs, provider-key failures, compile failures, and review failures
  appear in the center stream without changing the right panel contract. While a
  pending revision is waiting for acceptance, the composer shows an acceptance
  hint instead of Generate, Review, or Iterate Again; the user must accept or
  reject the revision before continuing the main workflow.
- While a reference-image prompt draft is running, model settings, project
  import/export, new model, local project navigation, the composer textarea,
  reference-image controls, and all workflow actions are disabled or read-only.
  The in-flight request is bound to the current project id, selected image
  fingerprints, and composer baseline text. A late response must be ignored if
  the project changed, the selected image set changed, the composer text changed
  outside the drafting request, or a newer drafting request started. If the
  provider call fails, the composer text captured when the request started is
  restored and the error is shown, but no selected images are retained in the UI
  or project. Retrying means clicking `Reference images` again and
  selecting images again, or manually editing the composer text.
- During an active bounded confidence run, Generate, Review, Iterate Again,
  Rerender, Final Export, Accept Revision, Reject Revision, project import,
  project export, new model, local model navigation, and the target-confidence
  and auto-iteration controls are disabled or read-only for the active run. This
  prevents a stale in-flight response from changing a different project or
  starting a hidden provider call. When the run stops, the controls return to
  normal availability according to the latest project state.
- If generated or manually edited code fails to compile, or compiles with
  unsafe diagnostics that imply partial/invalid geometry, the failing draft
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
  example `Compiler repair 1 of 2`. Generate, Review, Iterate Again, Rerender,
  Final Export, Accept Revision, Reject Revision, project import, project
  export, new model, local model navigation, and target-confidence and
  auto-iteration controls stay disabled or read-only until that repair attempt
  finishes or stops with diagnostics.
- The center agent stream remains the place for user request records, streaming
  generated code, collapsed completed code, compiler output, render start,
  render progress, render completion, render errors, review summary, review
  issues, confidence, correction prompt, rollback events, and iteration events.
  Each review event renders only one correction prompt block; the same
  correction prompt must not be duplicated as a nested prompt card inside the
  review event. Completed code is collapsed by default so it does not dominate
  the center panel, while the advanced OpenSCAD editor remains available below
  the composer.
- During a bounded confidence run, the center agent stream shows automatic
  review/revision progress, the latest confidence conclusion, automatic
  iteration count consumed, and the stop reason: target confidence reached,
  automatic iteration limit reached, compile failure, review failure, provider
  failure, or user-visible error.
- After any bounded confidence run stops, the app exits the disabled auto-run
  state, shows the stop reason, preserves the latest code, STL, fourteen views,
  review conclusion, confidence, and correction prompt, and states that no
  further automatic LLM call will occur. Normal manual actions become available
  again as appropriate: Final Export when the review is current, Iterate Again
  or prompt editing when more work is needed, and code editing or Rerender after
  errors.
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
  iso-back-right-bottom, then iso-back-left-bottom. On desktop, all fourteen
  fixed view tiles use the same visual size in a dense, scrollable grid; the
  front view must not be enlarged or span extra grid columns. In narrow stacked
  layouts, all fourteen tiles keep the same reading order, equal tile treatment,
  and stable accessible image names. The interactive preview plus fixed view
  grid should use the majority of the visible right-panel height at a 1440 px
  desktop viewport, with the interactive preview as the only enlarged model
  view. The right panel may scroll internally, but the overall workbench must
  not grow vertically in a way that hides the composer, workflow actions, code
  editor access, or asset download controls. PNG, SCAD, and STL download
  controls remain reachable from the result panel without mixing logs, review
  text, or prompt traces into that panel.
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
  right-panel ownership, the interactive preview as the only enlarged model
  view, equal-size fourteen fixed view tiles, and primary action transitions
  across generate, render, review, pending-revision, rerender-failure, and
  iterate states, including non-color state labels and keyboard focus order.
  E2E coverage should also verify the interactive STL preview is the largest
  top visual area in the result panel, exposes its accessible name, can be
  dragged without changing the fourteen fixed review images or the vision
  provider payload, and keeps PNG/SCAD/STL downloads reachable with expected
  accessible names on desktop and narrow layouts.
  Playwright pixel screenshot checks run only in local visual-regression checks
  and must be skipped in CI.
- Automated E2E coverage must include the new target confidence and auto
  iteration controls with stable accessible names, visible labels, readable
  current values, keyboard operation, clamping/default behavior, and no
  horizontal overflow on desktop or narrow stacked layouts. Local screenshot
  coverage must include the left settings area with these controls visible.
- Local visual-regression screenshots must explicitly cover the right result
  panel: the interactive preview is the largest top visual area after render,
  all fourteen fixed view tiles use equal visual size in stable order, any
  internal scrolling is constrained to the result panel/grid, labels do not
  overlap, there is no horizontal overflow, and PNG/SCAD/STL download controls
  remain visible or reachable.
- Tests must verify that compile failure and unsafe render diagnostics trigger
  only the bounded compiler-repair text requests, while clean render completion,
  visual review completion, and image evidence never trigger an unprompted
  `/api/llm` request outside an explicit user-started bounded confidence run.
  Tests must also verify that a bounded confidence run stops when the target
  confidence is reached or the automatic iteration limit is exhausted, and that
  revision prompts omit review confidence.
- Tests must verify that unsafe OpenSCAD diagnostics on an otherwise completed
  render are treated like render failures: they block visual review, trigger the
  bounded compiler-repair path when a code model key is available, keep the
  render stage from completing until a clean render exists, keep the review
  stage inactive/blocked, disable state-changing controls during repair, restore
  controls after repair stops, leave readable diagnostics visible and announced,
  block STL/final export downloads, and never fall through to a
  review-confidence failure. Final export tests must also cover a final-precision
  render that returns STL plus unsafe diagnostics and verify that no final files
  are downloaded.
- Automated E2E coverage must verify the reference-image drafting flow: multiple
  uploaded images are sent to `/api/vision`, the response fills the editable
  requirement composer without calling `/api/llm`, the user can edit that prompt
  before **Generate**, stale render/review state is cleared, and the subsequent
  generation request uses the edited text rather than the raw image payload.
- Unit and E2E coverage must verify reference-image request boundaries and stale
  response protection: clicking `Reference images` opens a multi-image
  local picker, a canceled picker sends no request, and a completed selection
  sends a `/api/vision` drafting payload containing only the selected images and
  prompt-drafting instruction, not OpenSCAD code, renderEvidence, rendered
  review images, review history, prompt traces, filenames, or STL data; the
  prompt trace uses a reference-image drafting phase distinct from visual
  review; no `/api/llm`, render, visual review, or bounded auto-loop starts from
  the drafting response alone; project export excludes reference images;
  provider failure preserves the composer text captured when the request
  started and lets the user retry by clicking the same action again; success
  clears `currentCode`, `proposedCode`, `review`, `stl`, `views`, and
  `renderEvidence`; and stale/late vision responses after a project switch,
  image-set change, composer edit, or newer draft request are ignored.
- E2E and local visual-regression coverage must also cover the compact
  reference-image composer UI: the inline `Reference images` action is visible
  in the same row as the primary workflow action, no separate reference-image
  text label or persistent filename/thumbnail list appears after selection, the
  action disabled/read-only state while drafting is clear, provider failure
  keeps the composer text captured when the request started, and narrow layout
  keeps both action buttons visible without overflow or overlap.
- Automated E2E coverage must verify that review UI displays the confidence
  percentage in the review conclusion and renders exactly one correction prompt
  block per review event. It must also cover lower-confidence automatic
  follow-up regression: the app restores checkpoint `currentCode`, STL,
  fourteen fixed views, render evidence, review/confidence, and editable
  correction guidance; the failed follow-up consumes one automatic iteration
  and rollback/re-review does not refund it; a fresh `/api/vision` review is
  sent for the restored checkpoint before any later auto revision; no
  subsequent `/api/llm` request uses the lower-confidence draft or its
  correction prompt; and revision prompts still omit confidence, target, and
  threshold instructions.
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
  review and later user-confirmed or user-enabled bounded confidence iteration,
  not a trigger for unbounded automatic image rewrite loops.
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

### Reference Image Prompt Drafting

- Sends only the user-selected reference images and a short instruction to the
  vision endpoint. It does not send OpenSCAD code, STL data, rendered review
  images, render evidence, prior reviews, prompt traces, API keys, or hidden
  project history.
- The inline `Reference images` action owns the file-selection step. It opens a
  multi-image local file picker and starts drafting immediately after the user
  selects files. The selected images are request-scoped only; there is no
  separate selected-file list to manage in the composer.
- Accepts JSON with `prompt`, or plain text when a provider does not follow the
  JSON contract. The final prompt is trimmed, must be non-empty, and should
  describe the physical target model in printable OpenSCAD-friendly terms:
  object category, visible parts, approximate proportions, key dimensions when
  inferable, symmetry, openings, handles, holes, text, decorative surfaces, and
  constraints that should be preserved. It should not return OpenSCAD code.
- A successful draft appends a vision prompt trace, records an Agent Run event,
  fills the editable requirement composer, clears stale current code, pending
  revision, review, STL, rendered views, and render evidence, and leaves the
  workflow at the pre-generation state. The trace stores the text instruction,
  model id, and returned prompt only; it must not store uploaded image data
  URLs, binary image payloads, or thumbnail object URLs.
- A failed draft keeps the composer text captured when the request started
  visible, shows a readable workflow error, and lets the user retry by clicking
  `Reference images` and choosing images again. The failed request does
  not leave a persistent uploaded-image list in the composer.
  Reference-image drafting is not part of review confidence and never consumes
  automatic iteration budget.
- The drafting response may update the project only when it still matches the
  active project id, selected-image fingerprints, composer baseline text, and
  latest drafting request token captured when the request started. Otherwise
  the response is discarded without changing the composer, project state, or run
  events.

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
  produces a user-editable correction prompt and a displayed confidence
  conclusion. It does not directly call the text model outside a user-started
  bounded confidence run.
- Render evidence is a bounded provider contract, not localized UI copy. It
  includes compile status, readable diagnostics, render precision, backend, and
  rendered view count. `viewCount` equals the number of non-empty rendered view
  images in the stable view set and must be `14` for visual review. STL bodies,
  screenshots beyond the requested review images, and prompt traces are not sent
  unless they are explicitly part of the current model request.
- A render with `compileStatus: success` is valid for review only when all
  fourteen views exist and diagnostics do not contain unsafe OpenSCAD warnings
  such as undefined operations, ignored unknown variables/modules, failed
  parameter conversions, missing include/use files, NaN, or non-finite geometry.
  Unsafe diagnostics downgrade the render to a repairable failure even if STL
  text and PNG captures were produced.
- Expects JSON with:
  - `summary`
  - `issues`
  - `correctionPrompt`
  - `confidence`
- `confidence` is normalized to a 0-1 score for storage and displayed to the
  user as a percentage in the review event and any stop conclusion. It is part
  of the review conclusion and stop-decision state only. It must not be
  appended to the editable correction prompt, prompt trace shown to the user, or
  any text LLM generation/revision prompt.
- If `confidence` is missing, non-numeric, or cannot be normalized into the 0-1
  range, the review is treated as a review failure for bounded confidence runs.
  The run stops with a readable reason and must not send a follow-up text LLM
  revision based on that review.
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
  unrelated generation. The revision request must intentionally omit review
  confidence, target confidence, and stop-threshold instructions.
- Bounded confidence runs are always started by a user action. With automatic
  iteration count set to zero, **Generate** and **Iterate Again** keep the
  current manual behavior and stop after rendering until the user reviews or
  iterates. With automatic iteration count above zero, **Generate** renders the
  initial draft and then automatically reviews it; **Iterate Again** renders the
  user-clicked revision and then automatically reviews it. If the latest review
  confidence is below target, each follow-up automatic revision consumes one
  automatic iteration. The run stops at target confidence, at the configured
  automatic iteration limit, or on any compile/review/provider error.
- Follow-up revisions inside a bounded confidence run are automatically applied
  as the current draft, then compiled, rendered, and reviewed. They do not pause
  as pending revisions requiring Accept Revision or Reject Revision. Manual
  pending-revision accept/reject behavior remains for non-auto revision flows.
- If a follow-up automatic revision renders successfully but its visual review
  confidence is lower than the previous checkpoint confidence, the lower-scored
  draft is treated as a regression. The app restores the checkpoint and records
  a rollback event in the agent stream. The rollback event must state that the
  previous checkpoint was restored, show the checkpoint confidence and the lower
  regressed confidence, and state that a fresh review of the restored model is
  running before any further automatic revision. Before using any further
  correction prompt, the app requests a fresh visual review for the restored
  checkpoint. Subsequent automatic revisions, if any iteration budget remains,
  use that fresh review guidance and the restored checkpoint code. The app must
  not iterate from the lower-confidence draft or its correction prompt.
- If an initial draft, user-clicked iteration, or automatic follow-up revision
  fails to compile or produces unsafe render diagnostics during a bounded
  confidence run, the existing bounded compiler-repair loop must run for that
  compile step before visual review when a code model key is available.
  Compiler-repair text LLM calls are separate
  from review-driven automatic iterations and do not consume the automatic
  iteration count. A follow-up automatic revision consumes one automatic
  iteration when the review-driven revision request is started, even if its
  later compile requires repair. If no code-model key is available, the
  compiler-repair limit is exhausted, or repaired code still cannot produce a
  clean render, the bounded confidence run stops with render diagnostics and
  does not proceed to visual review or another review-driven revision.
- Each active bounded confidence run is bound to the current project id, current
  code version, and rendered fourteen-view evidence produced by that run.
  Browser refresh, import, project switch, new model, manual code edit, manual
  rerender, accepting/rejecting a pending revision, or any project state reset
  cancels the run. Late generation, revision, compiler-repair, render, or
  review responses from a canceled run must be ignored and must not update the
  project, start another render/review/provider request, or overwrite the
  visible run conclusion.
- Compile failures and unsafe render diagnostics from generated or manually
  edited code remain visible in the run stream and are folded into bounded
  compiler-repair text requests automatically when a code model key is
  available. When the repair limit is exhausted, the same diagnostic-derived
  guidance remains editable for a manual retry. Visual review findings still
  require the user to choose the iteration action before the text model runs,
  except for follow-up revisions inside the bounded confidence run the user has
  already started.
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

Reference-image file selections and in-flight prompt draft state are local,
request-scoped UI state only. They are not part of project export/import and
are cleared after the drafting request finishes, when the picker is canceled,
or when the page reloads, project import, project switch, or new model occurs.

Workbench preference state in browser `localStorage` also includes:

- `targetConfidencePercent`: integer percent, default `85`, clamped to `1-100`
- `autoIterationLimit`: integer, default `0`, clamped to `0-5`

These preferences are local UI presets, not project artifacts. Project JSON
export/import includes review confidence and run events, but does not resume or
export an active bounded confidence run. Active run state is in memory only; a
page reload, project import, project switch, or new model cancels it and never
continues automatic provider calls after restore.

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
- `POST /api/vision` for visual review and user-triggered reference-image
  prompt drafting. The two request types use different system/user prompts and
  trace phases; reference-image drafting never sends rendered model review
  evidence.

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
- STL download is available only after a clean successful render with required
  views and no unsafe diagnostics; source SCAD download is available whenever
  current code exists.
- Review requests include rendered images.
- Reference-image prompt drafting requests include only user-selected reference
  images, fill an editable requirement prompt, and do not call the code model
  until the user clicks **Generate**.
- Review does not trigger text generation unless it is part of an explicit
  user-started bounded confidence run with remaining automatic iterations.
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
- Review-driven iteration with manual control by default and optional bounded
  confidence-target auto-iteration after **Generate** or **Iterate Again**.
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
