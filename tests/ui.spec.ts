import { expect, test, type Page } from "@playwright/test";

const WORKBENCH_SCREENSHOT_DIFF_RATIO = 0.18;
const RUN_SCREENSHOT_ASSERTIONS = !process.env.CI;
const INVITE_IMAGE_NATURAL_WIDTH = 772;
const INVITE_IMAGE_NATURAL_HEIGHT = 1004;
const INVITE_IMAGE_DISPLAY_SCALE = 0.5;
const pixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP8z8AARQAFAAH/AnH9zAAAAABJRU5ErkJggg==";
const viewNames = [
  "Front",
  "Back",
  "Left",
  "Right",
  "Top",
  "Bottom",
  "Iso Front Right Top",
  "Iso Front Left Top",
  "Iso Back Right Top",
  "Iso Back Left Top",
  "Iso Front Right Bottom",
  "Iso Front Left Bottom",
  "Iso Back Right Bottom",
  "Iso Back Left Bottom"
];
const viewKeys = [
  "front",
  "back",
  "left",
  "right",
  "top",
  "bottom",
  "isoFrontRightTop",
  "isoFrontLeftTop",
  "isoBackRightTop",
  "isoBackLeftTop",
  "isoFrontRightBottom",
  "isoFrontLeftBottom",
  "isoBackRightBottom",
  "isoBackLeftBottom"
] as const;
const renderedViews = Object.fromEntries(viewKeys.map((key) => [key, pixel]));
const emptyViews = Object.fromEntries(viewKeys.map((key) => [key, ""]));

