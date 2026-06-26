# Browser Locale I18n Implementation Plan

> **For agentic workers:** This plan is small and sequential. Use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display the AI OpenSCAD UI in Chinese or English according to the browser language.

**Architecture:** Add a lightweight typed i18n dictionary and browser-language resolver. Keep AI response language detection separate from UI language. Replace user-visible App text, placeholders, status strings, errors, and confirmation text with translation lookups. Add unit and Playwright locale coverage.

**Tech Stack:** React, TypeScript, Vite, Vitest, Playwright.

---

### Task 1: I18n Domain

**Files:**
- Create: `src/lib/i18n.ts`
- Create: `src/lib/i18n.test.ts`

- [x] Write failing tests for resolving `zh-CN` to Chinese and `en-US` to English.
- [x] Write failing tests for fallback to English.
- [x] Implement typed translation dictionary and lookup helper.

### Task 2: Localize App UI

**Files:**
- Modify: `src/App.tsx`

- [x] Resolve language from `navigator.languages`.
- [x] Replace all visible labels, buttons, placeholders, headings, empty states, error text, status text, confirm text, and trace block labels with translations.
- [x] Keep generated code, user content, model IDs, and AI responses unchanged.

### Task 3: Locale E2E Coverage

**Files:**
- Create: `tests/i18n.spec.ts`
- Modify: `tests/review.spec.ts`

- [x] Add isolated Playwright locale tests for `en-US` and `zh-CN`.
- [x] Assert English locale shows English UI.
- [x] Assert Chinese locale shows Chinese UI.
- [x] Keep screenshot coverage stable without changing the existing baseline.

### Task 4: Verify And Deploy

**Files:**
- Existing files only.

- [x] Run `npm test`.
- [x] Run `npm run test:e2e`.
- [x] Run `npm run build`.
- [ ] Commit and deploy to Cloudflare Pages.
