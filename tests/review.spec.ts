import { expect, test, type Page } from "@playwright/test";

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
    front:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP8z8AARQAFAAH/AnH9zAAAAABJRU5ErkJggg==",
    top:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP8z8AARQAFAAH/AnH9zAAAAABJRU5ErkJggg==",
    right:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP8z8AARQAFAAH/AnH9zAAAAABJRU5ErkJggg=="
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

  expect(paintedPixelCounts).toHaveLength(3);
  for (const count of paintedPixelCounts) {
    expect(count).toBeGreaterThan(2);
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
    expect(userMessage).toContain("image_url");
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
        views: { front: "", top: "", right: "" },
        review: null,
        promptTrace: []
      })
    );

  }, project);

  let streamRequested = false;
  let reviewRequirement = "";
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
  await expect(page.locator(".viewTile img")).toHaveCount(3, { timeout: 30000 });
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
  expect(storedAfterFirstReview.originalRequirement).toBe("生成一个30ML的杯子模型");
  expect(storedAfterFirstReview.requirement).toContain("增加杯口倒角");
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
        views: { front: "", top: "", right: "" },
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
  await expect(page.locator(".viewTile img")).toHaveCount(3, { timeout: 45000 });
  await expectRenderedViewsHaveModelPixels(page);
  await expect(page.locator('.workflowStage[data-stage="render"]')).toContainText("Complete");
  expect(prompt).toContain("browser render complexity budget");
  expect(prompt).toContain("wavy surfaces");
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
        views: { front: "", top: "", right: "" },
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

  let prompt = "";
  await page.route("**/api/llm", async (route) => {
    const body = route.request().postDataJSON() as {
      messages: Array<{ content: string }>;
    };
    prompt = body.messages[1].content;
    await delay(800);
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
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
  await expect(page.locator('.workflowStage[data-stage="render"]')).toContainText("Active", {
    timeout: 10000
  });
  await expect(page.getByRole("heading", { name: "Proposed Revision" })).toHaveCount(0);
  await expect(page.locator(".codeEditor").first()).toHaveValue(/revised/);
  await expect(page.locator(".chatCodeDisclosure")).toBeVisible();
  await expect(page.locator(".agentCodePreview")).toHaveCount(0);
  await expect(page.locator(".viewTile img")).toHaveCount(3, { timeout: 30000 });
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
  expect(prompt).toContain("Original requirement:\n生成一个30ML的杯子模型");
  expect(prompt).toContain("Current OpenSCAD:");
  expect(prompt).toContain("module cup()");
  expect(prompt).toContain("杯口太厚");
  expect(prompt).toContain("杯壁需要更薄");
  expect(prompt).toContain("User iteration notes:\n保持30ML杯子容量，把杯壁调薄，并把把手再大一点");
  expect(prompt).toContain("browser render complexity budget");
  expect(prompt).toContain("coarse, inspectable approximations");
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
      proposedCode: "cube(10);",
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

  await expect(page.getByRole("button", { name: /^Review$/i })).toBeVisible({
    timeout: 45000
  });
  await expect(page.locator(".viewTile img")).toHaveCount(3);
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
        views: { front: "", top: "", right: "" },
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
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        currentCode: "cube(10);",
        review: null,
        promptTrace: []
      })
    );
  }, project);

  page.on("dialog", (dialog) => dialog.accept());

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
});

test("rerender remains available after code exists without rendered views", async ({ page }) => {
  await page.addInitScript((storedProject) => {
    localStorage.setItem(
      "ai-openscad.project",
      JSON.stringify({
        ...storedProject,
        currentCode: "cube(",
        stl: "",
        views: { front: "", top: "", right: "" },
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
