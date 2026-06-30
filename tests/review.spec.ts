import { expect, test, type Page } from "@playwright/test";

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
  await page.locator('input[type="file"]').setInputFiles({
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
