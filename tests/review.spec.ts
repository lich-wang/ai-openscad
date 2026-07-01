import { expect, test, type Locator, type Page } from "@playwright/test";

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
const viewFileNames = [
  "front",
  "back",
  "left",
  "right",
  "top",
  "bottom",
  "iso-front-right-top",
  "iso-front-left-top",
  "iso-back-right-top",
  "iso-back-left-top",
  "iso-front-right-bottom",
  "iso-front-left-bottom",
  "iso-back-right-bottom",
  "iso-back-left-bottom"
];
const viewDataUrls = Object.fromEntries(
  viewKeys.map((key) => [key, `data:image/png;base64,${key}-view`])
) as Record<(typeof viewKeys)[number], string>;
const emptyViews = Object.fromEntries(viewKeys.map((key) => [key, ""])) as Record<
  (typeof viewKeys)[number],
  string
>;
const pixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP8z8AARQAFAAH/AnH9zAAAAABJRU5ErkJggg==";
const referenceImagePayload = pixel.split(",")[1];

const project = {
  id: "project-review-test",
  title: "Review Test",
  requirement: "生成一个30ML的杯子模型",
  originalRequirement: "生成一个30ML的杯子模型",
  codeModelId: "mimo-v2.5",
  visionModelId: "mimo-v2.5",
  currentCode: "module cup() { difference() { cylinder(h=40, r=18); cylinder(h=38, r=15); } } cup();",
  proposedCode: "",
  compilerOutput: "Compiled to STL in browser.",
  review: null,
  stl: "",
  views: {
    ...viewDataUrls
  },
  renderEvidence: {
    compileStatus: "success",
    diagnostics: "Compiled draft preview.",
    renderPrecision: "draft",
    backend: "web-manifold",
    viewCount: 14
  },
  iterations: [],
  runEvents: [],
  updatedAt: "2026-06-26T00:00:00.000Z"
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sseChunks(text: string): string {
  return [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}`,
    "",
    "data: [DONE]",
    ""
  ].join("\n");
}

function referenceImageFile(name: string) {
  return {
    name,
    mimeType: "image/png",
    buffer: Buffer.from(pixel.split(",")[1], "base64")
  };
}

async function chooseReferenceImages(
  page: Page,
  files: ReturnType<typeof referenceImageFile>[]
) {
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /^Reference images$/ }).click();
  const chooser = await chooserPromise;
  expect(chooser.isMultiple()).toBe(true);
  await chooser.setFiles(files);
}

async function cancelReferenceImageSelection(page: Page) {
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /^Reference images$/ }).click();
  const chooser = await chooserPromise;
  expect(chooser.isMultiple()).toBe(true);
  await chooser.setFiles([]);
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

async function expectRenderedViewsHaveModelPixels(page: Page) {
  const paintedPixelCounts = await page.locator(".viewTile img").evaluateAll(async (images) =>
    Promise.all(
      images.map(
        (node) =>
          new Promise<number>((resolve, reject) => {
            const image = node as HTMLImageElement;
            const inspect = () => {
              const canvas = document.createElement("canvas");
              canvas.width = image.naturalWidth;
              canvas.height = image.naturalHeight;
              const context = canvas.getContext("2d");
              if (!context) {
                reject(new Error("Canvas context unavailable"));
                return;
              }
              context.drawImage(image, 0, 0);
              const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
              let painted = 0;
              for (let y = 0; y < canvas.height; y += 12) {
                for (let x = 0; x < canvas.width; x += 12) {
                  const index = (y * canvas.width + x) * 4;
                  const r = data[index];
                  const g = data[index + 1];
                  const b = data[index + 2];
                  const alpha = data[index + 3];
                  const isBackground =
                    Math.abs(r - 248) < 4 && Math.abs(g - 250) < 4 && Math.abs(b - 252) < 4;
                  if (alpha > 0 && !isBackground) {
                    painted += 1;
                  }
                }
              }
              resolve(painted);
            };
            if (image.complete && image.naturalWidth > 0) {
              inspect();
            } else {
              image.onload = inspect;
              image.onerror = () => reject(new Error("Rendered view image failed to load"));
            }
          })
      )
    )
  );

  expect(paintedPixelCounts).toHaveLength(14);
  for (const count of paintedPixelCounts) {
    expect(count).toBeGreaterThan(2);
  }
}

function imageUrlsFromVisionContent(content: unknown): string[] {
  if (!Array.isArray(content)) {
    return [];
  }
  return content
    .filter((part): part is { type: "image_url"; image_url: { url: string } } =>
      Boolean(
        part &&
          typeof part === "object" &&
          "type" in part &&
          part.type === "image_url" &&
          "image_url" in part
      )
    )
    .map((part) => part.image_url.url);
}

async function dragInteractivePreview(page: Page) {
  const preview = page.locator('[aria-label="Interactive STL preview"]').first();
  await expect(preview).toBeVisible();
  const isCanvas = await preview.evaluate((element) => element instanceof HTMLCanvasElement);
  const canvas = isCanvas ? preview : preview.locator("canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * 0.7, box!.y + box!.height * 0.52);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.32, box!.y + box!.height * 0.42, {
    steps: 8
  });
  await page.mouse.up();
}

async function setNumericControl(locator: Locator, value: string) {
  await locator.evaluate((node, nextValue) => {
    const input = node as HTMLInputElement;
    input.value = nextValue as string;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function configureBoundedAutoRun(
  page: Page,
  options: { autoIterations: number; targetConfidence?: number }
) {
  const targetConfidence = page.getByLabel("Target confidence");
  const autoIterations = page.getByLabel("Auto iterations");
  await expect(targetConfidence).toBeVisible();
  await expect(autoIterations).toBeVisible();
  if (options.targetConfidence !== undefined) {
    await setNumericControl(targetConfidence, String(options.targetConfidence));
    await expect(targetConfidence).toHaveValue(String(options.targetConfidence));
  }
  await setNumericControl(autoIterations, String(options.autoIterations));
  await expect(autoIterations).toHaveValue(String(options.autoIterations));
}

async function expectButtonAbsentOrDisabled(page: Page, name: RegExp) {
  const button = page.getByRole("button", { name });
  if ((await button.count()) > 0) {
    await expect(button.first()).toBeDisabled();
  }
}

async function expectCompilerRepairInFlight(page: Page) {
  await expect(page.locator('.workflowStage[data-stage="code"]')).toContainText("Active");
  await expect(page.locator('.workflowStage[data-stage="render"]')).toContainText("Waiting");
  await expect(page.locator('.workflowStage[data-stage="review"]')).toContainText("Waiting");
  await expect(page.locator(".agentRun")).toContainText(/Compiler repair 1 of 2/i);
  await expect(page.getByRole("button", { name: /^Review$/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Final Export/i })).toHaveCount(0);
  const rerenderButton = page.getByRole("button", { name: /^Rerender$/i });
  if ((await rerenderButton.count()) > 0) {
    await expect(rerenderButton).toBeDisabled();
  }
}

test("review sends MiMo multimodal model and shows editable correction prompt", async ({
  page
}) => {
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.llm-api-key", "sk-llm");
    localStorage.setItem("ai-openscad.vision-api-key", "sk-vision");
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        requirement: "保持30ML杯子容量，增加杯口圆角倒角。",
        originalRequirement: "生成一个30ML的杯子模型"
      })
    );
  }, project);

  let visionModel = "";
  let llmRequests = 0;

  await page.route("**/api/vision", async (route) => {
    const body = route.request().postDataJSON() as {
      model: string;
      messages: Array<{ content: unknown }>;
    };
    visionModel = body.model;
    const userMessage = JSON.stringify(body.messages[1].content);
    const imageUrls = imageUrlsFromVisionContent(body.messages[1].content);
    expect(userMessage).toContain("image_url");
    expect(imageUrls).toEqual(viewKeys.map((key) => viewDataUrls[key]));
    expect(userMessage).toContain("生成一个30ML的杯子模型");
    expect(userMessage).not.toContain("增加杯口圆角倒角");
    await delay(250);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        content: JSON.stringify({
          summary: "杯子主体正确，但杯口需要更圆滑。",
          issues: ["杯口倒角不明显"],
          correctionPrompt:
            "保持30ML杯子容量，修改当前OpenSCAD：增加杯口圆角倒角，并让杯壁更薄。",
          confidence: 0.86
        })
      })
    });
  });

  await page.route("**/api/llm", async (route) => {
    llmRequests += 1;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "LLM should not run during visual review" })
    });
  });

  await page.goto("/");
  const reviewButton = page.getByRole("button", { name: /^Review$/i });
  await reviewButton.click();
  await expect(reviewButton).toBeDisabled();
  await expect(page.locator('.workflowStage[data-stage="review"]')).toContainText("Active");

  await expect(page.getByRole("heading", { name: "Proposed Revision" })).toHaveCount(0);
  await expect(page.locator(".agentRun").getByText("Vision review complete.")).toBeVisible();
  await expect(page.locator('.workflowStage[data-stage="review"]')).toContainText("Complete");
  await expect(page.locator(".agentRun")).toContainText("Confidence 86%");
  await expect(page.locator(".controlPanel .status")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Iterate Again/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Final Export/i })).toBeVisible();
  await expect(page.locator(".topbarActions")).toHaveCount(0);
  await expect(page.locator(".projectTools button").last()).toBeEnabled();
  await expect(page.locator(".resultPanel").getByText("杯子主体正确", { exact: false })).toHaveCount(0);
  await expect(
    page.locator(".agentEvent", { has: page.getByRole("heading", { name: "Visual Review" }) })
      .getByText("杯子主体正确", { exact: false })
  ).toBeVisible();
  await expect(page.locator(".resultPanel .outputBlock")).toHaveCount(0);
  await expect(page.locator(".agentInput")).toHaveValue(/增加杯口圆角倒角/);
  const storedAfterReview = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("ai-openscad.project") ?? "{}")
  );
  expect(storedAfterReview.originalRequirement).toBe("生成一个30ML的杯子模型");
  expect(storedAfterReview.requirement).toContain("增加杯口圆角倒角");
  await expect(
    page.locator(".agentRun .correctionPromptPreview").getByText("保持30ML杯子容量", {
      exact: false
    })
  ).toBeVisible();
  await expect(
    page.locator(".agentRun").getByText(
      "保持30ML杯子容量，修改当前OpenSCAD：增加杯口圆角倒角，并让杯壁更薄。",
      { exact: true }
    )
  ).toHaveCount(1);
  await expect(page.locator(".agentRun .correctionPromptPreview")).toHaveCount(1);
  expect(visionModel).toBe("mimo-v2.5");
  expect(llmRequests).toBe(0);
});

test("oversized fourteen-view payload fails before vision and keeps retry controls", async ({
  page
}) => {
  const oversizedViews = Object.fromEntries(
    viewKeys.map((key) => [key, `data:image/png;base64,${"A".repeat(600_000)}`])
  ) as Record<(typeof viewKeys)[number], string>;
  const oversizedProject = {
    ...project,
    views: oversizedViews,
    renderEvidence: {
      compileStatus: "success",
      diagnostics: "Fourteen oversized PNG views.",
      renderPrecision: "draft",
      backend: "web-manifold",
      viewCount: 14
    },
    review: null,
    promptTrace: []
  };
  await page.addInitScript(() => {
    localStorage.setItem("ai-openscad.vision-api-key", "sk-vision");
  });

  let visionRequests = 0;
  await page.route("**/api/vision", async (route) => {
    visionRequests += 1;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Vision should not receive oversized payloads" })
    });
  });

  await page.goto("/");
  await page.locator(".projectTools input[type='file']").setInputFiles({
    name: "oversized-fourteen-view-project.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(oversizedProject))
  });
  await expect(page.locator(".viewTile img")).toHaveCount(14);
  const reviewButton = page.getByRole("button", { name: /^Review$/i });
  await expect(reviewButton).toBeEnabled();

  await reviewButton.click();

  await expect(page.locator('.workflowStage[data-stage="review"]')).toContainText("Error", {
    timeout: 30_000
  });
  await expect(page.locator(".agentRun")).toContainText(/vision payload/i);
  await expect(reviewButton).toBeEnabled();
  await expect(page.getByRole("button", { name: /^Rerender$/i })).toBeEnabled();
  expect(visionRequests).toBe(0);
});

test("reference images draft an editable requirement before generation", async ({
  page
}, testInfo) => {
  test.setTimeout(75_000);
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.llm-api-key", "sk-llm");
    localStorage.setItem("ai-openscad.vision-api-key", "sk-vision");
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        requirement: "旧的杯子需求",
        originalRequirement: "旧的杯子需求",
        currentCode: "cube(10);",
        proposedCode: "",
        stl: "solid stale\nendsolid stale",
        renderEvidence: {
          compileStatus: "success",
          diagnostics: "Compiled stale draft.",
          renderPrecision: "draft",
          backend: "web-manifold",
          viewCount: 14
        },
        review: {
          summary: "旧评审",
          issues: ["旧问题"],
          correctionPrompt: "旧修正提示词",
          confidence: 0.7
        },
        promptTrace: [
          {
            id: "stale-trace",
            createdAt: "2026-06-25T00:00:00.000Z",
            phase: "code-generation",
            modelId: "mimo-v2.5",
            systemPrompt: "OLD_TRACE_SYSTEM_SECRET",
            userPrompt: "OLD_TRACE_USER_SECRET",
            response: "OLD_TRACE_RESPONSE_SECRET"
          }
        ]
      })
    );
  }, project);

  let visionRequests = 0;
  let llmRequests = 0;
  let visionPayload = "";
  let generationPayload = "";
  await page.route("**/api/vision", async (route) => {
    visionRequests += 1;
    const body = route.request().postDataJSON() as {
      messages: Array<{ content: unknown }>;
    };
    visionPayload = JSON.stringify(body.messages[1].content);
    expect(imageUrlsFromVisionContent(body.messages[1].content)).toHaveLength(2);
    expect(visionPayload).toContain(referenceImagePayload);
    expect(visionPayload).toContain("target model prompt");
    expect(visionPayload).not.toContain("reference-front.png");
    expect(visionPayload).not.toContain("reference-side.png");
    expect(visionPayload).not.toContain("cube(10)");
    expect(visionPayload).not.toContain("Compiled stale draft");
    expect(visionPayload).not.toContain("旧评审");
    expect(visionPayload).not.toContain("OLD_TRACE");
    expect(visionPayload).not.toContain("promptTrace");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        content: JSON.stringify({
          prompt:
            "生成一个可3D打印的壁挂杯架，包含圆弧托杯槽、两个沉头螺丝孔和加强筋。"
        })
      })
    });
  });
  await page.route("**/api/llm", async (route) => {
    llmRequests += 1;
    generationPayload = JSON.stringify(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sseChunks("cube(10);")
    });
  });

  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto("/");
  const describeButton = page.getByRole("button", { name: /^Reference images$/ });
  await expect(describeButton).toBeEnabled();
  await expect(page.locator(".referenceImagePanel")).toHaveCount(0);
  await chooseReferenceImages(page, [
    referenceImageFile("reference-front.png"),
    referenceImageFile("reference-side.png")
  ]);
  await expect(page.getByText("reference-front.png")).toHaveCount(0);
  await expect(page.getByText("reference-side.png")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Clear reference images" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Remove reference-front\.png/i })).toHaveCount(0);

  await expect(page.locator(".agentInput")).toHaveValue(/壁挂杯架/, { timeout: 30_000 });
  await expect(page.locator(".agentInput")).toBeEnabled();
  await expect(describeButton).toBeEnabled();
  expect(visionRequests).toBe(1);
  expect(llmRequests).toBe(0);
  await expect(page.locator(".agentRun")).toContainText(/Reference prompt drafted/i);
  await page.locator(".workspace").screenshot({
    path: testInfo.outputPath("reference-image-draft-filled.png")
  });

  const storedAfterDraft = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("ai-openscad.project") ?? "{}")
  );
  expect(storedAfterDraft.requirement).toContain("壁挂杯架");
  expect(storedAfterDraft.originalRequirement).toBe("");
  expect(storedAfterDraft.currentCode).toBe("");
  expect(storedAfterDraft.proposedCode).toBe("");
  expect(storedAfterDraft.review).toBeNull();
  expect(storedAfterDraft.stl).toBe("");
  expect(storedAfterDraft.renderEvidence).toBeNull();
  expect(Object.values(storedAfterDraft.views).every((value) => value === "")).toBe(true);
  const serializedStoredAfterDraft = JSON.stringify(storedAfterDraft);
  expect(serializedStoredAfterDraft).not.toContain("reference-front");
  expect(serializedStoredAfterDraft).not.toContain("data:image/png;base64");
  expect(serializedStoredAfterDraft).not.toContain(referenceImagePayload);
  expect(serializedStoredAfterDraft).not.toContain("blob:");
  expect(serializedStoredAfterDraft).not.toContain("referenceImages");
  expect(storedAfterDraft.promptTrace.at(-1)).toMatchObject({
    phase: "reference-image-draft",
    response: expect.stringContaining("壁挂杯架")
  });
  const latestTrace = JSON.stringify(storedAfterDraft.promptTrace.at(-1));
  expect(latestTrace).not.toContain("data:image");
  expect(latestTrace).not.toContain(referenceImagePayload);
  expect(latestTrace).not.toContain("blob:");
  expect(latestTrace).not.toContain("referenceImages");
  await page.evaluate(() => {
    (window as typeof window & {
      __exportedProject?: { filename: string; content: string };
    }).__exportedProject = undefined;
    const originalCreateObjectUrl = URL.createObjectURL.bind(URL);
    const blobTextByUrl: Record<string, Promise<string>> = {};
    URL.createObjectURL = ((blob: Blob | MediaSource) => {
      const url = originalCreateObjectUrl(blob);
      if (blob instanceof Blob) {
        blobTextByUrl[url] = blob.text();
      }
      return url;
    }) as typeof URL.createObjectURL;
    HTMLAnchorElement.prototype.click = function captureProjectExport() {
      const blobText = blobTextByUrl[this.href];
      if (!blobText) {
        return;
      }
      void blobText.then((content) => {
        (
          window as typeof window & {
            __exportedProject?: { filename: string; content: string };
          }
        ).__exportedProject = { filename: this.download, content };
      });
    };
  });
  await page.locator(".projectTools").getByRole("button", { name: /Export/i }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Boolean(
            (window as typeof window & {
              __exportedProject?: { filename: string; content: string };
            }).__exportedProject
          )
      )
    )
    .toBe(true);
  const exportedProject = await page.evaluate(
    () =>
      (window as typeof window & {
        __exportedProject: { filename: string; content: string };
      }).__exportedProject
  );
  expect(exportedProject.filename).toBe("ai-openscad-project.json");
  expect(exportedProject.content).toContain("壁挂杯架");
  expect(exportedProject.content).not.toContain("reference-front");
  expect(exportedProject.content).not.toContain("reference-side");
  expect(exportedProject.content).not.toContain("data:image");
  expect(exportedProject.content).not.toContain(referenceImagePayload);
  expect(exportedProject.content).not.toContain("blob:");
  expect(exportedProject.content).not.toContain("referenceImages");
  expect(exportedProject.content).not.toContain("solid stale");
  expect(JSON.parse(exportedProject.content)).toMatchObject({
    currentCode: "",
    proposedCode: "",
    review: null,
    stl: "",
    renderEvidence: null
  });

  await page.locator(".agentInput").fill(
    "生成一个可3D打印的壁挂杯架，包含圆弧托杯槽、两个沉头螺丝孔和加强筋，高度80mm。"
  );
  await page.getByRole("button", { name: /^Generate$/i }).click();
  await expect.poll(() => llmRequests, { timeout: 30_000 }).toBe(1);
  expect(generationPayload).toContain("高度80mm");
  expect(generationPayload).toContain("壁挂杯架");
  expect(generationPayload).not.toContain("reference-front");
  expect(generationPayload).not.toContain("data:image");
  expect(generationPayload).not.toContain(referenceImagePayload);
  expect(generationPayload).not.toContain("OLD_TRACE");
});

test("pending revision blocks reference image prompt drafting", async ({ page }) => {
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.vision-api-key", "sk-vision");
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        proposedCode: "sphere(5); // PENDING_PROPOSED_SECRET",
        review: {
          summary: "已有待确认修订",
          issues: ["先确认修订"],
          correctionPrompt: "先接受或拒绝当前修订。",
          confidence: 0.6
        },
        promptTrace: [
          {
            id: "pending-old-trace",
            createdAt: "2026-06-25T00:00:00.000Z",
            phase: "code-generation",
            modelId: "mimo-v2.5",
            systemPrompt: "PENDING_OLD_TRACE_SECRET",
            userPrompt: "pending old trace",
            response: "pending old trace"
          }
        ]
      })
    );
  }, project);

  let visionRequests = 0;
  await page.route("**/api/vision", async (route) => {
    visionRequests += 1;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Vision should not run with a pending revision" })
    });
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Reference images$/ })).toBeDisabled();
  await expect(page.getByText("pending-reference.png")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Clear reference images" })).toHaveCount(0);
  await expect(page.locator(".pendingActionHint")).toBeVisible();
  await delay(500);
  expect(visionRequests).toBe(0);
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("ai-openscad.project") ?? "{}")
  );
  expect(stored.proposedCode).toContain("PENDING_PROPOSED_SECRET");
});

test("late reference image draft responses do not overwrite newer composer state", async ({
  page
}) => {
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.vision-api-key", "sk-vision");
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        requirement: "初始手写需求",
        currentCode: "",
        views: {
          front: "",
          back: "",
          left: "",
          right: "",
          top: "",
          bottom: "",
          isoFrontRightTop: "",
          isoFrontLeftTop: "",
          isoBackRightTop: "",
          isoBackLeftTop: "",
          isoFrontRightBottom: "",
          isoFrontLeftBottom: "",
          isoBackRightBottom: "",
          isoBackLeftBottom: ""
        },
        review: null,
        promptTrace: []
      })
    );
  }, project);

  let releaseFirst = () => {};
  let firstStarted = () => {};
  const firstStartedPromise = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  const releaseFirstPromise = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let visionRequests = 0;
  await page.route("**/api/vision", async (route) => {
    visionRequests += 1;
    if (visionRequests === 1) {
      firstStarted();
      await releaseFirstPromise;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          content: JSON.stringify({
            prompt: "过期响应不应该覆盖用户后续输入。"
          })
        })
      });
      return;
    }
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Unexpected extra reference draft request" })
    });
  });

  await page.goto("/");
  await chooseReferenceImages(page, [
    referenceImageFile("late-reference.png")
  ]);
  await firstStartedPromise;
  await expect(page.getByText("late-reference.png")).toHaveCount(0);
  await page.locator(".agentInput").evaluate((node) => {
    const textarea = node as HTMLTextAreaElement;
    textarea.disabled = false;
    textarea.value = "用户在旧请求返回前写的新需求";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
  });
  releaseFirst();

  await delay(500);
  await expect(page.locator(".agentInput")).toHaveValue("用户在旧请求返回前写的新需求");
  await expect(page.locator(".agentRun")).not.toContainText("过期响应不应该覆盖");
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("ai-openscad.project") ?? "{}")
  );
  expect(stored.requirement).toBe("用户在旧请求返回前写的新需求");
  expect(JSON.stringify(stored.promptTrace ?? [])).not.toContain("过期响应不应该覆盖");
});

test("canceling the reference image picker sends no vision request", async ({ page }) => {
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.vision-api-key", "sk-vision");
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        requirement: "初始手写需求",
        currentCode: "",
        views: {
          front: "",
          back: "",
          left: "",
          right: "",
          top: "",
          bottom: "",
          isoFrontRightTop: "",
          isoFrontLeftTop: "",
          isoBackRightTop: "",
          isoBackLeftTop: "",
          isoFrontRightBottom: "",
          isoFrontLeftBottom: "",
          isoBackRightBottom: "",
          isoBackLeftBottom: ""
        },
        review: null,
        promptTrace: []
      })
    );
  }, project);

  let visionRequests = 0;
  await page.route("**/api/vision", async (route) => {
    visionRequests += 1;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Canceled picker should not call vision" })
    });
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Reference images$/ })).toBeEnabled();
  await cancelReferenceImageSelection(page);

  await delay(500);
  await expect(page.locator(".agentInput")).toHaveValue("初始手写需求");
  await expect(page.locator(".agentRun")).not.toContainText("Canceled picker");
  await expect(page.getByText(/reference\.png/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Clear reference images" })).toHaveCount(0);
  expect(visionRequests).toBe(0);
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("ai-openscad.project") ?? "{}")
  );
  expect(stored.requirement).toBe("初始手写需求");
  expect(JSON.stringify(stored.promptTrace ?? [])).toBe("[]");
});

test("reference image draft failure preserves request-start text without selected images", async ({
  page
}, testInfo) => {
  test.setTimeout(45_000);
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.vision-api-key", "sk-vision");
    const activeProject = {
      ...storedProject,
      requirement: "手写的备用需求",
      review: null,
      promptTrace: []
    };
    const olderProject = {
      ...storedProject,
      id: "project-reference-older",
      title: "Older reference source",
      requirement: "旧历史模型",
      updatedAt: "2026-06-25T00:00:00.000Z"
    };
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify(activeProject)
    );
    localStorage.setItem("ai-openscad.projects", JSON.stringify([activeProject, olderProject]));
    localStorage.setItem("ai-openscad.active-project-id", activeProject.id);
  }, project);

  let releaseVision = () => {};
  let visionStarted = () => {};
  const visionStartedPromise = new Promise<void>((resolve) => {
    visionStarted = resolve;
  });
  const releaseVisionPromise = new Promise<void>((resolve) => {
    releaseVision = resolve;
  });
  let llmRequests = 0;
  await page.route("**/api/vision", async (route) => {
    visionStarted();
    await releaseVisionPromise;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Reference image provider unavailable" })
    });
  });
  await page.route("**/api/llm", async (route) => {
    llmRequests += 1;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "LLM should not run while drafting from images" })
    });
  });

  await page.goto("/");
  await chooseReferenceImages(page, [
    referenceImageFile("failed-front.png"),
    referenceImageFile("failed-side.png")
  ]);
  await visionStartedPromise;

  await expect(page.locator(".agentInput")).toBeDisabled();
  await expect(page.getByText("failed-front.png")).toHaveCount(0);
  await expect(page.getByText("failed-side.png")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Reference images$/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Remove failed-front.png" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove failed-side.png" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Clear reference images" })).toHaveCount(0);
  await expectButtonAbsentOrDisabled(page, /^Generate$/i);
  await expect(page.getByRole("button", { name: /^Review$/i })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Rerender$/i })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Final Export/i })).toBeDisabled();
  await expect(page.locator(".controlPanel").getByRole("button", { name: "New model" })).toBeDisabled();
  await expect(page.locator(".projectTools input[type='file']")).toBeDisabled();
  await expect(page.locator(".projectTools").getByRole("button", { name: /Export/i })).toBeDisabled();
  const historyButtons = page.locator(".modelHistory button");
  await expect(historyButtons).toHaveCount(2);
  for (let index = 0; index < await historyButtons.count(); index += 1) {
    await expect(historyButtons.nth(index)).toBeDisabled();
  }
  await page.locator(".workspace").screenshot({
    path: testInfo.outputPath("reference-image-draft-running.png")
  });

  releaseVision();
  await expect(page.locator(".agentRun").getByRole("alert")).toContainText(
    "Reference image provider unavailable",
    { timeout: 30_000 }
  );
  await expect(page.locator(".agentInput")).toHaveValue("手写的备用需求");
  await expect(page.locator(".agentInput")).toBeEnabled();
  await expect(page.getByText("failed-front.png")).toHaveCount(0);
  await expect(page.getByText("failed-side.png")).toHaveCount(0);
  const storedAfterFailure = await page.evaluate(() =>
    JSON.stringify(JSON.parse(localStorage.getItem("ai-openscad.project") ?? "{}"))
  );
  expect(storedAfterFailure).not.toContain("failed-front.png");
  expect(storedAfterFailure).not.toContain("failed-side.png");
  expect(storedAfterFailure).not.toContain(`data:image/png;base64,${referenceImagePayload}`);
  expect(storedAfterFailure).not.toContain(referenceImagePayload);
  expect(storedAfterFailure).not.toContain("blob:");
  expect(storedAfterFailure).not.toContain("referenceImages");
  await expect(page.getByRole("button", { name: /^Reference images$/ })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Remove failed-front.png" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove failed-side.png" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Clear reference images" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Review$/i })).toBeEnabled();
  await expect(page.getByRole("button", { name: /^Rerender$/i })).toBeEnabled();
  await expect(page.getByRole("button", { name: /Final Export/i })).toBeEnabled();
  await expect(page.locator(".controlPanel").getByRole("button", { name: "New model" })).toBeEnabled();
  await expect(page.locator(".projectTools input[type='file']")).toBeEnabled();
  await expect(page.locator(".projectTools").getByRole("button", { name: /Export/i })).toBeEnabled();
  for (let index = 0; index < await historyButtons.count(); index += 1) {
    await expect(historyButtons.nth(index)).toBeEnabled();
  }
  expect(llmRequests).toBe(0);
  await page.locator(".workspace").screenshot({
    path: testInfo.outputPath("reference-image-draft-failure.png")
  });
  await cancelReferenceImageSelection(page);
  await delay(500);
  await expect(page.locator(".agentInput")).toHaveValue("手写的备用需求");
  await expect(page.getByText("failed-front.png")).toHaveCount(0);
});

test("generation streams code and automatically renders draft views", async ({ page }) => {
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.llm-api-key", "sk-llm");
    localStorage.setItem("ai-openscad.vision-api-key", "sk-vision");
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        currentCode: "",
        originalRequirement: "",
        views: { front: "", back: "", left: "", right: "", top: "", isometric: "" },
        review: null,
        promptTrace: []
      })
    );

  }, project);

  let streamRequested = false;
  let reviewRequirement = "";
  let reviewImageUrls: string[] = [];
  await page.route("**/api/llm", async (route) => {
    const body = route.request().postDataJSON() as { stream?: boolean };
    streamRequested = body.stream === true;
    await delay(250);
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        'data: {"choices":[{"delta":{"content":"cube"}}]}',
        "",
        'data: {"choices":[{"delta":{"content":"(10);"}}]}',
        "",
        "data: [DONE]",
        ""
      ].join("\n")
    });
  });
  await page.route("**/api/vision", async (route) => {
    const body = route.request().postDataJSON() as {
      messages: Array<{ content: unknown }>;
    };
    reviewRequirement = JSON.stringify(body.messages[1].content);
    reviewImageUrls = imageUrlsFromVisionContent(body.messages[1].content);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        content: JSON.stringify({
          summary: "首轮评审完成。",
          issues: ["需要增加杯口倒角"],
          correctionPrompt:
            "保留30ML杯子需求，针对当前OpenSCAD增加杯口倒角并保持杯壁厚度。",
          confidence: 0.8
        })
      })
    });
  });

  await page.goto("/");
  const requestPromise = page.waitForRequest("**/api/llm");
  const generateButton = page.getByRole("button", { name: /^Generate$/i });
  await generateButton.click();
  await expect(generateButton).toBeDisabled();
  await expect(page.locator('.workflowStage[data-stage="code"]')).toContainText("Active");
  await requestPromise;

  await expect(page.locator(".codeEditor").first()).toHaveValue(/cube\(10\);/);
  await expect(page.locator(".agentRun").getByText("Generated OpenSCAD code")).toBeVisible();
  await expect(page.locator('.workflowStage[data-stage="render"]')).toContainText("Active", {
    timeout: 10000
  });
  await expect(page.locator(".agentRun").getByText("Render started")).toBeVisible({
    timeout: 10000
  });
  await expect(page.locator(".viewTile img")).toHaveCount(14, { timeout: 30000 });
  await expect(page.locator(".viewTile figcaption")).toHaveText(viewNames);
  const imageAltText = await page.locator(".viewTile img").evaluateAll((images) =>
    images.map((image) => (image as HTMLImageElement).alt)
  );
  expect(imageAltText).toEqual(viewNames);
  await page.evaluate(() => {
    (window as typeof window & { __downloadNames?: string[] }).__downloadNames = [];
    (
      window as typeof window & {
        __blobTextByUrl?: Record<string, Promise<string>>;
        __downloadBodies?: Array<{ filename: string; content: string }>;
      }
    ).__blobTextByUrl = {};
    (
      window as typeof window & {
        __downloadBodies?: Array<{ filename: string; content: string }>;
      }
    ).__downloadBodies = [];
    const originalCreateObjectUrl = URL.createObjectURL.bind(URL);
    URL.createObjectURL = ((blob: Blob | MediaSource) => {
      const url = originalCreateObjectUrl(blob);
      if (blob instanceof Blob) {
        (
          window as typeof window & { __blobTextByUrl: Record<string, Promise<string>> }
        ).__blobTextByUrl[url] = blob.text();
      }
      return url;
    }) as typeof URL.createObjectURL;
    HTMLAnchorElement.prototype.click = function captureDownloadName() {
      (window as typeof window & { __downloadNames: string[] }).__downloadNames.push(
        this.download
      );
      const blobText = (
        window as typeof window & { __blobTextByUrl: Record<string, Promise<string>> }
      ).__blobTextByUrl[this.href];
      if (blobText) {
        void blobText.then((content) => {
          (
            window as typeof window & {
              __downloadBodies: Array<{ filename: string; content: string }>;
            }
          ).__downloadBodies.push({ filename: this.download, content });
        });
      }
    };
  });
  for (const name of viewNames) {
    const downloadButton = page.getByRole("button", {
      name: `${name} PNG`,
      exact: true
    });
    await expect(downloadButton).toBeVisible();
    await downloadButton.click();
  }
  const sourceScadButton = page.getByRole("button", { name: "Source SCAD", exact: true });
  await expect(sourceScadButton).toBeVisible();
  await sourceScadButton.click();
  const downloadNames = await page.evaluate(
    () => (window as typeof window & { __downloadNames: string[] }).__downloadNames
  );
  expect(downloadNames).toEqual([
    ...viewFileNames.map((name) => `ai-openscad-${name}.png`),
    "ai-openscad-source.scad"
  ]);
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const bodies = (
            window as typeof window & {
              __downloadBodies?: Array<{ filename: string; content: string }>;
            }
          ).__downloadBodies ?? [];
          return bodies.filter((body) => body.filename === "ai-openscad-source.scad").length;
        })
    )
    .toBe(1);
  const sourceDownloadBody = await page.evaluate(() => {
    const bodies = (
      window as typeof window & {
        __downloadBodies: Array<{ filename: string; content: string }>;
      }
    ).__downloadBodies;
    return bodies.find((body) => body.filename === "ai-openscad-source.scad")?.content ?? "";
  });
  expect(sourceDownloadBody.trim()).toBe("cube(10);");
  expect(sourceDownloadBody).not.toContain("ai-openscad-final");
  await expect(page.getByRole("button", { name: /STL/i })).toBeVisible();
  await expect(page.locator(".agentRun").getByText("Render finished")).toBeVisible({
    timeout: 30000
  });
  await expect(page.locator(".agentRun").getByText("Draft precision was used for fast review.")).toBeVisible({
    timeout: 30000
  });
  await expectTimelineOrder(page, [
    "User request",
    "Generated OpenSCAD code",
    "Render started",
    "Render finished"
  ]);
  await expect(page.locator(".chatCodeDisclosure")).toBeVisible();
  await expect(page.locator(".chatCodeDisclosure")).not.toHaveAttribute("open", "");
  await expect(page.locator(".agentCodePreview")).toHaveCount(0);
  const generatedCodeDisclosure = page.locator(".chatCodeDisclosure").first();
  const codeToggle = page.getByRole("button", { name: /OpenSCAD/i }).first();
  await expect(codeToggle).toBeVisible();
  await codeToggle.focus();
  await expect(codeToggle).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(generatedCodeDisclosure).toHaveAttribute("open", "");
  await expect(generatedCodeDisclosure.locator(".agentCodePreview")).toContainText("cube(10);");
  await expect(page.locator('.workflowStage[data-stage="render"]')).toContainText("Complete");
  const renderedImageUrlsBeforePreviewDrag = await page
    .locator(".viewTile img")
    .evaluateAll((images) => images.map((image) => (image as HTMLImageElement).src));
  await dragInteractivePreview(page);
  const renderedImageUrlsAfterPreviewDrag = await page
    .locator(".viewTile img")
    .evaluateAll((images) => images.map((image) => (image as HTMLImageElement).src));
  expect(renderedImageUrlsAfterPreviewDrag).toEqual(renderedImageUrlsBeforePreviewDrag);
  const storedAfterGenerate = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("ai-openscad.project") ?? "{}")
  );
  expect(storedAfterGenerate.runEvents).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        role: "user",
        status: "complete",
        content: expect.stringContaining("生成一个30ML的杯子模型")
      }),
      expect.objectContaining({
        role: "assistant",
        title: "Generated OpenSCAD code",
        status: "complete",
        code: expect.stringContaining("cube(10);")
      }),
      expect.objectContaining({
        role: "tool",
        title: "Render started"
      }),
      expect.objectContaining({
        role: "tool",
        title: "Render finished"
      })
    ])
  );
  expect(streamRequested).toBe(true);
  await page.getByRole("button", { name: /^Review$/i }).click();
  await expect(page.locator(".agentInput")).toHaveValue(/增加杯口倒角/);
  const storedAfterFirstReview = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("ai-openscad.project") ?? "{}")
  );
  expect(reviewRequirement).toContain("生成一个30ML的杯子模型");
  expect(reviewImageUrls).toHaveLength(14);
  expect(reviewImageUrls).toEqual(renderedImageUrlsBeforePreviewDrag);
  expect(storedAfterFirstReview.originalRequirement).toBe("生成一个30ML的杯子模型");
  expect(storedAfterFirstReview.requirement).toContain("增加杯口倒角");
});

test("bounded confidence run locks controls while a generation is active", async ({
  page
}) => {
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.llm-api-key", "sk-llm");
    localStorage.setItem("ai-openscad.vision-api-key", "sk-vision");
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        currentCode: "",
        originalRequirement: "",
        views: { front: "", back: "", left: "", right: "", top: "", isometric: "" },
        review: null,
        promptTrace: []
      })
    );
  }, project);

  let releaseGeneration: () => void = () => {};
  let generationStarted: () => void = () => {};
  const generationStartedPromise = new Promise<void>((resolve) => {
    generationStarted = resolve;
  });
  const releaseGenerationPromise = new Promise<void>((resolve) => {
    releaseGeneration = resolve;
  });

  await page.route("**/api/llm", async (route) => {
    generationStarted();
    await releaseGenerationPromise;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sseChunks("module locked_run() { cube(10); } locked_run();")
    });
  });

  await page.route("**/api/vision", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        content: JSON.stringify({
          summary: "The locked run finished.",
          issues: [],
          correctionPrompt: "No further changes.",
          confidence: 0.95
        })
      })
    });
  });

  await page.goto("/");
  await configureBoundedAutoRun(page, { autoIterations: 1 });
  await page.getByRole("button", { name: /^Generate$/i }).click();
  await generationStartedPromise;

  await expect(page.getByRole("button", { name: /^Generate$/i })).toBeDisabled();
  await expect(page.getByLabel("Target confidence")).toBeDisabled();
  await expect(page.getByLabel("Auto iterations")).toBeDisabled();
  await expectButtonAbsentOrDisabled(page, /^Review$/i);
  await expectButtonAbsentOrDisabled(page, /Iterate Again/i);
  await expectButtonAbsentOrDisabled(page, /^Rerender$/i);
  await expectButtonAbsentOrDisabled(page, /Final Export/i);
  await expect(page.locator(".projectTools input[type='file']")).toBeDisabled();
  await expect(page.locator(".projectTools").getByRole("button", { name: /Export/i })).toBeDisabled();
  await expect(page.locator(".controlPanel").getByRole("button", { name: "New model" })).toBeDisabled();
  await expect(page.locator(".modelHistory button").first()).toBeDisabled();

  releaseGeneration();
  await expect(page.locator(".agentRun")).toContainText(/Target confidence reached/i, {
    timeout: 45_000
  });
  await expect(page.getByLabel("Target confidence")).toBeEnabled();
  await expect(page.getByLabel("Auto iterations")).toBeEnabled();
});

test("generate bounded confidence run stops after target confidence and omits confidence from revision prompts", async ({
  page
}) => {
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.llm-api-key", "sk-llm");
    localStorage.setItem("ai-openscad.vision-api-key", "sk-vision");
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        currentCode: "",
        originalRequirement: "",
        views: { front: "", back: "", left: "", right: "", top: "", isometric: "" },
        review: null,
        promptTrace: []
      })
    );
  }, project);

  await page.setViewportSize({ width: 1440, height: 1000 });
  const llmBodies: string[] = [];
  const visionImageBatches: string[][] = [];
  const reviewConfidences = [0.41, 0.91];
  const generatedCodes = [
    "module draft_a() { cube(10); } draft_a();",
    "module draft_b() { sphere(10); } draft_b();"
  ];

  await page.route("**/api/llm", async (route) => {
    const body = route.request().postDataJSON();
    llmBodies.push(JSON.stringify(body));
    expect(llmBodies.length, "unexpected extra /api/llm request").toBeLessThanOrEqual(2);
    const code = generatedCodes[Math.min(llmBodies.length - 1, generatedCodes.length - 1)];
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sseChunks(code)
    });
  });

  await page.route("**/api/vision", async (route) => {
    const body = route.request().postDataJSON() as {
      messages: Array<{ content: unknown }>;
    };
    const imageUrls = imageUrlsFromVisionContent(body.messages[1].content);
    visionImageBatches.push(imageUrls);
    expect(visionImageBatches.length, "unexpected extra /api/vision request").toBeLessThanOrEqual(2);
    const confidence = reviewConfidences[visionImageBatches.length - 1];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        content: JSON.stringify({
          summary:
            confidence >= 0.85
              ? "Draft now matches the requested cup."
              : "Draft is still missing the handle depth.",
          issues: confidence >= 0.85 ? [] : ["Handle depth is too shallow."],
          correctionPrompt: "Keep the cup printable and make the handle deeper.",
          confidence
        })
      })
    });
  });

  await page.goto("/");
  await configureBoundedAutoRun(page, { autoIterations: 2 });
  await page.getByRole("button", { name: /^Generate$/i }).click();

  await expect(page.locator(".agentRun")).toContainText(/Target confidence reached/i, {
    timeout: 45_000
  });
  await expect(page.locator(".agentRun")).toContainText("Confidence 91%");
  await expect(page.locator(".codeEditor").first()).toHaveValue(/draft_b/);
  await expect(page.getByRole("button", { name: /Final Export/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Iterate Again/i })).toBeVisible();
  expect(llmBodies).toHaveLength(2);
  expect(visionImageBatches).toHaveLength(2);
  expect(visionImageBatches[0]).toHaveLength(14);
  expect(visionImageBatches[1]).toHaveLength(14);
  await expect(page.locator(".agentRun")).toContainText(/Auto iteration 1 of 2/i);
  expect(llmBodies[1]).toContain("Draft is still missing the handle depth.");
  expect(llmBodies[1]).not.toMatch(/confidence/i);
  expect(llmBodies[1]).not.toContain("0.41");
  expect(llmBodies[1]).not.toContain("41%");
  expect(llmBodies[1]).not.toContain("85");
});

test("bounded confidence run rolls back when a follow-up lowers confidence", async ({
  page
}) => {
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.llm-api-key", "sk-llm");
    localStorage.setItem("ai-openscad.vision-api-key", "sk-vision");
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        currentCode: "",
        originalRequirement: "",
        views: { front: "", back: "", left: "", right: "", top: "", isometric: "" },
        review: null,
        promptTrace: []
      })
    );
  }, project);

  const llmBodies: string[] = [];
  const visionBodies: string[] = [];
  const visionImageBatches: string[][] = [];
  const generatedCodes = [
    "module checkpoint_a() { cube([12, 12, 12], center = true); } checkpoint_a();",
    "module regressed_b() { sphere(r = 5); } regressed_b();",
    "module improved_c() { cylinder(h = 14, r = 7, center = true); } improved_c();"
  ];

  await page.route("**/api/llm", async (route) => {
    const bodyText = JSON.stringify(route.request().postDataJSON());
    llmBodies.push(bodyText);
    expect(llmBodies.length, "unexpected extra /api/llm request").toBeLessThanOrEqual(3);
    if (llmBodies.length === 3) {
      await expect(page.locator(".agentInput")).toHaveValue(/Fresh checkpoint prompt/);
      expect(bodyText).toContain("checkpoint_a");
      expect(bodyText).toContain("Fresh checkpoint prompt");
      expect(bodyText).not.toContain("regressed_b");
      expect(bodyText).not.toContain("Bad regression prompt");
      expect(bodyText).not.toMatch(/confidence/i);
      expect(bodyText).not.toMatch(/threshold/i);
      expect(bodyText).not.toMatch(/target confidence|confidence target|stop threshold/i);
      expect(bodyText).not.toContain("95");
      expect(bodyText).not.toContain("40%");
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sseChunks(generatedCodes[llmBodies.length - 1])
    });
  });

  await page.route("**/api/vision", async (route) => {
    const body = route.request().postDataJSON() as {
      messages: Array<{ content: unknown }>;
    };
    const bodyText = JSON.stringify(body);
    const imageUrls = imageUrlsFromVisionContent(body.messages[1].content);
    visionBodies.push(bodyText);
    visionImageBatches.push(imageUrls);
    expect(visionBodies.length, "unexpected extra /api/vision request").toBeLessThanOrEqual(4);
    expect(imageUrls).toHaveLength(14);
    expect(bodyText).toContain("compileStatus: success");
    expect(bodyText).toContain("viewCount: 14");
    const responses = [
      {
        expectedCode: "checkpoint_a",
        summary: "Checkpoint draft is usable but below target.",
        issues: ["Handle still needs more clearance."],
        correctionPrompt: "Checkpoint prompt: deepen the handle without changing the cup.",
        confidence: 0.7
      },
      {
        expectedCode: "regressed_b",
        summary: "The automatic follow-up lost important cup structure.",
        issues: ["Cup body regressed."],
        correctionPrompt: "Bad regression prompt: keep working from the regressed draft.",
        confidence: 0.4
      },
      {
        expectedCode: "checkpoint_a",
        summary: "Restored checkpoint still needs a smaller targeted fix.",
        issues: ["Only the handle clearance remains low."],
        correctionPrompt: "Fresh checkpoint prompt: adjust only the handle from the restored model.",
        confidence: 0.75
      },
      {
        expectedCode: "improved_c",
        summary: "The restored-model follow-up now matches the request.",
        issues: [],
        correctionPrompt: "No further changes.",
        confidence: 0.96
      }
    ];
    const response = responses[visionBodies.length - 1];
    expect(bodyText).toContain(response.expectedCode);
    if (visionBodies.length === 3) {
      expect(bodyText).not.toContain("regressed_b");
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ content: JSON.stringify(response) })
    });
  });

  await page.goto("/");
  await configureBoundedAutoRun(page, { autoIterations: 2, targetConfidence: 95 });
  await page.getByRole("button", { name: /^Generate$/i }).click();

  await expect(page.locator(".agentRun")).toContainText(/Target confidence reached/i, {
    timeout: 60_000
  });
  const rollbackEvent = page.locator(".agentEvent", { hasText: /Regressed confidence/i });
  await expect(rollbackEvent).toHaveCount(1);
  await expect(rollbackEvent).toContainText(/restored checkpoint/i);
  await expect(rollbackEvent).toContainText(/Checkpoint confidence\s+70%/i);
  await expect(rollbackEvent).toContainText(/Regressed confidence\s+40%/i);
  await expect(rollbackEvent).toContainText(/fresh review/i);
  await expect(page.locator(".agentRun")).toContainText(/Fresh checkpoint prompt/);
  await expect(page.locator(".agentRun")).toContainText("Confidence 96%");
  await expect(page.locator(".agentRun")).toContainText(/Auto iteration 1 of 2/i);
  await expect(page.locator(".agentRun")).toContainText(/Auto iteration 2 of 2/i);
  await expect(page.locator(".codeEditor").first()).toHaveValue(/improved_c/);

  expect(llmBodies).toHaveLength(3);
  expect(visionBodies).toHaveLength(4);
  expect(visionImageBatches).toHaveLength(4);
  for (const imageBatch of visionImageBatches) {
    expect(imageBatch).toHaveLength(14);
  }
  expect(visionImageBatches[2]).toEqual(visionImageBatches[0]);
  expect(visionImageBatches[2]).not.toEqual(visionImageBatches[1]);
  expect(visionBodies[2]).toContain("checkpoint_a");
  expect(visionBodies[2]).not.toContain("regressed_b");
  expect(llmBodies[2]).toContain("checkpoint_a");
  expect(llmBodies[2]).toContain("Fresh checkpoint prompt");
  expect(llmBodies[2]).not.toContain("regressed_b");
  expect(llmBodies[2]).not.toContain("Bad regression prompt");

  const storedAfterRun = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("ai-openscad.project") ?? "{}")
  );
  expect(storedAfterRun.currentCode).toContain("improved_c");
  expect(storedAfterRun.review.confidence).toBe(0.96);
});

test("generate bounded confidence run stops at the automatic iteration limit", async ({
  page
}) => {
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.llm-api-key", "sk-llm");
    localStorage.setItem("ai-openscad.vision-api-key", "sk-vision");
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        currentCode: "",
        originalRequirement: "",
        views: { front: "", back: "", left: "", right: "", top: "", isometric: "" },
        review: null,
        promptTrace: []
      })
    );
  }, project);

  const llmBodies: string[] = [];
  let visionRequests = 0;
  await page.route("**/api/llm", async (route) => {
    llmBodies.push(JSON.stringify(route.request().postDataJSON()));
    expect(llmBodies.length, "unexpected extra /api/llm request").toBeLessThanOrEqual(2);
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sseChunks(
        llmBodies.length === 1
          ? "module limit_a() { cube(10); } limit_a();"
          : "module limit_b() { sphere(10); } limit_b();"
      )
    });
  });

  await page.route("**/api/vision", async (route) => {
    visionRequests += 1;
    expect(visionRequests, "unexpected extra /api/vision request").toBeLessThanOrEqual(2);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        content: JSON.stringify({
          summary: "The model is still below the requested quality bar.",
          issues: ["Still missing the requested proportions."],
          correctionPrompt: "Keep revising the proportions.",
          confidence: visionRequests === 1 ? 0.42 : 0.5
        })
      })
    });
  });

  await page.goto("/");
  await configureBoundedAutoRun(page, { autoIterations: 1 });
  await page.getByRole("button", { name: /^Generate$/i }).click();

  await expect(page.locator(".agentRun")).toContainText(/Auto iteration limit reached/i, {
    timeout: 45_000
  });
  await expect(page.locator(".agentRun")).toContainText("Confidence 50%");
  await expect(page.locator(".agentRun")).toContainText(/Auto iteration 1 of 1/i);
  await expect(page.locator(".codeEditor").first()).toHaveValue(/limit_b/);
  await expect(page.getByRole("button", { name: /Iterate Again/i })).toBeVisible();
  expect(llmBodies).toHaveLength(2);
  expect(visionRequests).toBe(2);
});

test("auto follow-up compile failure uses compiler repair without consuming more auto iterations", async ({
  page
}) => {
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.llm-api-key", "sk-llm");
    localStorage.setItem("ai-openscad.vision-api-key", "sk-vision");
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        currentCode: "",
        originalRequirement: "",
        views: { front: "", back: "", left: "", right: "", top: "", isometric: "" },
        review: null,
        promptTrace: []
      })
    );
  }, project);

  const llmBodies: string[] = [];
  let visionRequests = 0;
  await page.route("**/api/llm", async (route) => {
    llmBodies.push(JSON.stringify(route.request().postDataJSON()));
    expect(llmBodies.length, "unexpected extra /api/llm request").toBeLessThanOrEqual(4);
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sseChunks(
        llmBodies.length === 1
          ? "module repair_seed() { cube(10); } repair_seed();"
          : "cube("
      )
    });
  });

  await page.route("**/api/vision", async (route) => {
    visionRequests += 1;
    expect(visionRequests, "unexpected extra /api/vision request").toBeLessThanOrEqual(1);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        content: JSON.stringify({
          summary: "The seed draft needs one automatic revision.",
          issues: ["The handle is missing."],
          correctionPrompt: "Add the requested handle.",
          confidence: 0.2
        })
      })
    });
  });

  await page.goto("/");
  await configureBoundedAutoRun(page, { autoIterations: 1 });
  await page.getByRole("button", { name: /^Generate$/i }).click();

  await expect(page.locator(".agentRun")).toContainText(/Compiler repair 2 of 2/i, {
    timeout: 45_000
  });
  await expect(page.locator(".agentRun")).toContainText(/Auto iteration 1 of 1/i);
  await expect(page.locator(".agentRun")).toContainText(/OpenSCAD render failed/i);
  await expect(page.locator('.workflowStage[data-stage="render"]')).toContainText("Error", {
    timeout: 45_000
  });
  await expect(page.getByRole("button", { name: /^Review$/i })).toHaveCount(0);
  await expect(page.getByLabel("Target confidence")).toBeEnabled();
  await expect(page.getByLabel("Auto iterations")).toBeEnabled();
  await expect(page.locator(".codeEditor").first()).toBeEnabled();
  await expect(page.getByRole("button", { name: /^Rerender$/i })).toBeEnabled();
  await expect(page.locator(".projectTools input[type='file']")).toBeEnabled();
  await expect(page.locator(".projectTools").getByRole("button", { name: /Export/i })).toBeEnabled();
  await expect(page.locator(".controlPanel").getByRole("button", { name: "New model" })).toBeEnabled();
  expect(llmBodies).toHaveLength(4);
  expect(visionRequests).toBe(1);
});

test("auto follow-up compile repair can succeed and continue to review", async ({
  page
}) => {
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.llm-api-key", "sk-llm");
    localStorage.setItem("ai-openscad.vision-api-key", "sk-vision");
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        currentCode: "",
        originalRequirement: "",
        views: { front: "", back: "", left: "", right: "", top: "", isometric: "" },
        review: null,
        promptTrace: []
      })
    );
  }, project);

  const llmBodies: string[] = [];
  const providerOrder: string[] = [];
  let visionRequests = 0;
  await page.route("**/api/llm", async (route) => {
    llmBodies.push(JSON.stringify(route.request().postDataJSON()));
    providerOrder.push(`llm-${llmBodies.length}`);
    expect(llmBodies.length, "unexpected extra /api/llm request").toBeLessThanOrEqual(3);
    const code =
      llmBodies.length === 1
        ? "module repair_success_seed() { cube(10); } repair_success_seed();"
        : llmBodies.length === 2
          ? "cube("
          : "module repaired_auto() { sphere(10); } repaired_auto();";
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sseChunks(code)
    });
  });

  await page.route("**/api/vision", async (route) => {
    visionRequests += 1;
    providerOrder.push(`vision-${visionRequests}`);
    expect(visionRequests, "unexpected extra /api/vision request").toBeLessThanOrEqual(2);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        content: JSON.stringify({
          summary:
            visionRequests === 1
              ? "The seed draft needs one automatic revision."
              : "The repaired auto draft matches the request.",
          issues: visionRequests === 1 ? ["The handle is missing."] : [],
          correctionPrompt:
            visionRequests === 1 ? "Add the requested handle." : "No further changes.",
          confidence: visionRequests === 1 ? 0.2 : 0.93
        })
      })
    });
  });

  await page.goto("/");
  await configureBoundedAutoRun(page, { autoIterations: 1 });
  await page.getByRole("button", { name: /^Generate$/i }).click();

  await expect(page.locator(".agentRun")).toContainText(/Target confidence reached/i, {
    timeout: 45_000
  });
  await expect(page.locator(".agentRun")).toContainText("Confidence 93%");
  await expect(page.locator(".agentRun")).toContainText(/Auto iteration 1 of 1/i);
  await expect(page.locator(".agentRun")).toContainText(/Compiler repair 1 of 2/i);
  await expect(page.locator(".codeEditor").first()).toHaveValue(/repaired_auto/);
  expect(llmBodies).toHaveLength(3);
  expect(visionRequests).toBe(2);
  expect(providerOrder).toEqual(["llm-1", "vision-1", "llm-2", "llm-3", "vision-2"]);
});

test("iterate again bounded confidence run can auto-follow until target confidence", async ({
  page
}) => {
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.llm-api-key", "sk-llm");
    localStorage.setItem("ai-openscad.vision-api-key", "sk-vision");
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        review: {
          summary: "Cup handle is too small.",
          issues: ["Make the handle larger."],
          correctionPrompt: "Keep the 30ML cup and enlarge the handle.",
          confidence: 0.44
        },
        promptTrace: []
      })
    );
  }, project);

  const llmBodies: string[] = [];
  let visionRequests = 0;
  await page.route("**/api/llm", async (route) => {
    llmBodies.push(JSON.stringify(route.request().postDataJSON()));
    expect(llmBodies.length, "unexpected extra /api/llm request").toBeLessThanOrEqual(2);
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sseChunks(
        llmBodies.length === 1
          ? "module iter_a() { cube(10); } iter_a();"
          : "module iter_b() { sphere(10); } iter_b();"
      )
    });
  });

  await page.route("**/api/vision", async (route) => {
    visionRequests += 1;
    expect(visionRequests, "unexpected extra /api/vision request").toBeLessThanOrEqual(2);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        content: JSON.stringify({
          summary: visionRequests === 1 ? "Handle is still undersized." : "Handle now fits.",
          issues: visionRequests === 1 ? ["Enlarge the handle further."] : [],
          correctionPrompt: "Preserve the cup and enlarge the handle further.",
          confidence: visionRequests === 1 ? 0.33 : 0.9
        })
      })
    });
  });

  await page.goto("/");
  await configureBoundedAutoRun(page, { autoIterations: 1 });
  await page.locator(".agentInput").fill("Keep the cup printable and use the review guidance.");
  await page.getByRole("button", { name: /Iterate Again/i }).click();

  await expect(page.locator(".agentRun")).toContainText(/Target confidence reached/i, {
    timeout: 45_000
  });
  await expect(page.locator(".agentRun")).toContainText("Confidence 90%");
  await expect(page.locator(".codeEditor").first()).toHaveValue(/iter_b/);
  expect(llmBodies).toHaveLength(2);
  expect(visionRequests).toBe(2);
  expect(llmBodies[0]).not.toMatch(/confidence/i);
  expect(llmBodies[0]).not.toContain("0.44");
  expect(llmBodies[1]).not.toMatch(/confidence/i);
  expect(llmBodies[1]).not.toContain("0.33");
});

test("canceled bounded confidence run ignores a late automatic revision response", async ({
  page
}) => {
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.llm-api-key", "sk-llm");
    localStorage.setItem("ai-openscad.vision-api-key", "sk-vision");
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        currentCode: "",
        originalRequirement: "",
        views: { front: "", back: "", left: "", right: "", top: "", isometric: "" },
        review: null,
        promptTrace: []
      })
    );
  }, project);

  let releaseRevision: () => void = () => {};
  let revisionStarted: () => void = () => {};
  const revisionStartedPromise = new Promise<void>((resolve) => {
    revisionStarted = resolve;
  });
  const releaseRevisionPromise = new Promise<void>((resolve) => {
    releaseRevision = resolve;
  });
  const llmBodies: string[] = [];
  let visionRequests = 0;

  await page.route("**/api/llm", async (route) => {
    llmBodies.push(JSON.stringify(route.request().postDataJSON()));
    expect(llmBodies.length, "unexpected extra /api/llm request").toBeLessThanOrEqual(2);
    if (llmBodies.length === 2) {
      revisionStarted();
      await releaseRevisionPromise;
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: sseChunks("module late_revision() { sphere(10); } late_revision();")
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sseChunks("module cancel_seed() { cube(10); } cancel_seed();")
    });
  });

  await page.route("**/api/vision", async (route) => {
    visionRequests += 1;
    expect(visionRequests, "late response started another vision request").toBeLessThanOrEqual(1);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        content: JSON.stringify({
          summary: "Needs an automatic follow-up revision.",
          issues: ["Add the missing feature."],
          correctionPrompt: "Add the missing feature.",
          confidence: 0.25
        })
      })
    });
  });

  await page.goto("/");
  await configureBoundedAutoRun(page, { autoIterations: 1 });
  await page.getByRole("button", { name: /^Generate$/i }).click();
  await revisionStartedPromise;
  await expect(page.locator(".agentRun")).toContainText(/Auto iteration 1 of 1/i);

  await page
    .locator(".codeEditor")
    .first()
    .fill("module manual_cancel() { cube(5); } manual_cancel();");
  releaseRevision();
  await page.waitForLoadState("networkidle");

  await expect(page.locator(".codeEditor").first()).toHaveValue(/manual_cancel/);
  await expect(page.locator(".codeEditor").first()).not.toHaveValue(/late_revision/);
  await expect(page.locator(".agentRun")).not.toContainText(/Target confidence reached/i);
  expect(llmBodies).toHaveLength(2);
  expect(visionRequests).toBe(1);
});

test("bounded confidence run stops without revision when review confidence is missing", async ({
  page
}) => {
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.llm-api-key", "sk-llm");
    localStorage.setItem("ai-openscad.vision-api-key", "sk-vision");
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        currentCode: "",
        originalRequirement: "",
        views: { front: "", back: "", left: "", right: "", top: "", isometric: "" },
        review: null,
        promptTrace: []
      })
    );
  }, project);

  let llmRequests = 0;
  let visionRequests = 0;
  await page.route("**/api/llm", async (route) => {
    llmRequests += 1;
    expect(llmRequests, "unexpected extra /api/llm request").toBeLessThanOrEqual(1);
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sseChunks("module missing_confidence() { cube(10); } missing_confidence();")
    });
  });
  await page.route("**/api/vision", async (route) => {
    visionRequests += 1;
    expect(visionRequests, "unexpected extra /api/vision request").toBeLessThanOrEqual(1);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        content: JSON.stringify({
          summary: "Review omitted confidence.",
          issues: ["The review response is incomplete."],
          correctionPrompt: "Do not auto-revise without confidence."
        })
      })
    });
  });

  await page.goto("/");
  await configureBoundedAutoRun(page, { autoIterations: 2 });
  await page.getByRole("button", { name: /^Generate$/i }).click();

  await expect(page.locator(".agentRun")).toContainText(/review confidence/i, {
    timeout: 45_000
  });
  await expect(page.locator(".codeEditor").first()).toHaveValue(/missing_confidence/);
  await expect(page.getByRole("button", { name: /Review/i })).toBeVisible();
  expect(llmRequests).toBe(1);
  expect(visionRequests).toBe(1);
});

test("bounded confidence run stops without revision when review confidence is out of range", async ({
  page
}) => {
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.llm-api-key", "sk-llm");
    localStorage.setItem("ai-openscad.vision-api-key", "sk-vision");
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        currentCode: "",
        originalRequirement: "",
        views: { front: "", back: "", left: "", right: "", top: "", isometric: "" },
        review: null,
        promptTrace: []
      })
    );
  }, project);

  let llmRequests = 0;
  let visionRequests = 0;
  await page.route("**/api/llm", async (route) => {
    llmRequests += 1;
    expect(llmRequests, "unexpected extra /api/llm request").toBeLessThanOrEqual(1);
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sseChunks("module out_of_range_confidence() { cube(10); } out_of_range_confidence();")
    });
  });
  await page.route("**/api/vision", async (route) => {
    visionRequests += 1;
    expect(visionRequests, "unexpected extra /api/vision request").toBeLessThanOrEqual(1);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        content: JSON.stringify({
          summary: "Review confidence is out of range.",
          issues: ["The confidence value is invalid."],
          correctionPrompt: "Do not auto-revise with invalid confidence.",
          confidence: 1.5
        })
      })
    });
  });

  await page.goto("/");
  await configureBoundedAutoRun(page, { autoIterations: 2 });
  await page.getByRole("button", { name: /^Generate$/i }).click();

  await expect(page.locator(".agentRun")).toContainText(/review confidence/i, {
    timeout: 45_000
  });
  await expect(page.locator(".codeEditor").first()).toHaveValue(/out_of_range_confidence/);
  await expect(page.getByRole("button", { name: /Review/i })).toBeVisible();
  expect(llmRequests).toBe(1);
  expect(visionRequests).toBe(1);
});

test("compile failure automatically repairs code while visual review never loops", async ({
  page
}) => {
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.llm-api-key", "sk-llm");
    localStorage.setItem("ai-openscad.vision-api-key", "sk-vision");
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        currentCode: "",
        originalRequirement: "",
        views: { front: "", back: "", left: "", right: "", top: "", isometric: "" },
        review: null,
        promptTrace: []
      })
    );
  }, project);

  let llmRequests = 0;
  let repairPrompt = "";
  let visionRequests = 0;
  await page.route("**/api/llm", async (route) => {
    llmRequests += 1;
    if (llmRequests === 1) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: sseChunks("cube(")
      });
      return;
    }
    const body = route.request().postDataJSON() as {
      messages: Array<{ content: unknown }>;
    };
    repairPrompt = JSON.stringify(body.messages);
    await delay(1_500);
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sseChunks("cube(10);")
    });
  });
  await page.route("**/api/vision", async (route) => {
    visionRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        content: JSON.stringify({
          summary: "六视图已满足基础几何。",
          issues: ["没有图片驱动的自动重写"],
          correctionPrompt: "保持当前模型，只在用户点击再次迭代后才修改。",
          confidence: 0.8
        })
      })
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /^Generate$/i }).click();

  await expect.poll(() => llmRequests, { timeout: 30_000 }).toBe(2);
  await expectCompilerRepairInFlight(page);
  expect(repairPrompt).toContain("cube(");
  expect(repairPrompt).toContain("OpenSCAD render failed");
  await expect(page.locator(".viewTile img")).toHaveCount(14, { timeout: 30_000 });
  await expect(page.getByRole("button", { name: /^Review$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Fix with diagnostics/i })).toHaveCount(0);

  await page.getByRole("button", { name: /^Review$/i }).click();
  await expect(page.locator(".agentRun").getByText("Vision review complete.")).toBeVisible();
  expect(visionRequests).toBe(1);
  await delay(1_000);
  expect(llmRequests).toBe(2);
});

test("unsafe render diagnostics trigger compiler repair before visual review", async ({
  page
}, testInfo) => {
  test.setTimeout(75_000);
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.llm-api-key", "sk-llm");
    localStorage.setItem("ai-openscad.vision-api-key", "sk-vision");
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        currentCode: "",
        originalRequirement: "",
        views: { front: "", back: "", left: "", right: "", top: "", isometric: "" },
        review: null,
        promptTrace: []
      })
    );
  }, project);

  const llmBodies: string[] = [];
  const visionBodies: string[] = [];
  let repairRequestSeen = false;
  let allowRepairResponse = () => {};
  const repairResponseAllowed = new Promise<void>((resolve) => {
    allowRepairResponse = resolve;
  });
  await page.route("**/api/llm", async (route) => {
    llmBodies.push(JSON.stringify(route.request().postDataJSON()));
    const requestIndex = llmBodies.length;
    expect(requestIndex, "unexpected extra /api/llm request").toBeLessThanOrEqual(2);
    if (requestIndex === 2) {
      repairRequestSeen = true;
      await repairResponseAllowed;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sseChunks(
        requestIndex === 1
          ? "cube(10); translate([20, 0, 0]) sphere(r = missing * 2);"
          : "cube(10);"
      )
    });
  });

  await page.route("**/api/vision", async (route) => {
    const bodyText = JSON.stringify(route.request().postDataJSON());
    visionBodies.push(bodyText);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        content: JSON.stringify(
          bodyText.includes("missing * 2")
            ? {
                summary: "Unsafe render reached vision review.",
                issues: ["This should have triggered compiler repair first."],
                correctionPrompt: "Do not review unsafe render diagnostics."
              }
            : {
                summary: "The repaired clean render is reviewable.",
                issues: [],
                correctionPrompt: "No further changes.",
                confidence: 0.95
              }
        )
      })
    });
  });

  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto("/");
  await configureBoundedAutoRun(page, { autoIterations: 1, targetConfidence: 90 });
  await page.getByRole("button", { name: /^Generate$/i }).click();

  await expect.poll(() => repairRequestSeen, { timeout: 45_000 }).toBe(true);
  try {
    await expectCompilerRepairInFlight(page);
    await expectButtonAbsentOrDisabled(page, /^Review$/i);
    await expectButtonAbsentOrDisabled(page, /Final Export/i);
    await expectButtonAbsentOrDisabled(page, /^Rerender$/i);
    await expect(page.locator(".viewTile img")).toHaveCount(0);
    await delay(500);
    await expectCompilerRepairInFlight(page);
    await expectButtonAbsentOrDisabled(page, /^Review$/i);
    await expectButtonAbsentOrDisabled(page, /Final Export/i);
    await expectButtonAbsentOrDisabled(page, /^Rerender$/i);
    await expect(page.locator(".viewTile img")).toHaveCount(0);
    await expect(page.locator(".agentRun")).toContainText(/Render diagnostics/i);
    await expect(page.locator(".agentRun")).toContainText(/undefined operation/i);
    const diagnosticsEvent = page.locator(".agentEvent").filter({
      has: page.getByRole("heading", { name: "Render diagnostics" })
    }).first();
    await expect(diagnosticsEvent).toContainText(/undefined operation/i);
    await page.locator(".workspace").screenshot({
      path: testInfo.outputPath("unsafe-diagnostics-repair.png")
    });
    await diagnosticsEvent.evaluate((node) =>
      node.scrollIntoView({ block: "center", inline: "nearest" })
    );
    await page.locator(".agentTimeline").screenshot({
      path: testInfo.outputPath("unsafe-diagnostics-repair-event.png")
    });
  } finally {
    allowRepairResponse();
  }

  await expect(page.locator(".agentRun")).toContainText(/Target confidence reached/i, {
    timeout: 45_000
  });
  await expect(page.locator(".agentRun")).toContainText("Confidence 95%");
  await expect(page.locator(".agentRun")).not.toContainText(/Review confidence is missing/i);
  await expect(page.locator(".codeEditor").first()).toHaveValue(/^cube\(10\);$/);

  expect(repairRequestSeen).toBe(true);
  expect(llmBodies).toHaveLength(2);
  expect(llmBodies[1]).toContain("undefined operation");
  expect(visionBodies).toHaveLength(1);
  expect(visionBodies[0]).toContain("cube(10);");
  expect(visionBodies[0]).not.toContain("missing * 2");
});

test("compiler repair stops after two automatic attempts", async ({ page }) => {
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.llm-api-key", "sk-llm");
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        currentCode: "",
        originalRequirement: "",
        views: { front: "", back: "", left: "", right: "", top: "", isometric: "" },
        review: null,
        promptTrace: []
      })
    );
  }, project);

  let llmRequests = 0;
  await page.route("**/api/llm", async (route) => {
    llmRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sseChunks("cube(")
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /^Generate$/i }).click();

  await expect.poll(() => llmRequests, { timeout: 30_000 }).toBe(3);
  await expect(page.locator(".agentRun")).toContainText(/Compiler repair 2 of 2/i, {
    timeout: 30_000
  });
  await expect(page.locator('.workflowStage[data-stage="render"]')).toContainText("Error", {
    timeout: 30_000
  });
  await expect(page.locator(".agentInput")).toHaveValue(/OpenSCAD render failed/i);
  await expect(page.getByRole("button", { name: /^Review$/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Final Export/i })).toHaveCount(0);
  await delay(1_000);
  expect(llmRequests).toBe(3);
});

test("compile failure without a code-model key stays manual and blocks stale outputs", async ({
  page
}) => {
  await page.addInitScript((storedProject) => {
    localStorage.removeItem("ai-openscad.llm-api-key");
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        codeModelId: "deepseek-v4",
        currentCode: "cube(10);",
        review: null,
        promptTrace: []
      })
    );
  }, project);

  let llmRequests = 0;
  await page.route("**/api/llm", async (route) => {
    llmRequests += 1;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "LLM should not run without a key" })
    });
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Review$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Final Export/i })).toBeVisible();
  await page.getByText("Advanced: view/edit OpenSCAD code").click();
  await page.locator(".codeEditor").fill("cube(");
  await expect(page.locator(".viewTile img")).toHaveCount(0);
  await page.getByRole("button", { name: /^Rerender$/i }).click();

  await expect(page.locator('.workflowStage[data-stage="render"]')).toContainText("Error", {
    timeout: 30_000
  });
  await expect(page.locator(".agentInput")).toHaveValue(/OpenSCAD render failed/i);
  await expect(page.getByRole("button", { name: /^Review$/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Final Export/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Fix with diagnostics/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Rerender$/i })).toBeEnabled();
  expect(llmRequests).toBe(0);
});

test("legacy three-view projects must rerender before review or export", async ({ page }) => {
  await page.addInitScript(({ storedProject, png }) => {
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        views: {
          front: png,
          top: png,
          right: png
        },
        renderEvidence: {
          compileStatus: "success",
          diagnostics: "Legacy three-view render.",
          renderPrecision: "draft",
          backend: "web-manifold",
          viewCount: 3
        },
        review: null,
        promptTrace: []
      })
    );
  }, { storedProject: project, png: pixel });

  await page.goto("/");
  await expect(page.locator(".viewTile img")).toHaveCount(3);
  await expect(page.getByRole("button", { name: /^Review$/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Final Export/i })).toHaveCount(0);

  await page.getByRole("button", { name: /^Rerender$/i }).click();

  await expect(page.locator(".viewTile img")).toHaveCount(14, { timeout: 30_000 });
  await expect(page.getByRole("button", { name: /^Review$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Final Export/i })).toBeVisible();
});

test("legacy six-view projects keep old isometric but must rerender before review", async ({
  page
}) => {
  await page.addInitScript(({ storedProject, png }) => {
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        views: {
          front: png,
          back: png,
          left: png,
          right: png,
          top: png,
          isometric: png
        },
        renderEvidence: {
          compileStatus: "success",
          diagnostics: "Legacy six-view render.",
          renderPrecision: "draft",
          backend: "web-manifold",
          viewCount: 6
        },
        review: {
          summary: "Stale review from the old six-view project.",
          issues: ["Old visual evidence is incomplete."],
          correctionPrompt: "Rerender before iterating.",
          confidence: 0.3
        },
        promptTrace: []
      })
    );
  }, { storedProject: project, png: pixel });

  await page.goto("/");

  await expect(page.locator(".viewTile img")).toHaveCount(6);
  await expect(page.getByRole("button", { name: /^Review$/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Final Export/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Iterate Again/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Rerender$/i })).toBeVisible();

  await page.getByRole("button", { name: /^Rerender$/i }).click();

  await expect(page.locator(".viewTile img")).toHaveCount(14, { timeout: 30_000 });
  await expect(page.locator(".viewTile figcaption")).toHaveText(viewNames);
  await expect(page.getByRole("button", { name: /^Review$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Final Export/i })).toBeVisible();
});

test("partial thirteen-view capture blocks vision review and stale actions", async ({
  page
}) => {
  const partialViews = { ...viewDataUrls, isoBackLeftBottom: "" };
  await page.addInitScript(({ storedProject, views }) => {
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        views,
        renderEvidence: {
          compileStatus: "success",
          diagnostics: "Partial thirteen-view render.",
          renderPrecision: "draft",
          backend: "web-manifold",
          viewCount: 13
        },
        review: {
          summary: "Stale review should be blocked.",
          issues: ["Only thirteen views exist."],
          correctionPrompt: "Rerender all views before iterating.",
          confidence: 0.4
        },
        promptTrace: []
      })
    );
  }, { storedProject: project, views: partialViews });

  let visionRequests = 0;
  await page.route("**/api/vision", async (route) => {
    visionRequests += 1;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Vision should not run with 13/14 views" })
    });
  });

  await page.goto("/");

  await expect(page.locator(".viewTile img")).toHaveCount(13);
  await expect(page.getByRole("button", { name: /^Review$/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Final Export/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Iterate Again/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Rerender$/i })).toBeVisible();
  expect(visionRequests).toBe(0);
});

test("manual code edits clear stale views before automatic rerender repair", async ({ page }) => {
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.llm-api-key", "sk-llm");
    localStorage.setItem("ai-openscad.vision-api-key", "sk-vision");
    localStorage.setItem("ai-openscad.project", JSON.stringify(storedProject));
  }, project);

  let llmRequests = 0;
  let repairPrompt = "";
  await page.route("**/api/llm", async (route) => {
    llmRequests += 1;
    const body = route.request().postDataJSON() as {
      messages: Array<{ content: unknown }>;
    };
    repairPrompt = JSON.stringify(body.messages);
    await delay(1_500);
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sseChunks("cube(10);")
    });
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Review$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Final Export/i })).toBeVisible();
  await expect(page.locator(".viewTile img")).toHaveCount(14);

  await page.getByText("Advanced: view/edit OpenSCAD code").click();
  await page.locator(".codeEditor").fill("cube(");

  await expect(page.getByRole("button", { name: /^Review$/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Final Export/i })).toHaveCount(0);
  await expect(page.locator(".viewTile img")).toHaveCount(0);

  await page.getByRole("button", { name: /^Rerender$/i }).click();
  await expect.poll(() => llmRequests, { timeout: 30_000 }).toBe(1);
  await expect(page.locator(".agentRun")).toContainText(/Compiler repair 1 of 2/i, {
    timeout: 30_000
  });
  expect(repairPrompt).toContain("cube(");
  expect(repairPrompt).toContain("OpenSCAD render failed");
  await expect(page.locator(".viewTile img")).toHaveCount(14, { timeout: 30_000 });
  await expect(page.getByRole("button", { name: /^Review$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Final Export/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Fix with diagnostics/i })).toHaveCount(0);
});

test("wavy cup draft generation stays low complexity and renders views", async ({ page }) => {
  const wavyCupCode = `
height = 200;
outer_d_bottom = 65;
outer_d_top = 80;
wall = 2.5;
bottom_t = 3;
wave_count = 8;
wave_amplitude = 3;
wave_segments = 24;

module wave_disc(diameter, amp) {
  polygon([for (i = [0 : wave_segments - 1])
    let(a = i * 360 / wave_segments,
        r = diameter / 2 + amp * sin(wave_count * a))
    [r * cos(a), r * sin(a)]
  ]);
}

module water_cup() {
  difference() {
    linear_extrude(height = height, scale = outer_d_top / outer_d_bottom)
      wave_disc(outer_d_bottom, wave_amplitude);
    translate([0, 0, bottom_t])
      linear_extrude(height = height + 0.2, scale = (outer_d_top - 2 * wall) / (outer_d_bottom - 2 * wall))
        wave_disc(outer_d_bottom - 2 * wall, wave_amplitude * 0.4);
  }
}

water_cup();
`;

  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.llm-api-key", "sk-llm");
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        requirement: "生成一个20cm高的波浪形圆形水杯",
        originalRequirement: "",
        currentCode: "",
        views: { front: "", back: "", left: "", right: "", top: "", isometric: "" },
        review: null,
        promptTrace: []
      })
    );
  }, project);

  let prompt = "";
  await page.route("**/api/llm", async (route) => {
    const body = route.request().postDataJSON() as {
      messages: Array<{ content: string }>;
    };
    prompt = body.messages[0].content;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sseChunks(wavyCupCode)
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /^Generate$/i }).click();

  await expect(page.locator(".codeEditor").first()).toHaveValue(/wave_segments = 24/);
  await expect(page.locator(".codeEditor").first()).not.toHaveValue(/layer_h\s*=/);
  await expect(page.locator(".codeEditor").first()).not.toHaveValue(/layers\s*=\s*ceil/);
  await expect(page.locator(".codeEditor").first()).not.toHaveValue(/wave_segments\s*=\s*72/);
  await expect(page.locator(".viewTile img")).toHaveCount(14, { timeout: 45000 });
  await expectRenderedViewsHaveModelPixels(page);
  await expect(page.locator('.workflowStage[data-stage="render"]')).toContainText("Complete");
  expect(prompt).toContain("browser render complexity budget");
  expect(prompt).toContain("wavy surfaces");
});

test("user reported layered wavy cup OpenSCAD renders locally", async ({ page }) => {
  test.skip(!!process.env.CI, "Full browser render regression is local-only.");
  test.setTimeout(120_000);

  const reportedWavyCupCode = `
// 波浪形圆形水杯 - 20cm高，外壁带波浪纹理
// 打印方向：杯口朝上，底部朝下打印

// ===== 主要参数 =====
height = 200;           // 总高度 20cm
outer_d_bottom = 65;    // 底部外径
outer_d_top = 80;       // 顶部外径（锥度）
wall = 2.5;             // 壁厚
bottom_t = 3;           // 底部厚度
rim_r = 2;              // 杯口外圆角半径
base_r = 3;             // 底部外圆角

// ===== 波浪参数 =====
wave_count = 8;         // 波浪数量（周向波峰数）
wave_amplitude = 3;     // 波浪振幅（mm，向外凸出的最大距离）
wave_phase = 0;         // 波浪初始相位

// ===== 渲染参数 =====
$fn = 36;               // 圆形精度（预览用）

// ===== 波浪外壁杯子主体 =====
// 使用分层圆柱加波浪调制生成
module wave_cup_body() {
    layer_h = 2;  // 每层高度，用于光滑过渡
    layers = ceil(height / layer_h);
    
    for (i = [0 : layers - 1]) {
        z0 = i * layer_h;
        z1 = min((i + 1) * layer_h, height);
        z_mid = (z0 + z1) / 2;
        
        // 计算当前层的线性插值半径（锥度）
        r_bottom = outer_d_bottom / 2;
        r_top = outer_d_top / 2;
        r_linear = r_bottom + (r_top - r_bottom) * (z_mid / height);
        
        // 底部和顶部圆角过渡
        r_base_adj = z_mid < base_r ? 
            sqrt(pow(base_r, 2) - pow(base_r - z_mid, 2)) - base_r + r_bottom : 
            r_bottom;
        r_actual = z_mid < base_r ? 
            r_base_adj + (r_top - r_bottom) * (z_mid / height) :
            r_linear;
        
        // 顶部圆角收口
        if (z_mid > height - rim_r) {
            rim_offset = sqrt(pow(rim_r, 2) - pow(z_mid - (height - rim_r), 2)) - rim_r;
            r_actual = r_top + rim_offset;
        }
        
        // 波浪调制：沿周向正弦变化
        wave_segments = 72;  // 周向分段数
        // 生成波浪截面多边形
        wave_profile = [for (a = [0 : 360/wave_segments : 360 - 360/wave_segments])
            let(r_wave = r_actual + wave_amplitude * sin(wave_count * a + wave_phase))
            [r_wave * cos(a), r_wave * sin(a)]
        ];
        
        // 使用hull将各层连接形成实体
        translate([0, 0, z0])
        linear_extrude(height = layer_h + 0.01)  // 微小重叠避免缝隙
        polygon(wave_profile);
    }
}

// ===== 波浪内壁（空腔） =====
module wave_cup_hollow() {
    layer_h = 2;
    layers = ceil(height / layer_h);
    
    for (i = [0 : layers - 1]) {
        z0 = i * layer_h + bottom_t;  // 从底部厚度开始
        z1 = min((i + 1) * layer_h + bottom_t, height);
        z_mid = (z0 + z1) / 2;
        
        if (z_mid < height) {
            // 内壁半径（减去壁厚）
            r_bottom_inner = outer_d_bottom / 2 - wall;
            r_top_inner = outer_d_top / 2 - wall;
            r_linear_inner = r_bottom_inner + (r_top_inner - r_bottom_inner) * ((z_mid - bottom_t) / (height - bottom_t));
            
            // 波浪内壁也带波浪（相位偏移）
            wave_segments = 72;
            wave_profile_inner = [for (a = [0 : 360/wave_segments : 360 - 360/wave_segments])
                let(r_wave = r_linear_inner + wave_amplitude * 0.7 * sin(wave_count * a + wave_phase + 180))
                [r_wave * cos(a), r_wave * sin(a)]
            ];
            
            translate([0, 0, z0])
            linear_extrude(height = z1 - z0 + 0.01)
            polygon(wave_profile_inner);
        }
    }
}

// ===== 底部平面 =====
module cup_bottom() {
    cylinder(h = bottom_t, d = outer_d_bottom, $fn = $fn);
}

// ===== 完整杯子（实心减空心） =====
module wave_cup() {
    difference() {
        union() {
            cup_bottom();
            wave_cup_body();
        }
        // 挖空内部
        translate([0, 0, bottom_t])
        wave_cup_hollow();
    }
}

// ===== 底部防滑凹槽 =====
module bottom_groove() {
    groove_r = outer_d_bottom / 2 - 6;
    translate([0, 0, -0.01])
    linear_extrude(height = 1.5) {
        difference() {
            circle(r = groove_r + 1.5, $fn = $fn);
            circle(r = groove_r - 0.5, $fn = $fn);
        }
    }
}

// ===== 最终模型 =====
module water_cup() {
    difference() {
        wave_cup();
        bottom_groove();
    }
}

// 渲染杯子
water_cup();

// 输出关键尺寸
echo(str("波浪杯口内径范围: ", outer_d_top - 2*wall - wave_amplitude, "~", outer_d_top - 2*wall + wave_amplitude, "mm"));
echo(str("波浪杯底内径范围: ", outer_d_bottom - 2*wall - wave_amplitude, "~", outer_d_bottom - 2*wall + wave_amplitude, "mm"));
echo(str("波浪数: ", wave_count));
echo(str("波浪振幅: ", wave_amplitude, "mm"));
`;

  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.llm-api-key", "sk-llm");
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        requirement: "生成一个20cm高的波浪形圆形水杯",
        originalRequirement: "",
        currentCode: "",
        views: { front: "", back: "", left: "", right: "", top: "", isometric: "" },
        review: null,
        promptTrace: []
      })
    );
  }, project);

  await page.route("**/api/llm", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sseChunks(reportedWavyCupCode)
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /^Generate$/i }).click();

  await expect(page.locator(".codeEditor").first()).toHaveValue(/wave_segments = 72/);
  await expect(page.locator(".codeEditor").first()).toHaveValue(/layer_h = 2/);
  await expect(page.locator(".agentRun").getByText("Render started")).toBeVisible({
    timeout: 10_000
  });
  await expect(page.locator(".viewTile img")).toHaveCount(14, { timeout: 60_000 });
  await expectRenderedViewsHaveModelPixels(page);
  await expect(page.locator(".agentRun").getByText("Render finished")).toBeVisible({
    timeout: 10_000
  });
  await expect(page.locator(".agentRun")).not.toContainText("OpenSCAD render timed out");
  await expect(page.locator('.workflowStage[data-stage="render"]')).toContainText("Complete");

  const renderFinishedEvents = page.locator(".agentRun").getByText("Render finished");
  for (const expectedFinishedCount of [2, 3]) {
    await page.getByRole("button", { name: /Rerender/i }).click();
    await expect(renderFinishedEvents).toHaveCount(expectedFinishedCount, {
      timeout: 60_000
    });
    await expect(page.locator(".agentRun").getByRole("alert")).toHaveCount(0);
    await expect(page.locator(".viewTile img")).toHaveCount(14);
    await expectRenderedViewsHaveModelPixels(page);
    await expect(page.locator('.workflowStage[data-stage="render"]')).toContainText("Complete");
  }
});

test("MiMo generation can use the hosted key when the user key is empty", async ({
  page
}) => {
  await page.addInitScript((storedProject) => {
    localStorage.removeItem("ai-openscad.api-key");
    localStorage.removeItem("ai-openscad.llm-api-key");
    localStorage.removeItem("ai-openscad.vision-api-key");
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        currentCode: "",
        views: { front: "", back: "", left: "", right: "", top: "", isometric: "" },
        review: null,
        promptTrace: []
      })
    );
  }, project);

  let requestHeaders: Record<string, string> = {};
  await page.route("**/api/llm", async (route) => {
    requestHeaders = route.request().headers();
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        'data: {"choices":[{"delta":{"content":"module hosted"}}]}',
        "",
        'data: {"choices":[{"delta":{"content":"_cup() {}"}}]}',
        "",
        "data: [DONE]",
        ""
      ].join("\n")
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /^Generate$/i }).click();

  await expect(page.locator(".codeEditor").first()).toHaveValue(/hosted_cup/);
  expect(requestHeaders.authorization).not.toContain("sk-");
});

test("iterate again uses the editable correction prompt then renders a new model", async ({ page }) => {
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.llm-api-key", "sk-llm");
    localStorage.setItem("ai-openscad.vision-api-key", "sk-vision");
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        originalRequirement: "生成一个30ML的杯子模型",
        review: {
          summary: "杯口太厚",
          issues: ["杯壁需要更薄"],
          correctionPrompt: "保持30ML杯子容量，把杯壁调薄。",
          confidence: 0.82
        },
        promptTrace: []
      })
    );
  }, project);

  let llmRequests = 0;
  let iterationPrompt = "";
  let repairPrompt = "";
  await page.route("**/api/llm", async (route) => {
    llmRequests += 1;
    const body = route.request().postDataJSON() as {
      messages: Array<{ content: string }>;
    };
    if (llmRequests === 1) {
      iterationPrompt = body.messages[1].content;
    } else {
      repairPrompt = JSON.stringify(body.messages);
    }
    await delay(llmRequests === 1 ? 800 : 1_500);
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        llmRequests === 1
          ? sseChunks("cube(")
          : [
              'data: {"choices":[{"delta":{"content":"module revised() {"}}]}',
              "",
              'data: {"choices":[{"delta":{"content":" cylinder(h=40, r=16); } revised();"}}]}',
              "",
              "data: [DONE]",
              ""
            ].join("\n")
    });
  });

  await page.goto("/");
  await page.locator(".agentInput").fill("保持30ML杯子容量，把杯壁调薄，并把把手再大一点");
  await page.getByRole("button", { name: /Iterate Again/i }).click();

  await expect(page.locator('.workflowStage[data-stage="code"]')).toContainText("Active");
  await expect(page.locator('.workflowStage[data-stage="render"]')).toContainText("Waiting");
  await expect(page.locator('.workflowStage[data-stage="review"]')).toContainText("Waiting");
  await expect.poll(() => llmRequests, { timeout: 30_000 }).toBe(2);
  await expectCompilerRepairInFlight(page);
  expect(repairPrompt).toContain("cube(");
  expect(repairPrompt).toContain("OpenSCAD render failed");
  await expect(page.locator('.workflowStage[data-stage="render"]')).toContainText("Active", {
    timeout: 10000
  });
  await expect(page.getByRole("heading", { name: "Proposed Revision" })).toHaveCount(0);
  await expect(page.locator(".codeEditor").first()).toHaveValue(/revised/);
  await expect(page.locator(".chatCodeDisclosure")).toBeVisible();
  await expect(page.locator(".agentCodePreview")).toHaveCount(0);
  await expect(page.locator(".viewTile img")).toHaveCount(14, { timeout: 30000 });
  await expect(page.getByRole("button", { name: /Review/i })).toBeVisible();
  await expect(page.locator('.workflowStage[data-stage="review"]')).toContainText("Waiting");
  await expect(page.locator(".agentRun").getByText("Iteration started")).toBeVisible();
  await expect(
    page.locator(".agentRun").getByText("保持30ML杯子容量，把杯壁调薄，并把把手再大一点")
  ).toBeVisible();
  await expectTimelineOrder(page, [
    "User request",
    "Iteration started",
    "Generated OpenSCAD code",
    "Render started",
    "Render finished"
  ]);
  const storedAfterIteration = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("ai-openscad.project") ?? "{}")
  );
  expect(storedAfterIteration.runEvents).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        role: "user",
        title: "Iteration started",
        status: "complete",
        content: expect.stringContaining("把把手再大一点")
      }),
      expect.objectContaining({
        role: "assistant",
        title: "Generated OpenSCAD code",
        status: "complete",
        code: expect.stringContaining("revised")
      }),
      expect.objectContaining({
        role: "tool",
        title: "Render finished"
      })
    ])
  );
  expect(iterationPrompt).toContain("Original requirement:\n生成一个30ML的杯子模型");
  expect(iterationPrompt).toContain("Current OpenSCAD:");
  expect(iterationPrompt).toContain("module cup()");
  expect(iterationPrompt).toContain("杯口太厚");
  expect(iterationPrompt).toContain("杯壁需要更薄");
  expect(iterationPrompt).toContain("User iteration notes:\n保持30ML杯子容量，把杯壁调薄，并把把手再大一点");
  expect(iterationPrompt).toContain("browser render complexity budget");
  expect(iterationPrompt).toContain("coarse, inspectable approximations");
});

test("accepting a revision requires a fresh visual review before another iteration", async ({
  page
}) => {
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.llm-api-key", "sk-llm");
    localStorage.setItem("ai-openscad.vision-api-key", "sk-vision");
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        proposedCode: "cube(10);",
        review: {
          summary: "旧评审：杯口太厚",
          issues: ["旧问题"],
          correctionPrompt: "根据旧问题继续修正杯口厚度。",
          confidence: 0.74
        },
        promptTrace: []
      })
    );
  }, project);

  let llmRequests = 0;
  let repairPrompt = "";
  await page.route("**/api/llm", async (route) => {
    llmRequests += 1;
    const body = route.request().postDataJSON() as {
      messages: Array<{ content: unknown }>;
    };
    repairPrompt = JSON.stringify(body.messages);
    await delay(1_500);
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sseChunks("cube(10);")
    });
  });

  await page.goto("/");
  await expect(page.locator(".agentActions").getByRole("button", { name: /^Generate$/i })).toHaveCount(0);
  await expect(page.locator(".agentActions").getByRole("button", { name: /^Review$/i })).toHaveCount(0);
  await expect(page.locator(".agentActions").getByRole("button", { name: /Iterate Again/i })).toHaveCount(0);
  await expect(page.locator(".pendingActionHint")).toContainText("Accept");
  await page.getByRole("button", { name: /^Reject$/i }).click();
  await expect(page.getByRole("button", { name: /Iterate Again/i })).toBeVisible();

  await page.evaluate((storedProject) => {
    const pendingProject = {
      ...storedProject,
      proposedCode: "cube(",
      review: {
        summary: "旧评审：杯口太厚",
        issues: ["旧问题"],
        correctionPrompt: "根据旧问题继续修正杯口厚度。",
        confidence: 0.74
      },
      promptTrace: []
    };
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify(pendingProject)
    );
    localStorage.setItem("ai-openscad.projects", JSON.stringify([pendingProject]));
    localStorage.setItem("ai-openscad.active-project-id", pendingProject.id);
  }, project);
  await page.reload();
  await expect(page.locator(".pendingActionHint")).toContainText("Accept");
  await page.getByRole("button", { name: /Accept \+ render/i }).click();

  await expect.poll(() => llmRequests, { timeout: 30_000 }).toBe(1);
  await expectCompilerRepairInFlight(page);
  expect(repairPrompt).toContain("cube(");
  expect(repairPrompt).toContain("OpenSCAD render failed");
  await expect(page.getByRole("button", { name: /^Review$/i })).toBeVisible({
    timeout: 45000
  });
  await expect(page.locator(".viewTile img")).toHaveCount(14);
  await expect(page.getByRole("button", { name: /Iterate Again/i })).toHaveCount(0);
  await expect(page.locator(".resultPanel").getByText("No review yet.")).toHaveCount(0);
  await expect(page.locator(".agentRun")).not.toContainText("旧评审：杯口太厚");
  await expect(page.locator(".agentRun")).not.toContainText("旧问题");
  await expect(page.locator(".agentRun")).not.toContainText("根据旧问题继续修正杯口厚度。");
  await expect(page.locator(".agentInput")).not.toHaveValue(/根据旧问题继续修正杯口厚度/);
  await expect(page.locator('.workflowStage[data-stage="review"]')).toContainText("Waiting");
});

test("pending revision without review still blocks the main workflow", async ({ page }) => {
  await page.addInitScript((storedProject) => {
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        proposedCode: "cube(10);",
        review: null,
        promptTrace: []
      })
    );
  }, project);

  await page.goto("/");

  await expect(page.locator(".pendingActionHint")).toContainText("Accept");
  await expect(page.locator(".agentActions").getByRole("button", { name: /^Generate$/i })).toHaveCount(0);
  await expect(page.locator(".agentActions").getByRole("button", { name: /^Review$/i })).toHaveCount(0);
  await expect(page.locator(".agentActions").getByRole("button", { name: /Iterate Again/i })).toHaveCount(0);
});

test("invalid OpenSCAD render fails without leaving the page busy", async ({ page }) => {
  await page.addInitScript((storedProject) => {
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        currentCode: "cube(",
        stl: "solid previous\nendsolid previous",
        review: null,
        promptTrace: []
      })
    );
  }, project);

  await page.goto("/");
  await page.getByRole("button", { name: /Rerender/i }).click();

  await expect(page.locator(".agentRun").getByRole("alert")).toBeVisible({
    timeout: 30000
  });
  await expect(page.locator('.workflowStage[data-stage="render"]')).toContainText("Error");
  await expect(page.locator(".controlPanel .status")).toHaveCount(0);
  await expect(page.locator(".controlPanel").getByRole("button", { name: "New model" })).toBeEnabled();
});

test("render timeout explains the draft complexity budget and keeps code editable", async ({
  page
}) => {
  await page.addInitScript((storedProject) => {
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
      nativeSetTimeout(handler, typeof timeout === "number" && timeout >= 45_000 ? 5 : timeout, ...args)) as typeof window.setTimeout;
    Object.defineProperty(window, "Worker", {
      configurable: true,
      value: class {
        addEventListener() {}
        removeEventListener() {}
        postMessage() {}
        terminate() {}
      }
    });
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        currentCode: "cube(10);",
        stl: "",
        views: { front: "", back: "", left: "", right: "", top: "", isometric: "" },
        review: null,
        promptTrace: []
      })
    );
  }, project);

  await page.goto("/");
  await page.getByRole("button", { name: /Rerender/i }).click();

  await expect(page.locator(".agentRun").getByRole("alert")).toContainText(
    "browser draft render complexity budget",
    { timeout: 30000 }
  );
  await expect(page.locator('.workflowStage[data-stage="render"]')).toContainText("Error");
  await expect(page.locator(".codeEditor").first()).toHaveValue(/cube\(10\);/);
  await expect(page.getByRole("button", { name: /Rerender/i })).toBeEnabled();
  await expect(page.locator(".resultPanel")).not.toContainText("browser draft render complexity budget");
});

test("final export timeout keeps final guidance separate from draft budget", async ({
  page
}) => {
  await page.addInitScript((storedProject) => {
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
      nativeSetTimeout(handler, typeof timeout === "number" && timeout >= 45_000 ? 5 : timeout, ...args)) as typeof window.setTimeout;
    Object.defineProperty(window, "Worker", {
      configurable: true,
      value: class {
        addEventListener() {}
        removeEventListener() {}
        postMessage() {}
        terminate() {}
      }
    });
    localStorage.setItem("ai-openscad.vision-api-key", "sk-vision");
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        currentCode: "cube(10);",
        review: null,
        renderEvidence: {
          compileStatus: "success",
          diagnostics: "Compiled draft preview.",
          renderPrecision: "draft",
          backend: "web-manifold",
          viewCount: 14
        },
        promptTrace: []
      })
    );
  }, project);

  page.on("dialog", (dialog) => dialog.accept());

  let reviewPrompt = "";
  await page.route("**/api/vision", async (route) => {
    const body = route.request().postDataJSON() as {
      messages: Array<{ content: unknown }>;
    };
    reviewPrompt = JSON.stringify(body.messages[1].content);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        content: JSON.stringify({
          summary: "Draft preview is still reviewable.",
          issues: ["No final export evidence should be mixed into draft review."],
          correctionPrompt: "Keep reviewing the draft preview evidence.",
          confidence: 0.7
        })
      })
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Final Export/i }).click();

  await expect(page.locator(".agentRun").getByRole("alert")).toContainText(
    "high precision final export timed out",
    { timeout: 30000 }
  );
  await expect(page.locator(".agentRun").getByRole("alert")).not.toContainText(
    "browser draft render complexity budget"
  );
  await expect(page.locator('.workflowStage[data-stage="render"]')).toContainText("Error");
  await expect(page.locator(".codeEditor").first()).toHaveValue(/cube\(10\);/);
  await expect(page.getByRole("button", { name: /Final Export/i })).toBeEnabled();
  await expect(page.getByRole("button", { name: /Rerender/i })).toBeEnabled();
  await expect(page.locator(".resultPanel")).not.toContainText("high precision final export timed out");

  await page.getByRole("button", { name: /^Review$/i }).click();
  await expect(page.locator(".agentRun").getByText("Vision review complete.")).toBeVisible();
  expect(reviewPrompt).toContain("compileStatus: success");
  expect(reviewPrompt).toContain("diagnostics: Compiled draft preview.");
  expect(reviewPrompt).toContain("renderPrecision: draft");
  expect(reviewPrompt).toContain("backend: web-manifold");
  expect(reviewPrompt).toContain("viewCount: 14");
  expect(reviewPrompt).not.toContain("high precision final export timed out");
  expect(reviewPrompt).not.toContain("renderPrecision: final");
});

test("final export blocks unsafe diagnostics even when STL is produced", async ({
  page
}, testInfo) => {
  test.setTimeout(75_000);
  await page.addInitScript((storedProject) => {
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        currentCode: "cube(10); translate([20, 0, 0]) sphere(r = missing * 2);",
        stl: "solid previous\nendsolid previous",
        views: {
          ...storedProject.views
        },
        review: null,
        renderEvidence: {
          compileStatus: "success",
          diagnostics: "Compiled draft preview.",
          renderPrecision: "draft",
          backend: "web-manifold",
          viewCount: 14
        },
        promptTrace: []
      })
    );
    (window as typeof window & { __downloadNames?: string[] }).__downloadNames = [];
    HTMLAnchorElement.prototype.click = function captureDownloadName() {
      (window as typeof window & { __downloadNames: string[] }).__downloadNames.push(
        this.download
      );
    };
  }, project);
  page.on("dialog", (dialog) => dialog.accept());

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Final Export/i })).toBeVisible();
  await page.getByRole("button", { name: /Final Export/i }).click();

  await expect(page.locator(".agentRun").getByRole("alert")).toContainText(
    /undefined operation|unsafe/i,
    { timeout: 45_000 }
  );
  await expect(page.locator(".agentRun").getByRole("alert")).toContainText(
    /Top level object is a 3D object|Genus|Facets/i
  );
  await expect(page.locator('.workflowStage[data-stage="render"]')).toContainText("Error");
  await expect(page.getByRole("button", { name: /Final Export/i })).toBeEnabled();
  await page.locator(".workspace").screenshot({
    path: testInfo.outputPath("unsafe-final-export-error.png")
  });
  const downloadNames = await page.evaluate(
    () => (window as typeof window & { __downloadNames: string[] }).__downloadNames
  );
  expect(downloadNames).not.toContain("ai-openscad-final.scad");
  expect(downloadNames).not.toContain("ai-openscad-final.stl");
});

test("rerender remains available after code exists without rendered views", async ({ page }) => {
  await page.addInitScript((storedProject) => {
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        currentCode: "cube(",
        stl: "",
        views: { front: "", back: "", left: "", right: "", top: "", isometric: "" },
        review: null,
        promptTrace: []
      })
    );
  }, project);

  await page.goto("/");
  await page.getByRole("button", { name: /Rerender/i }).click();

  await expect(page.locator(".agentRun").getByRole("alert")).toBeVisible({
    timeout: 30000
  });
  await expect(page.locator('.workflowStage[data-stage="render"]')).toContainText("Error");
  await page.locator(".controlPanel").getByRole("button", { name: "New model" }).click();
  await expect(page.locator('.workflowStage[data-stage="render"]')).not.toContainText("Error");
});