function referenceImageFile(name: string) {
  return {
    name,
    mimeType: "image/png",
    buffer: Buffer.from(pixel.split(",")[1], "base64")
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const validStl = `solid ui-test
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 42 0 0
    vertex 0 28 0
  endloop
endfacet
facet normal 0 -1 0
  outer loop
    vertex 0 0 0
    vertex 8 6 36
    vertex 42 0 0
  endloop
endfacet
facet normal 1 1 1
  outer loop
    vertex 42 0 0
    vertex 8 6 36
    vertex 0 28 0
  endloop
endfacet
facet normal -1 1 0
  outer loop
    vertex 0 28 0
    vertex 8 6 36
    vertex 0 0 0
  endloop
endfacet
endsolid ui-test`;

const project = {
  id: "project-ui-test",
  title: "UI Test",
  requirement: "生成一个30ML的杯子模型",
  originalRequirement: "生成一个30ML的杯子模型",
  codeModelId: "mimo-v2.5",
  visionModelId: "mimo-v2.5",
  currentCode:
    "$fn = 32;\nmodule cup() {\n  difference() {\n    cylinder(h=40, r=18);\n    translate([0,0,2]) cylinder(h=39, r=15);\n  }\n}\ncup();",
  proposedCode: "",
  compilerOutput: "Compiled to STL in browser.\nDraft precision was used for fast review.",
  review: {
    summary: "杯子主体正确，杯口需要更圆滑。",
    issues: ["杯口倒角不明显"],
    correctionPrompt: "保持30ML杯子容量，增加杯口圆角倒角。",
    confidence: 0.86
  },
  stl: validStl,
  views: renderedViews,
  renderEvidence: {
    compileStatus: "success",
    diagnostics: "Compiled draft preview.",
    renderPrecision: "draft",
    backend: "web-manifold",
    viewCount: 14
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
  runEvents: [
    {
      id: "event-user",
      createdAt: "2026-06-26T00:00:00.000Z",
      role: "user",
      title: "User request",
      content: "生成一个30ML的杯子模型",
      status: "complete"
    },
    {
      id: "event-code",
      createdAt: "2026-06-26T00:00:01.000Z",
      role: "assistant",
      title: "Generated OpenSCAD code",
      content: "Generated OpenSCAD code.",
      code: "$fn = 32;\nmodule cup() {}\ncup();",
      status: "complete"
    },
    {
      id: "event-render-start",
      createdAt: "2026-06-26T00:00:02.000Z",
      role: "tool",
      title: "Render started",
      content: "Renderer tool started draft preview.",
      status: "complete"
    },
    {
      id: "event-render-done",
      createdAt: "2026-06-26T00:00:03.000Z",
      role: "tool",
      title: "Render finished",
      content: "Renderer tool finished draft preview.",
      status: "complete"
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

const emptyProject = {
  id: "project-empty-ui-test",
  title: "Empty UI Test",
  requirement: "",
  originalRequirement: "",
  codeModelId: "mimo-v2.5",
  visionModelId: "mimo-v2.5",
  currentCode: "",
  proposedCode: "",
  compilerOutput: "",
  review: null,
  stl: "",
  views: emptyViews,
  iterations: [],
  runEvents: [],
  promptTrace: [],
  updatedAt: "2026-06-26T00:00:00.000Z"
};

const invalidStlProject = {
  ...project,
  id: "project-invalid-stl-preview",
  review: null,
  stl: "this is not a valid stl body"
};

async function expectLeftPanelOrder(page: Page) {
  const classOrder = await page.locator(".controlPanel").evaluate((panel) =>
    Array.from(panel.children)
      .filter((child) =>
        child.classList.contains("sidebarSettings") ||
        child.classList.contains("projectTools") ||
        child.classList.contains("newModelButton") ||
        child.classList.contains("modelHistory")
      )
      .map((child) => {
        if (child.classList.contains("sidebarSettings")) {
          return "settings";
        }
        if (child.classList.contains("projectTools")) {
          return "projectFiles";
        }
        if (child.classList.contains("newModelButton")) {
          return "newModel";
        }
        return "models";
      })
  );

  expect(classOrder).toEqual(["settings", "projectFiles", "newModel", "models"]);
  await expect(page.locator(".sidebarSettings summary")).toContainText("Basic settings");
  await expect(page.locator(".projectTools")).toContainText("Project files");
  await expect(
    page.locator(".controlPanel").getByRole("button", { name: "New model" })
  ).toBeVisible();
  await expect(page.locator(".modelHistory")).toContainText("Models");
  await expectAutoIterationControls(page);
}

async function expectAutoIterationControls(
  page: Page,
  expectedTarget = "85",
  expectedIterations = "0"
) {
  const targetConfidence = page.getByLabel("Target confidence");
  const autoIterations = page.getByLabel("Auto iterations");
  await expect(targetConfidence).toBeVisible();
  await expect(autoIterations).toBeVisible();
  await expect(targetConfidence).toHaveValue(expectedTarget);
  await expect(autoIterations).toHaveValue(expectedIterations);
  await expect(targetConfidence).toHaveAttribute("min", "1");
  await expect(targetConfidence).toHaveAttribute("max", "100");
  await expect(targetConfidence).toHaveAttribute("step", "1");
  await expect(autoIterations).toHaveAttribute("min", "0");
  await expect(autoIterations).toHaveAttribute("max", "5");
  await expect(autoIterations).toHaveAttribute("step", "1");
  await targetConfidence.focus();
  await expect(targetConfidence).toBeFocused();
  await autoIterations.focus();
  await expect(autoIterations).toBeFocused();

  const metrics = await page.locator(".sidebarSettings").evaluate((settings) => ({
    clientWidth: settings.clientWidth,
    scrollWidth: settings.scrollWidth
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

async function expectLeftPanelVisualStack(page: Page) {
  const settingsBox = await page.locator(".sidebarSettings").boundingBox();
  const projectToolsBox = await page.locator(".projectTools").boundingBox();
  const newModelBox = await page
    .locator(".controlPanel")
    .getByRole("button", { name: "New model" })
    .boundingBox();
  const historyBox = await page.locator(".modelHistory").boundingBox();

  expect(settingsBox).not.toBeNull();
  expect(projectToolsBox).not.toBeNull();
  expect(newModelBox).not.toBeNull();
  expect(historyBox).not.toBeNull();
  expect(projectToolsBox!.y).toBeGreaterThanOrEqual(
    settingsBox!.y + settingsBox!.height - 1
  );
  expect(newModelBox!.y).toBeGreaterThanOrEqual(
    projectToolsBox!.y + projectToolsBox!.height - 1
  );
  expect(historyBox!.y).toBeGreaterThanOrEqual(
    newModelBox!.y + newModelBox!.height - 1
  );
}

async function addStoredProjects(page: Page, count: number) {
  const projects = Array.from({ length: count }, (_, index) => ({
    ...project,
    id: `project-history-${index}`,
    requirement: `模型 ${index + 1}`,
    updatedAt: new Date(Date.UTC(2026, 5, 26, 0, index)).toISOString()
  }));

  await page.addInitScript((storedProjects) => {
    localStorage.setItem("ai-openscad.projects", JSON.stringify(storedProjects));
    localStorage.setItem("ai-openscad.active-project-id", storedProjects[0].id);
  }, projects);
}

async function expectStackedFocusOrder(page: Page) {
  const focusedSections: string[] = [];

  await page.keyboard.press("Tab");
  for (let index = 0; index < 50; index += 1) {
    focusedSections.push(
      await page.evaluate(() => {
        const active = document.activeElement;
        if (!active) {
          return "";
        }
        if (active.closest(".sidebarSettings")) {
          return "settings";
        }
        if (active.closest(".projectTools")) {
          return "projectFiles";
        }
        if (active.closest(".newModelButton")) {
          return "newModel";
        }
        if (active.closest(".modelHistory")) {
          return "models";
        }
        if (active.closest(".codePanel")) {
          return "codePanel";
        }
        return "";
      })
    );
    if (focusedSections.includes("codePanel")) {
      break;
    }
    await page.keyboard.press("Tab");
  }

  expect(focusedSections.indexOf("settings")).toBeGreaterThanOrEqual(0);
  expect(focusedSections.indexOf("projectFiles")).toBeGreaterThan(
    focusedSections.indexOf("settings")
  );
  expect(focusedSections.indexOf("newModel")).toBeGreaterThan(
    focusedSections.indexOf("projectFiles")
  );
  expect(focusedSections.indexOf("models")).toBeGreaterThan(
    focusedSections.indexOf("newModel")
  );
  expect(focusedSections.indexOf("codePanel")).toBeGreaterThan(
    focusedSections.indexOf("models")
  );
}

async function expectTimelineOrder(page: Page, labels: string[]) {
  const positions = await page.locator(".agentTimeline").evaluate((timeline, expected) => {
    const text = timeline.textContent ?? "";
    return (expected as string[]).map((label) => text.indexOf(label));
  }, labels);

  for (const position of positions) {
    expect(position).toBeGreaterThanOrEqual(0);
  }
  for (let index = 1; index < positions.length; index += 1) {
    expect(positions[index]).toBeGreaterThan(positions[index - 1]);
  }
}

async function expectNoHorizontalPageOverflow(page: Page) {
  const pageMetrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(pageMetrics.scrollWidth).toBeLessThanOrEqual(pageMetrics.clientWidth);
}

async function expectFourteenViewPanelTextFits(page: Page) {
  await expect(page.locator(".viewTile")).toHaveCount(14);
  await expect(page.locator(".viewTile figcaption")).toHaveText(viewNames);

  const resultPanelMetrics = await page.locator(".resultPanel").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth
  }));
  expect(resultPanelMetrics.scrollWidth).toBeLessThanOrEqual(
    resultPanelMetrics.clientWidth + 1
  );

  const textMetrics = await page
    .locator(".viewTile figcaption, .renderAssetActions button")
    .evaluateAll((elements) =>
      elements.map((element) => ({
        clientWidth: element.clientWidth,
        label: element.textContent ?? "",
        scrollWidth: element.scrollWidth
      }))
    );
  for (const metrics of textMetrics) {
    expect(metrics.scrollWidth, metrics.label).toBeLessThanOrEqual(
      metrics.clientWidth + 1
    );
  }

  const downloadButtonRects = await page.locator(".renderAssetActions button").evaluateAll(
    (buttons) =>
      buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          bottom: rect.bottom,
          label: button.textContent ?? "",
          left: rect.left,
          right: rect.right,
          top: rect.top
        };
      })
  );
  for (let first = 0; first < downloadButtonRects.length; first += 1) {
    for (let second = first + 1; second < downloadButtonRects.length; second += 1) {
      const a = downloadButtonRects[first];
      const b = downloadButtonRects[second];
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      expect(overlapX > 1 && overlapY > 1, `${a.label} overlaps ${b.label}`).toBe(
        false
      );
    }
  }

  for (const name of viewNames) {
    const button = page
      .locator(".resultPanel")
      .getByRole("button", { name: `${name} PNG`, exact: true });
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeVisible();
  }
  const sourceButton = page
    .locator(".resultPanel")
    .getByRole("button", { name: "Source SCAD", exact: true });
  await sourceButton.scrollIntoViewIfNeeded();
  await expect(sourceButton).toBeVisible();
  const stlButton = page.locator(".resultPanel").getByRole("button", { name: /STL/i });
  await stlButton.scrollIntoViewIfNeeded();
  await expect(stlButton).toBeVisible();
}

function interactivePreview(page: Page) {
  return page.locator('[aria-label="Interactive STL preview"]').first();
}

async function previewCanvas(page: Page) {
  const preview = interactivePreview(page);
  await expect(preview).toBeVisible();
  const isCanvas = await preview.evaluate((element) => element instanceof HTMLCanvasElement);
  const canvas = isCanvas ? preview : preview.locator("canvas");
  await expect(canvas).toBeVisible();
  return canvas;
}

async function expectPreviewHasModelPixels(page: Page) {
  const canvas = await previewCanvas(page);
  const paintedPixels = await canvas.evaluate((node) => {
    const element = node as HTMLCanvasElement;
    const gl = element.getContext("webgl2") ?? element.getContext("webgl");
    if (!gl) {
      return 0;
    }
    const pixels = new Uint8Array(element.width * element.height * 4);
    gl.readPixels(0, 0, element.width, element.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let painted = 0;
    for (let index = 0; index < pixels.length; index += 16) {
      const r = pixels[index];
      const g = pixels[index + 1];
      const b = pixels[index + 2];
      const alpha = pixels[index + 3];
      const isBackground =
        Math.abs(r - 248) < 6 && Math.abs(g - 250) < 6 && Math.abs(b - 252) < 6;
      if (alpha > 0 && !isBackground) {
        painted += 1;
      }
    }
    return painted;
  });
  expect(paintedPixels).toBeGreaterThan(250);
}

async function dragInteractivePreview(page: Page) {
  const canvas = await previewCanvas(page);
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * 0.65, box!.y + box!.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.25, box!.y + box!.height * 0.42, {
    steps: 8
  });
  await page.mouse.up();
}

async function expectPreviewDoesNotTrapKeyboardFocus(page: Page) {
  const preview = interactivePreview(page);
  await expect(preview).toBeVisible();
  const focusableSelector =
    'a[href], button, input, select, textarea, [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
  const previewIsFocusable = await preview.evaluate(
    (element) => (element as HTMLElement).tabIndex >= 0
  );
  const focusableDescendants = preview.locator(focusableSelector);
  const descendantCount = await focusableDescendants.count();
  if (!previewIsFocusable && descendantCount === 0) {
    expect(
      await preview.evaluate((element) => (element as HTMLElement).tabIndex)
    ).toBeLessThan(0);
    return;
  }

  const focusTarget = previewIsFocusable ? preview : focusableDescendants.first();
  await focusTarget.focus();
  await expect(focusTarget).toBeFocused();
  await page.keyboard.press("Tab");
  const focusInsidePreview = await page.evaluate(() =>
    Boolean(document.activeElement?.closest('[aria-label="Interactive STL preview"]'))
  );
  expect(focusInsidePreview).toBe(false);
}

async function expectInteractivePreviewIsOnlyLargeView(page: Page) {
  const preview = interactivePreview(page);
  await expect(preview).toBeVisible();
  const previewBox = await preview.boundingBox();
  const viewGridBox = await page.locator(".viewGrid").boundingBox();
  expect(previewBox).not.toBeNull();
  expect(viewGridBox).not.toBeNull();
  expect(previewBox!.y).toBeLessThan(viewGridBox!.y);

  const fixedTileBoxes = await page.locator(".viewTile").evaluateAll((tiles) =>
    tiles.map((tile) => {
      const rect = tile.getBoundingClientRect();
      return {
        height: rect.height,
        width: rect.width
      };
    })
  );
  expect(fixedTileBoxes).toHaveLength(14);
  const frontTileBox = fixedTileBoxes[0];
  for (const tileBox of fixedTileBoxes) {
    expect(Math.abs(tileBox.width - frontTileBox.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(tileBox.height - frontTileBox.height)).toBeLessThanOrEqual(2);
  }

  const largestFixedTileArea = Math.max(
    ...fixedTileBoxes.map((tileBox) => tileBox.width * tileBox.height)
  );
  expect(previewBox!.width * previewBox!.height).toBeGreaterThan(largestFixedTileArea);
  return previewBox;
}

test("desktop workbench keeps controls visible", async ({
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
  await expect(page.locator(".workflowStageStrip.arrowPipeline")).toBeVisible();
  await expect(page.locator(".workflowStageStrip.arrowPipeline")).toHaveAttribute(
    "aria-label",
    "Workflow stages"
  );
  await expect(page.locator(".workflowStage")).toHaveCount(3);
  await expect(page.locator(".workflowStage").nth(0)).toContainText("Code generation");
  await expect(page.locator(".workflowStage").nth(1)).toContainText("Model rendering");
  await expect(page.locator(".workflowStage").nth(2)).toContainText("Model review");
  await expect(page.locator(".workflowStage").nth(0)).toContainText("Complete");
  await expect(page.locator(".workflowStage").nth(1)).toContainText("Complete");
  await expect(page.locator(".workflowStage").nth(2)).toContainText("Complete");
  await expect(page.locator(".topbarActions")).toHaveCount(0);
  await expect(page.locator(".projectTools").getByText("Project files")).toBeVisible();
  await expect(page.locator(".agentComposer").getByText("Draft preview uses low precision")).toBeVisible();
  await expect(page.locator(".agentComposer textarea")).toHaveCount(1);
  await expect(page.locator(".agentRun").getByText("User request")).toBeVisible();
  await expect(page.locator(".modelHistory")).toContainText("Models");
  await expect(page.locator(".modelHistory button")).toHaveCount(1);
  await expect(page.locator(".resultPanel").getByRole("button", { name: /STL/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Final Export/i })).toBeVisible();
  await expect(page.getByText("LLM tokens")).toHaveCount(0);
  await expect(page.getByText("Vision tokens")).toHaveCount(0);
  await expect(page.locator(".controlPanel .status")).toHaveCount(0);
  await expect(page.locator(".resultPanel .outputBlock")).toHaveCount(0);
  await expect(page.locator(".resultPanel")).not.toContainText("Compiler");
  await expect(page.locator(".resultPanel")).not.toContainText("Review");
  await expect(page.locator(".resultPanel")).not.toContainText("History");
  await expect(page.locator(".agentRun").getByText("AI Prompt Trace")).toHaveCount(0);
  await expect(page.locator(".agentRun").getByText("User request")).toBeVisible();
  await expect(page.locator(".agentRun").getByText("Generated OpenSCAD code")).toBeVisible();
  await expect(page.locator(".agentRun").getByText("Render started")).toBeVisible();
  await expect(page.locator(".agentRun").getByText("Render finished")).toBeVisible();
  await expectTimelineOrder(page, [
    "User request",
    "Generated OpenSCAD code",
    "Render started",
    "Render finished"
  ]);
  const chatCode = page.locator(".chatCodeDisclosure").first();
  await expect(chatCode).toBeVisible();
  await expect(chatCode).not.toHaveAttribute("open", "");
  if (RUN_SCREENSHOT_ASSERTIONS) {
    await expect(chatCode).toHaveScreenshot("chat-code-collapsed.png", {
      animations: "disabled",
      maxDiffPixelRatio: WORKBENCH_SCREENSHOT_DIFF_RATIO
    });
  }
  const chatCodeToggle = chatCode.getByRole("button", { name: /OpenSCAD/i });
  await expect(chatCodeToggle).toBeVisible();
  await chatCodeToggle.focus();
  await expect(chatCodeToggle).toBeFocused();
  await expect(page.locator(".agentCodePreview")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(chatCode).toHaveAttribute("open", "");
  await expect(chatCode.locator(".agentCodePreview")).toContainText("module cup");
  if (RUN_SCREENSHOT_ASSERTIONS) {
    await expect(chatCode).toHaveScreenshot("chat-code-expanded.png", {
      animations: "disabled",
      maxDiffPixelRatio: WORKBENCH_SCREENSHOT_DIFF_RATIO
    });
  }
  await page.keyboard.press("Enter");
  await expect(chatCode).not.toHaveAttribute("open", "");
  await expect(page.locator(".resultPanel").getByText("AI Prompt Trace")).toHaveCount(0);
  await expect(page.locator(".sidebarSettings")).toHaveAttribute("open", "");
  await expect(page.locator(".controlPanel .modelHistory")).toBeVisible();
  await expectLeftPanelOrder(page);
  await expectLeftPanelVisualStack(page);
  await page.locator(".sidebarSettings summary").click();
  await expect(page.locator(".controlPanel").getByText("LLM API Key")).toBeHidden();
  await page.locator(".sidebarSettings summary").click();
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
  const inviteImageRatio = qrBox!.width / qrBox!.height;
  const naturalInviteRatio = INVITE_IMAGE_NATURAL_WIDTH / INVITE_IMAGE_NATURAL_HEIGHT;
  const inviteImageDisplayWidth = INVITE_IMAGE_NATURAL_WIDTH * INVITE_IMAGE_DISPLAY_SCALE;
  expect(inviteBox!.x).toBeGreaterThanOrEqual(helpBox!.x);
  expect(inviteBox?.width).toBeGreaterThanOrEqual(inviteImageDisplayWidth);
  expect(qrBox?.width).toBeGreaterThanOrEqual(inviteImageDisplayWidth);
  expect(qrBox?.width).toBeLessThanOrEqual(inviteImageDisplayWidth);
  expect(inviteImageRatio).toBeCloseTo(naturalInviteRatio, 2);
  await page.mouse.move(900, 40);

  const controlBox = await page.locator(".controlPanel").boundingBox();
  const codeBox = await page.locator(".codePanel").boundingBox();
  const composerBox = await page.locator(".agentComposer").boundingBox();
  const resultBox = await page.locator(".resultPanel").boundingBox();
  const viewGridBox = await page.locator(".viewGrid").boundingBox();
  const lastActionBox = await page
    .getByRole("button", { name: /Final Export/i })
    .boundingBox();

  expect(controlBox).not.toBeNull();
  expect(codeBox).not.toBeNull();
  expect(composerBox).not.toBeNull();
  expect(resultBox).not.toBeNull();
  expect(viewGridBox).not.toBeNull();
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
  expect(viewGridBox!.height).toBeGreaterThanOrEqual(resultBox!.height * 0.5);
  await expect(page.locator(".viewTile")).toHaveCount(14);
  await expect(page.locator(".viewTile figcaption")).toHaveText(viewNames);
  const preview = interactivePreview(page);
  await expect(preview).toBeVisible();
  await expectPreviewHasModelPixels(page);
  await expectPreviewDoesNotTrapKeyboardFocus(page);
  const previewBox = await expectInteractivePreviewIsOnlyLargeView(page);
  const fixedViewSourcesBeforeDrag = await page.locator(".viewTile img").evaluateAll((images) =>
    images.map((image) => (image as HTMLImageElement).src)
  );
  const previewDataUrlBeforeDrag = await (await previewCanvas(page)).evaluate((canvas) =>
    (canvas as HTMLCanvasElement).toDataURL("image/png")
  );
  await dragInteractivePreview(page);
  await expect
    .poll(async () => (await previewCanvas(page)).evaluate((canvas) =>
      (canvas as HTMLCanvasElement).toDataURL("image/png")
    ))
    .not.toBe(previewDataUrlBeforeDrag);
  const fixedViewSourcesAfterDrag = await page.locator(".viewTile img").evaluateAll((images) =>
    images.map((image) => (image as HTMLImageElement).src)
  );
  expect(fixedViewSourcesAfterDrag).toEqual(fixedViewSourcesBeforeDrag);
  const resultPanelMetrics = await page.locator(".resultPanel").evaluate((element) => ({
    clientHeight: element.clientHeight,
    clientWidth: element.clientWidth,
    scrollHeight: element.scrollHeight,
    scrollWidth: element.scrollWidth
  }));
  expect(resultPanelMetrics.scrollHeight).toBeGreaterThan(resultPanelMetrics.clientHeight);
  expect(resultPanelMetrics.scrollWidth).toBeLessThanOrEqual(resultPanelMetrics.clientWidth);
  expect(previewBox!.height + viewGridBox!.height).toBeGreaterThan(
    resultBox!.height * 0.5
  );
  const labelMetrics = await page.locator(".viewTile figcaption").evaluateAll((labels) =>
    labels.map((label) => ({
      clientWidth: label.clientWidth,
      scrollWidth: label.scrollWidth
    }))
  );
  for (const metrics of labelMetrics) {
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  }
  await expectFourteenViewPanelTextFits(page);

  await page.locator(".controlPanel").getByRole("button", { name: "New model" }).focus();
  const focusedPanels: string[] = [];
  for (let index = 0; index < 30; index += 1) {
    focusedPanels.push(
      await page.evaluate(() => {
        const active = document.activeElement;
        if (!active) {
          return "";
        }
        if (active.closest(".controlPanel")) {
          return "controlPanel";
        }
        if (active.closest(".codePanel")) {
          return "codePanel";
        }
        if (active.closest(".resultPanel")) {
          return "resultPanel";
        }
        return "";
      })
    );
    if (focusedPanels.includes("resultPanel")) {
      break;
    }
    await page.keyboard.press("Tab");
  }
  expect(focusedPanels.indexOf("controlPanel")).toBeGreaterThanOrEqual(0);
  expect(focusedPanels.indexOf("codePanel")).toBeGreaterThan(
    focusedPanels.indexOf("controlPanel")
  );
  expect(focusedPanels.indexOf("resultPanel")).toBeGreaterThan(
    focusedPanels.indexOf("codePanel")
  );

  if (RUN_SCREENSHOT_ASSERTIONS) {
    await page.locator(".resultPanel").evaluate((panel) => {
      panel.scrollTop = 0;
    });
    await expect(page.locator(".workspace")).toHaveScreenshot("desktop-workbench.png", {
      animations: "disabled",
      maxDiffPixelRatio: WORKBENCH_SCREENSHOT_DIFF_RATIO
    });
  }

  await page.locator(".controlPanel").getByRole("button", { name: "New model" }).click();
  await expect(page.locator(".modelHistory button")).toHaveCount(2);
  await expectLeftPanelOrder(page);
  await expectLeftPanelVisualStack(page);
  await expect(page.locator(".agentInput")).toHaveValue("");
  await page.locator(".modelHistory button", { hasText: "生成一个30ML的杯子模型" }).click();
  await expect(page.locator(".agentInput")).toHaveValue("生成一个30ML的杯子模型");
});

test("empty task keeps the Agent Run surface without a thinking placeholder", async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.project", JSON.stringify(storedProject));
  }, emptyProject);

  await page.goto("/");

  const agentRun = page.locator(".agentRun");
  const agentRunBox = await agentRun.boundingBox();
  const headerBox = await agentRun.getByRole("heading", { name: "Agent Run" }).boundingBox();
  const timelineBox = await page.locator(".agentTimeline").boundingBox();

  await expect(agentRun.getByRole("heading", { name: "Agent Run" })).toBeVisible();
  await expect(page.locator(".agentTimeline")).toBeVisible();
  await expect(page.locator(".agentTimeline .agentEvent")).toHaveCount(0);
  await expect(interactivePreview(page)).toBeVisible();
  await expect(agentRun.getByRole("heading", { name: "Agent Thinking" })).toHaveCount(0);
  await expect(agentRun).not.toContainText("Generate, compile, or review to see prompts here.");
  expect(agentRunBox).not.toBeNull();
  expect(headerBox).not.toBeNull();
  expect(timelineBox).not.toBeNull();
  expect(headerBox!.y - agentRunBox!.y).toBeLessThanOrEqual(20);
  expect(headerBox!.y).toBeLessThan(timelineBox!.y);

  if (RUN_SCREENSHOT_ASSERTIONS) {
    await expect(page).toHaveScreenshot("empty-agent-run.png", {
      animations: "disabled",
      clip: {
        x: Math.round(agentRunBox!.x),
        y: Math.round(agentRunBox!.y),
        width: Math.round(agentRunBox!.width),
        height: 398
      },
      maxDiffPixelRatio: WORKBENCH_SCREENSHOT_DIFF_RATIO
    });
  }
});

test("reference image action opens a compact multi-image picker", async ({
  page
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 920 });
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.vision-api-key", "sk-vision");
    localStorage.setItem("ai-openscad.project", JSON.stringify(storedProject));
  }, emptyProject);

  let visionRequests = 0;
  let releaseVision = () => {};
  let visionStarted = () => {};
  const visionStartedPromise = new Promise<void>((resolve) => {
    visionStarted = resolve;
  });
  const releaseVisionPromise = new Promise<void>((resolve) => {
    releaseVision = resolve;
  });
  await page.route("**/api/vision", async (route) => {
    visionRequests += 1;
    const payload = JSON.stringify(route.request().postDataJSON());
    expect(payload).toContain(pixel.split(",")[1]);
    expect(payload).toContain("target model prompt");
    expect(payload).not.toContain("front-reference.png");
    expect(payload).not.toContain("side-reference.png");
    visionStarted();
    await releaseVisionPromise;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        content: JSON.stringify({
          prompt: "A compact printable reference-image prompt."
        })
      })
    });
  });

  await page.goto("/");

  const describeButton = page.getByRole("button", { name: "Describe reference images" });
  await expect(describeButton).toBeVisible();
  await expect(describeButton).toBeEnabled();
  await expect(page.getByRole("button", { name: "Clear reference images" })).toHaveCount(0);
  await expect(page.getByText("front-reference.png")).toHaveCount(0);

  const canceledChooserPromise = page.waitForEvent("filechooser");
  await describeButton.click();
  const canceledChooser = await canceledChooserPromise;
  expect(canceledChooser.isMultiple()).toBe(true);
  await canceledChooser.setFiles([]);
  await delay(300);
  expect(visionRequests).toBe(0);
  await expect(describeButton).toBeEnabled();

  const chooserPromise = page.waitForEvent("filechooser");
  await describeButton.click();
  const chooser = await chooserPromise;
  expect(chooser.isMultiple()).toBe(true);
  await chooser.setFiles([
    referenceImageFile("front-reference.png"),
    referenceImageFile("side-reference.png")
  ]);
  await visionStartedPromise;
  await expect(page.getByText("front-reference.png")).toHaveCount(0);
  await expect(page.getByText("side-reference.png")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Remove front-reference\.png/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Clear reference images" })).toHaveCount(0);
  await expect(describeButton).toBeDisabled();

  const pageWidthWithImages = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(pageWidthWithImages.scrollWidth).toBeLessThanOrEqual(pageWidthWithImages.clientWidth);
  await page.locator(".agentComposer").screenshot({
    path: testInfo.outputPath("reference-image-composer-narrow.png")
  });

  releaseVision();
  await expect(page.locator(".agentInput")).toHaveValue(
    "A compact printable reference-image prompt.",
    { timeout: 30_000 }
  );
  expect(visionRequests).toBe(1);
  await expect(describeButton).toBeEnabled();
  await expect(page.getByText("front-reference.png")).toHaveCount(0);
  await expect(page.getByText("side-reference.png")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Clear reference images" })).toHaveCount(0);
});

