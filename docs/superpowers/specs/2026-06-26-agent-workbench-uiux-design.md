# AI OpenSCAD Agent Workbench UI/UX Design

Date: 2026-06-26

## Purpose

This design aligns the AI OpenSCAD product with the intended Web Agent workflow:

1. The user describes the 3D model they need.
2. The Web Agent calls the OpenSCAD skill plus the text LLM to generate OpenSCAD source.
3. The Web Agent calls Render MCP with the OpenSCAD source.
4. Render MCP returns three orthographic view images and an STL file.
5. The Web Agent shows the three views and STL to the user.
6. The Web Agent calls the vision model to review whether the model matches the requirement.
7. The Web Agent shows an editable correction prompt.
8. The user confirms or edits that prompt, then starts the next generation loop.

The page should feel like an agent workbench: the main object is the current model delivery loop, not settings, logs, or a raw code editor.

## Sub-Agent Findings

### User Perspective

The target user wants a clear model delivery pipeline. They expect to enter a requirement, watch the agent work, inspect the model, and download the STL. They do not want to think about code, prompt history, API configuration, or project management unless something goes wrong.

The user gets confused when:

- The page does not clearly say which step is running.
- SCAD generation appears to continue after it has finished.
- Vision review is mixed into history instead of being shown as the current next-step guidance.
- The same input field is used for initial requirements and follow-up corrections without state-specific wording.
- The right column contains logs or history instead of the current deliverables.
- The left column looks like the main work area instead of lightweight navigation.

The ideal loop is:

`requirement -> SCAD generation -> Render MCP -> three views + STL -> vision review -> editable correction prompt -> next generation`

### UX Perspective

The product should keep a three-column workbench, but reset the hierarchy:

- Left column: lightweight project and environment context.
- Center column: Agent timeline and active input.
- Right column: model preview and STL delivery.

The primary UX rule is:

> Three views and the Agent workflow are the main product. History, keys, compiler logs, prompt traces, and tokens are supporting material.

## Layout Design

### Left Column: Project Context

Recommended width: 220-260px.

Responsibilities:

- New model action.
- Recent model switching.
- Collapsed model/API settings summary.
- Import/export project controls.

The left column should not be a large settings form. It should behave like a narrow workspace sidebar.

Recommended structure:

- `New model` button at top.
- Recent model list showing 3-5 items.
- Each model item shows title and compact status:
  - `STL ready`
  - `Reviewed`
  - `Needs correction`
  - `Draft only`
- `Model & key settings` as a collapsed block or popover.
- Import/export controls at bottom using compact buttons.

API keys and model selectors should be available but visually quiet. Their summary can show:

- Code model: MiMo V2.5 or DeepSeek V4 Pro.
- Vision model: MiMo V2.5.
- Key source: hosted MiMo key or user key.

Token estimates should not occupy a prominent permanent card. They belong in run details.

### Center Column: Agent Workflow

Recommended width: flexible `minmax(560px, 1fr)`.

Responsibilities:

- Show the current agent loop.
- Show state transitions clearly.
- Stream SCAD output while generated.
- Show correction prompt after vision review.
- Hold the only active user input field.

Recommended component order:

1. Stage rail.
2. Agent timeline.
3. Sticky composer.
4. Advanced details drawer.

#### Stage Rail

The top of the center column should show three explicit stages:

1. `SCAD generation`
2. `MCP render`
3. `Vision review`

Each stage supports these states:

- `waiting`
- `running`
- `complete`
- `failed`
- `needs user`

The stage rail should answer: "Where is my model right now?"

Examples:

- During LLM generation: `SCAD generation` is running.
- After code is complete and render begins: `MCP render` is running.
- After three views and STL exist: `MCP render` is complete.
- During Review: `Vision review` is running.
- After vision review: `Vision review` is complete and the composer is in correction mode.

#### Agent Timeline

The timeline should be a compact event stream, not a set of unrelated cards. Each model iteration should show:

- User requirement or correction prompt.
- SCAD generation event.
- MCP render event.
- Vision review event.

SCAD code should stream visibly while generation is active. Once generation finishes, the timeline should show a short code preview, not a giant editor. Full OpenSCAD belongs in an advanced drawer.

MCP render event should show:

- `Rendering model`
- `Front view ready`
- `Top view ready`
- `Right view ready`
- `STL ready`

Vision review event should show:

- Summary.
- Issues.
- Editable correction prompt.

#### Composer

The composer is the single user input.

Initial mode:

- Label: `Tell the agent what to build`
- Placeholder: `Describe the 3D model you want, for example: a 30ml measuring cup with a round body and small handle...`
- Primary button: `Generate model`

After vision review:

- Label: `Edit the correction prompt`
- Value: the vision model's `correctionPrompt`.
- Primary button: `Regenerate with prompt`

This avoids two competing input boxes. The user should understand that editing this text changes the next generation loop.

### Right Column: Model Preview

Recommended width: 420-520px.

Responsibilities:

- Show only current model deliverables.
- Make STL download obvious.
- Keep the three views visible in the first viewport.

Recommended structure:

- Header: `Model preview`
- Large `Front view`
- Two smaller views:
  - `Top view`
  - `Right view`
- Current artifact status:
  - `Draft preview`
  - `STL ready`
  - `Needs review`
  - `Reviewed`
