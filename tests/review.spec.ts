import { expect, test } from "@playwright/test";

const project = {
  id: "project-review-test",
  title: "Review Test",
  requirement: "生成一个30ML的杯子模型",
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
  updatedAt: "2026-06-26T00:00:00.000Z"
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test("review sends MiMo multimodal model and shows editable correction prompt", async ({
  page
}) => {
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.llm-api-key", "sk-llm");
    localStorage.setItem("ai-openscad.vision-api-key", "sk-vision");
    localStorage.setItem("ai-openscad.project", JSON.stringify(storedProject));
  }, project);

  let visionModel = "";
  let llmRequests = 0;

  await page.route("**/api/vision", async (route) => {
    const body = route.request().postDataJSON() as {
      model: string;
      messages: Array<{ content: unknown }>;
    };
    visionModel = body.model;
    expect(JSON.stringify(body.messages[1].content)).toContain("image_url");
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
        views: { front: "", top: "", right: "" },
        review: null,
        promptTrace: []
      })
    );

  }, project);

  let streamRequested = false;
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

  await page.goto("/");
  const requestPromise = page.waitForRequest("**/api/llm");
  const generateButton = page.getByRole("button", { name: /^Generate$/i });
  await generateButton.click();
  await expect(generateButton).toBeDisabled();
  await expect(page.locator('.workflowStage[data-stage="code"]')).toContainText("Active");
  await requestPromise;

  await expect(page.locator(".codeEditor").first()).toHaveValue(/cube\(10\);/);
  await expect(page.locator(".agentCodePreview")).toContainText("cube(10);");
  await expect(page.locator('.workflowStage[data-stage="render"]')).toContainText("Active", {
    timeout: 10000
  });
  await expect(page.locator(".agentRun").getByText("Preparing draft render...")).toBeVisible({
    timeout: 10000
  });
  await expect(page.locator(".viewTile img")).toHaveCount(3, { timeout: 30000 });
  await expect(page.getByRole("button", { name: /STL/i })).toBeVisible();
  await expect(page.locator(".agentRun").getByText("Draft precision was used for fast review.")).toBeVisible({
    timeout: 30000
  });
  await expect(page.locator('.workflowStage[data-stage="render"]')).toContainText("Complete");
  expect(streamRequested).toBe(true);
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

  await expect(page.getByRole("heading", { name: "Proposed Revision" })).toHaveCount(0);
  await expect(page.locator(".codeEditor").first()).toHaveValue(/revised/);
  await expect(page.locator(".agentCodePreview")).toContainText("revised");
  await expect(page.locator(".viewTile img")).toHaveCount(3, { timeout: 30000 });
  await expect(page.getByRole("button", { name: /Review/i })).toBeVisible();
  expect(prompt).toContain("杯口太厚");
  expect(prompt).toContain("杯壁需要更薄");
  expect(prompt).toContain("保持30ML杯子容量");
  expect(prompt).toContain("把把手再大一点");
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
