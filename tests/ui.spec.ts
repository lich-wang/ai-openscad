import { expect, test } from "@playwright/test";

const project = {
  id: "project-ui-test",
  title: "UI Test",
  requirement: "生成一个30ML的杯子模型",
  codeModelId: "mimo-v2.5",
  visionModelId: "mimo-v2.5",
  currentCode:
    "$fn = 32;\nmodule cup() {\n  difference() {\n    cylinder(h=40, r=18);\n    translate([0,0,2]) cylinder(h=39, r=15);\n  }\n}\ncup();",
  proposedCode: "",
  compilerOutput: "Compiled to STL in browser.\nDraft precision was used for fast review.",
  review: {
    summary: "杯子主体正确，杯口需要更圆滑。",
    issues: ["杯口倒角不明显"],
    confidence: 0.86
  },
  views: {
    front:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP8z8AARQAFAAH/AnH9zAAAAABJRU5ErkJggg==",
    top:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP8z8AARQAFAAH/AnH9zAAAAABJRU5ErkJggg==",
    right:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP8z8AARQAFAAH/AnH9zAAAAABJRU5ErkJggg=="
  },
  iterations: [
    {
      id: "generated",
      createdAt: "2026-06-26T00:00:00.000Z",
      requirement: "生成一个30ML的杯子模型",
      code: "cube(10);",
      modelId: "mimo-v2.5",
      status: "generated"
    }
  ],
  promptTrace: [
    {
      id: "trace-1",
      createdAt: "2026-06-26T00:00:01.000Z",
      phase: "code-generation",
      modelId: "mimo-v2.5",
      systemPrompt: "Generate OpenSCAD with draft precision.",
      userPrompt: "生成一个30ML的杯子模型",
      response: "$fn = 32; module cup() {}"
    },
    {
      id: "trace-2",
      createdAt: "2026-06-26T00:00:02.000Z",
      phase: "compile",
      modelId: "browser-openscad",
      systemPrompt: "Render skill: draft compile and fast visual review.",
      userPrompt: "Compile current OpenSCAD with draft precision.",
      response: "Compiled to STL in browser."
    }
  ],
  updatedAt: "2026-06-26T00:00:00.000Z"
};

test("desktop workbench keeps controls visible and matches screenshot", async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.llm-api-key", "sk-llm");
    localStorage.setItem("ai-openscad.vision-api-key", "sk-vision");
    localStorage.setItem("ai-openscad.project", JSON.stringify(storedProject));
  }, project);

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Agent Run" })).toBeVisible();
  await expect(page.locator(".topbarActions")).toHaveCount(0);
  await expect(page.locator(".projectTools").getByText("Project files")).toBeVisible();
  await expect(page.locator(".agentComposer").getByText("Draft preview uses low precision")).toBeVisible();
  await expect(page.locator(".agentComposer textarea")).toHaveCount(1);
  await expect(page.getByText("User Request")).toBeVisible();
  await expect(page.getByRole("button", { name: /Final Export/i })).toBeVisible();
  await expect(page.getByText("LLM tokens")).toBeVisible();
  await expect(page.getByText("Vision tokens")).toBeVisible();
  await expect(page.locator("select")).toHaveCount(0);
  await expect(page.locator(".controlPanel").getByRole("button", { name: "New model" })).toBeVisible();
  await expect(page.locator(".codeDisclosure")).not.toHaveAttribute("open", "");

  const helpButton = page.getByRole("button", { name: "No key?" }).first();
  await helpButton.hover();
  const inviteTooltip = page.locator(".keyHelpTooltip").filter({ hasText: "QRU857" }).first();
  await expect(inviteTooltip.locator(".inviteCodeLine")).toContainText("Invite code");
  await expect(inviteTooltip.locator(".inviteCodeLine")).toContainText("QRU857");
  await expect(inviteTooltip.getByAltText("Xiaomi MiMo invite QR code")).toBeVisible();
  const helpBox = await helpButton.boundingBox();
  const inviteBox = await inviteTooltip.boundingBox();
  const qrBox = await inviteTooltip
    .getByAltText("Xiaomi MiMo invite QR code")
    .boundingBox();
  expect(inviteBox!.x).toBeGreaterThanOrEqual(helpBox!.x);
  expect(inviteBox?.width).toBeGreaterThanOrEqual(330);
  expect(qrBox?.width).toBeGreaterThanOrEqual(168);
  await page.mouse.move(900, 40);

  const controlBox = await page.locator(".controlPanel").boundingBox();
  const codeBox = await page.locator(".codePanel").boundingBox();
  const composerBox = await page.locator(".agentComposer").boundingBox();
  const lastActionBox = await page
    .getByRole("button", { name: /Final Export/i })
    .boundingBox();

  expect(controlBox).not.toBeNull();
  expect(codeBox).not.toBeNull();
  expect(composerBox).not.toBeNull();
  expect(lastActionBox).not.toBeNull();
  const pageHeight = await page.evaluate(() =>
    Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)
  );
  expect(pageHeight).toBeLessThanOrEqual(900);
  expect(lastActionBox!.x).toBeGreaterThanOrEqual(composerBox!.x);
  expect(lastActionBox!.x + lastActionBox!.width).toBeLessThanOrEqual(
    composerBox!.x + composerBox!.width
  );
  expect(controlBox!.x + controlBox!.width).toBeLessThan(codeBox!.x);

  await expect(page.locator(".workspace")).toHaveScreenshot("desktop-workbench.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.02
  });

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(".controlPanel").getByRole("button", { name: "New model" }).click();
  await expect(page.locator(".agentInput")).toHaveValue("");
});