test("invalid STL keeps a labelled preview and leaves the workbench usable", async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.llm-api-key", "sk-llm");
    localStorage.setItem("ai-openscad.vision-api-key", "sk-vision");
    localStorage.setItem("ai-openscad.project", JSON.stringify(storedProject));
  }, invalidStlProject);

  await page.goto("/");

  await expect(interactivePreview(page)).toBeVisible();
  await expect(page.locator(".viewTile img")).toHaveCount(14);
  await expect(
    page.locator(".resultPanel").getByRole("button", { name: "Source SCAD", exact: true })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Review$/i })).toBeVisible();
  await expect(page.locator(".agentRun").getByText("User request")).toBeVisible();
});

test("model history scrolls internally below setup controls", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await addStoredProjects(page, 14);

  await page.goto("/");

  const listMetrics = await page.locator(".modelList").evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight
  }));

  await expectLeftPanelOrder(page);
  await expectLeftPanelVisualStack(page);
  expect(listMetrics.scrollHeight).toBeGreaterThan(listMetrics.clientHeight);
});

test("auto iteration settings clamp persisted high out-of-range values", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.project", JSON.stringify(storedProject));
    localStorage.setItem("ai-openscad.target-confidence-percent", "250");
    localStorage.setItem("ai-openscad.auto-iteration-limit", "99");
  }, emptyProject);

  await page.goto("/");

  await expectAutoIterationControls(page, "100", "5");
});

