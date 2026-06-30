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
  stl: "solid ui-test\nendsolid ui-test",
  views: renderedViews,
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
  const stlButton = page.locator(".resultPanel").getByRole("button", { name: /STL/i });
  await stlButton.scrollIntoViewIfNeeded();
  await expect(stlButton).toBeVisible();
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
  const frontBox = await page.locator(".viewTile").first().boundingBox();
  expect(frontBox).not.toBeNull();
  for (let index = 1; index < 14; index += 1) {
    const supportingBox = await page.locator(".viewTile").nth(index).boundingBox();
    expect(supportingBox).not.toBeNull();
    expect(frontBox!.width * frontBox!.height).toBeGreaterThan(
      supportingBox!.width * supportingBox!.height
    );
    expect(supportingBox!.y).toBeGreaterThan(frontBox!.y);
  }
  const resultPanelMetrics = await page.locator(".resultPanel").evaluate((element) => ({
    clientHeight: element.clientHeight,
    clientWidth: element.clientWidth,
    scrollHeight: element.scrollHeight,
    scrollWidth: element.scrollWidth
  }));
  expect(resultPanelMetrics.scrollHeight).toBeGreaterThan(resultPanelMetrics.clientHeight);
  expect(resultPanelMetrics.scrollWidth).toBeLessThanOrEqual(resultPanelMetrics.clientWidth);
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
