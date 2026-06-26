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

- Left control panel: model keys, model selection, token estimate, project import
  and export, and local model history.
- Center agent panel: run timeline, requirement composer, workflow actions, and
  advanced OpenSCAD code editing.
- Right result panel: front/top/right views, asset downloads, compiler output,
  visual review output, and recent history.

### Main Workflow

1. User writes a requirement, for example a six-slot organizer or a 30 ml cup.
2. User clicks **Generate**.
3. The code model streams OpenSCAD into the workbench.
4. The render adapter compiles the generated OpenSCAD in the browser.
5. The app captures front, top, and right PNG views from the STL.
6. User clicks **Review**.
7. The vision model checks the three views against the original requirement and
   returns a summary, issue list, confidence score, and correction prompt.
8. The correction prompt becomes editable in the composer.
9. User clicks **Iterate Again** to generate and render the next draft.
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

## Feature Inventory

### Generation

- Uses a code-focused system prompt that asks for valid, deterministic, complete
  OpenSCAD.
- Models in millimeters.
- Requests named parameters, stable CSG, clear module boundaries, and printable
  geometry.
- Detects Chinese vs English input and asks the model to use the same natural
  language for feedback and comments.
- Streams OpenAI-compatible response chunks into the code panel.

### Rendering

- Uses `openscad-wasm` in the browser.
- Runs compile work in a Web Worker when available.
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
- Stores prompt traces for generation, compilation, review, revision, and final
  export.

### Export

- Draft outputs:
  - Front PNG
  - Top PNG
  - Right PNG
  - STL
- Final output:
  - High-precision SCAD
  - High-precision STL
- Final export asks for confirmation because it can be slower than draft render.

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
- `tests/`: Playwright workflow and screenshot coverage.

## Data Model

The core project state contains:

- Project identity: `id`, `title`, `updatedAt`
- User input: `requirement`
- Model settings: `codeModelId`, `visionModelId`
- Model assets: `currentCode`, `proposedCode`, `stl`, `views`
- Runtime output: `compilerOutput`, `review`
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
- Screenshot tests protect the desktop workbench layout.

## Local Development

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
- Desktop workbench screenshot coverage.
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
- Required Cloudflare setting: `MiMo_KEY` or `MIMO_KEY` is optional and is used
  only when the user has not supplied a browser key.

After deployment:

- Verify the production page returns HTTP 200.
- Run a smoke test for generate, draft render, review, and export behavior when
  provider credentials are available.

## License Policy

AI OpenSCAD uses AGPL-3.0-only because the project should remain strongly
copyleft even when modified versions are offered as a network service. Modified
deployments that users interact with over a network must provide corresponding
source code under the same license.