test("auto iteration settings clamp persisted low and invalid values", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.project", JSON.stringify(storedProject));
    localStorage.setItem("ai-openscad.target-confidence-percent", "-20");
    localStorage.setItem("ai-openscad.auto-iteration-limit", "not-a-number");
  }, emptyProject);

  await page.goto("/");

  await expectAutoIterationControls(page, "1", "0");
});

test("auto iteration settings update from keyboard input", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.project", JSON.stringify(storedProject));
  }, emptyProject);

  await page.goto("/");

  const targetConfidence = page.getByLabel("Target confidence");
  const autoIterations = page.getByLabel("Auto iterations");
  await expectAutoIterationControls(page);
  await targetConfidence.focus();
  await page.keyboard.press("ArrowRight");
  await expect(targetConfidence).toHaveValue("86");
  await page.keyboard.press("ArrowLeft");
  await expect(targetConfidence).toHaveValue("85");

  await autoIterations.focus();
  await page.keyboard.press("ArrowUp");
  await expect(autoIterations).toHaveValue("1");
  await page.keyboard.press("ArrowDown");
  await expect(autoIterations).toHaveValue("0");
});

test("stacked layout keeps setup controls before model actions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await addStoredProjects(page, 14);

  await page.goto("/");

  const listMetrics = await page.locator(".modelList").evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight
  }));
  const pageWidth = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));

  await expectLeftPanelOrder(page);
  await expectLeftPanelVisualStack(page);
  await expectStackedFocusOrder(page);
  expect(listMetrics.scrollHeight).toBeGreaterThan(listMetrics.clientHeight);
  expect(pageWidth.scrollWidth).toBeLessThanOrEqual(pageWidth.clientWidth);

  const helpButton = page.getByRole("button", { name: "No key?" }).first();
  await helpButton.hover();
  const inviteTooltip = page.locator(".keyHelpTooltip").filter({ hasText: "QRU857" }).first();
  await expect(inviteTooltip).toBeVisible();
  const tooltipBox = await inviteTooltip.boundingBox();
  const viewport = page.viewportSize();
  const pageWidthWithTooltip = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(tooltipBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(tooltipBox!.x).toBeGreaterThanOrEqual(0);
  expect(tooltipBox!.x + tooltipBox!.width).toBeLessThanOrEqual(viewport!.width);
  expect(pageWidthWithTooltip.scrollWidth).toBeLessThanOrEqual(
    pageWidthWithTooltip.clientWidth
  );
  await page.mouse.move(0, 0);

  await page.locator(".resultPanel").scrollIntoViewIfNeeded();
  await expectFourteenViewPanelTextFits(page);
  await expectInteractivePreviewIsOnlyLargeView(page);
  await expectNoHorizontalPageOverflow(page);

  await page.locator(".agentRun").scrollIntoViewIfNeeded();
  const stackedChatCode = page.locator(".chatCodeDisclosure").first();
  await expect(stackedChatCode).toBeVisible();
  await expect(stackedChatCode).not.toHaveAttribute("open", "");

  if (RUN_SCREENSHOT_ASSERTIONS) {
    await expect(page).toHaveScreenshot("stacked-workbench.png", {
      animations: "disabled",
      clip: { x: 0, y: 0, width: 390, height: 900 },
      maxDiffPixelRatio: WORKBENCH_SCREENSHOT_DIFF_RATIO
    });
  }
});