- Primary button: `Download STL`
- Secondary PNG actions:
  - `Front PNG`
  - `Top PNG`
  - `Right PNG`

The STL button should have more visual weight than PNG downloads. PNG downloads are useful, but STL is the main deliverable.

The right column should not permanently show:

- Compiler logs.
- Prompt trace.
- Token details.
- Iteration history.

Those belong in run details.

## Debug and Advanced Information

Add a collapsed `Run details` area in the center column.

Recommended tabs or sections:

- Compiler
- Prompt trace
- Tokens
- Iteration history
- Project JSON

Default state: collapsed.

Exception: if a render or model call fails, auto-open the relevant details section:

- Render failure opens Compiler.
- LLM failure opens Prompt trace or request error.
- Vision failure opens Vision details.

OpenSCAD editing remains available through `Advanced: view/edit OpenSCAD`, but it should not dominate the main workflow.

## Interaction States

Recommended status labels:

- `Waiting for requirement`
- `Generating SCAD`
- `SCAD generated`
- `Rendering model`
- `Three views ready`
- `Reviewing views`
- `Review complete`
- `Waiting for correction`
- `STL ready`
- `Run failed`

Recommended buttons:

- `Generate model`
- `Review views`
- `Regenerate with prompt`
- `Rerender`
- `Download STL`
- `Final export`
- `View OpenSCAD`
- `Run details`

## Data and Workflow Rules

The implementation should preserve these product rules:

- Review must not automatically call the text LLM.
- Review only produces review data and a correction prompt.
- The correction prompt is displayed to the user and placed in the composer.
- A new text LLM call only happens after the user confirms by clicking the next generation action.
- Render MCP input is OpenSCAD source.
- Render MCP output is front/top/right PNG images, STL content, and diagnostics.
- Every new generated or rendered model invalidates previous vision review.
- History records model generation and rendering states. Vision review is current guidance, not the primary history UI.

## Testing Development Guide

Future tests should protect the workflow, hierarchy, and non-blocking behavior.

### Unit Tests

Render MCP:

- `render({ source })` returns `front`, `top`, `right`, `stl`, and diagnostics.
- Failed OpenSCAD returns a structured error and does not capture views.
- Worker render timeout terminates the worker and returns a timeout error.

Vision review parsing:

- JSON review with `summary`, `issues`, `correctionPrompt`, `confidence` parses correctly.
- Missing `correctionPrompt` receives a fallback prompt.
- Non-JSON vision output receives a fallback correction prompt.

Prompt assembly:

- Vision system prompt asks for `correctionPrompt`.
- Vision prompt explicitly avoids returning OpenSCAD code.
- Revision prompt includes original requirement, current code, review issues, and user-edited correction prompt.

Project persistence:

- STL persists in project export/import.
- API keys are never exported.
- Multiple model history keeps active project selection.

### Playwright E2E Tests

Core workflow:

- Generate streams SCAD into the agent output.
- After generation, MCP render produces three view images and enables STL download.
- Review sends images to the vision endpoint.
- Review does not call `/api/llm`.
- Review displays the correction prompt and fills the composer.
- Editing the correction prompt then clicking regenerate calls `/api/llm`.
- The regenerated SCAD is rendered again by MCP.
- After regeneration, previous review is cleared and `Review views` is available again.

Error workflow:

- Invalid OpenSCAD render returns an error and the page leaves busy state.
- The user can start a new model after a render error.
- Render progress text appears before heavy render work.

Layout and screenshot tests:

- At 1440x900, the three views and STL download are visible in the right column.
- The center stage rail shows SCAD, MCP, and Vision stages.
- The composer is visible and not displaced by logs.
- OpenSCAD code is collapsed by default after generation.
- Run details are collapsed by default.
- The left model list scrolls internally when many models exist.
- Key/model settings do not dominate the first viewport.

Accessibility and semantics:

- Main CTAs have clear names:
  - `Generate model`
  - `Review views`
  - `Regenerate with prompt`
  - `Download STL`
- Stage states are represented with visible text, not color only.
- Image alt text identifies each view.

### Online Verification

After deployment:

- Run full Playwright against the Pages preview with a 60s timeout because the OpenSCAD worker bundle is large.
- Run key workflow tests against `https://ai.openscad.tech`.
- Verify `curl -I https://ai.openscad.tech` returns HTTP 200.

## Implementation Sequence

1. Update i18n labels and state names.
2. Add a stage rail component derived from current project and busy state.
3. Reshape the right panel into `ModelPreviewPanel`.
4. Move compiler, prompt trace, token, and history into collapsed `Run details`.
5. Simplify left sidebar settings into a lower-emphasis summary.
6. Update Playwright tests for layout hierarchy and workflow.
7. Run screenshot tests before deployment.

## Acceptance Criteria

- The first viewport communicates the whole loop: SCAD generation, MCP render, vision review.
- A user can see current model deliverables without scrolling: front/top/right views and STL download.
- The single composer is clearly used for both initial model requests and correction prompts.
- Vision review produces a correction prompt but does not automatically regenerate code.
- Debug logs are accessible without competing with the main workflow.
- Desktop screenshot tests pass at 1440x900.
- Core workflow tests pass locally and against the deployed preview.
