# AI OpenSCAD Design

## Goal

Build a Cloudflare Pages app that turns a user's text request into OpenSCAD code, compiles it in the browser, captures orthographic views, asks a vision model to review the result, proposes code changes, and waits for user confirmation before recompiling.

## Product Scope

- No login.
- Bring your own API key.
- Cloudflare Worker/Pages Functions proxy model requests without storing keys or project data.
- Default code and vision model: MiMo V2.5.
- Optional code model: DeepSeek V4.
- Browser-side OpenSCAD rendering first; future MCP rendering through the same render adapter interface.
- Local project history with import/export.

## Architecture

The frontend owns the workspace, model orchestration, code editor, render lifecycle, view capture, review display, and user confirmation loop. Pages Functions expose `/api/llm` and `/api/vision` as model gateway endpoints. The gateway accepts a user key per request, translates a generic payload into provider-specific HTTP calls, and returns normalized responses.

Rendering is hidden behind a `RenderAdapter`. The first adapter loads `openscad-wasm` in the browser and returns a render result. A future `McpRenderAdapter` can implement the same interface without changing the workflow.

## Workflow

1. User enters a text requirement and API key.
2. User chooses MiMo V2.5 or DeepSeek V4 for code generation.
3. App sends requirement, OpenSCAD skill context, model choice, and key to `/api/llm`.
4. App stores the generated OpenSCAD code locally.
5. Browser render adapter compiles the code.
6. App captures front, top, and right views from the preview area.
7. App sends requirement, code, and views to `/api/vision` with the user's key.
8. Vision review returns structured issues and revision guidance.
9. Code model proposes revised OpenSCAD.
10. User accepts, edits, or rejects the revision before another compile.

## OpenSCAD Skill Library

The app includes prompt material for:

- Valid OpenSCAD syntax and parametric modeling patterns.
- Official library use.
- BOSL2 use and include conventions.
- Manufacturable dimensions in millimeters.
- Stable camera/view conventions for visual review.
- Avoiding unsupported side effects and external dependencies.

## Data

Project data is stored in browser local storage:

- Original requirement.
- Current and proposed code.
- Selected code model.
- Iteration history.
- Compile results.
- Captured view data URLs.
- Vision review.

The exported project file is JSON and contains the same local state, excluding API keys.

## Error Handling

- Missing API key: block model calls with a local error.
- Provider failure: show normalized status and message.
- Compile failure: keep current code, show compiler output, allow AI repair.
- Vision failure: keep generated model and allow manual iteration.
- Unsupported OpenSCAD WASM runtime: show adapter error and preserve code/export.

## Testing

Unit tests cover provider request normalization, prompt assembly, local project serialization, iteration transitions, and render adapter fallback behavior. The deployed app is verified with build output and Wrangler Pages deployment.
