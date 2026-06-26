import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

function loadDeployWorkflow(): string {
  return readFileSync(".github/workflows/deploy.yml", "utf8");
}

function withoutComments(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+#.*$/, ""))
    .join("\n");
}

function expectBlock(text: string, heading: string): string {
  const start = text.indexOf(heading);
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = text.slice(start + heading.length);
  const nextJob = rest.search(/\n  [a-z][a-z0-9_-]+:\n/);
  return nextJob === -1 ? rest : rest.slice(0, nextJob);
}

function expectTopLevelBlock(text: string, heading: string, nextHeading: string): string {
  const start = text.indexOf(heading);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = text.indexOf(nextHeading, start + heading.length);
  expect(end).toBeGreaterThan(start);
  return text.slice(start + heading.length, end);
}

describe("GitHub Actions deploy workflow", () => {
  test("runs checks on pull requests, pushes, and manual main runs", () => {
    const workflow = withoutComments(loadDeployWorkflow());
    const triggers = expectTopLevelBlock(workflow, "on:\n", "\nconcurrency:");

    expect(workflow).toContain("name: deploy");
    expect(expectBlock(triggers, "  pull_request:\n")).toContain("branches: [main]");
    expect(expectBlock(triggers, "  push:\n")).toContain("branches: [main]");
    expect(triggers).toContain("  workflow_dispatch:");
  });

  test("uses Node 20, installs Playwright Chromium, and runs release checks", () => {
    const workflow = withoutComments(loadDeployWorkflow());
    const checks = expectBlock(workflow, "  checks:\n");

    expect(checks).toContain("actions/checkout@");
    expect(checks).toContain("actions/setup-node@");
    expect(checks).toContain("node-version: 20");
    expect(checks).toContain("npm ci");
    expect(checks).toContain("npx playwright install --with-deps chromium");
    expect(checks).toContain("npm test");
    expect(checks).toContain("npm run test:e2e");
    expect(checks).toContain("npm run build");
  });

  test("deploys Cloudflare Pages from main only after checks pass", () => {
    const workflow = withoutComments(loadDeployWorkflow());
    const deploy = expectBlock(workflow, "  deploy:\n");
    const deployStep = expectBlock(deploy, "      - name: Deploy to Cloudflare Pages\n");

    expect(deploy).toContain("needs: checks");
    expect(deploy).toContain("github.ref == 'refs/heads/main' && github.event_name != 'pull_request'");
    expect(deploy).toContain("contents: read");
    expect(deployStep).toContain("npx wrangler pages deploy dist --project-name ai-openscad --branch main");
    expect(deployStep).toContain("CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}");
    expect(deployStep).toContain("CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}");
  });
});
