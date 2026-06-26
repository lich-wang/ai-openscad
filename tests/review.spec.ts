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

test("review sends MiMo multimodal model and shows proposed revision", async ({
  page
}) => {
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.llm-api-key", "sk-llm");
    localStorage.setItem("ai-openscad.vision-api-key", "sk-vision");
    localStorage.setItem("ai-openscad.project", JSON.stringify(storedProject));
  }, project);

  let visionModel = "";
  let llmStream = false;

  await page.route("**/api/vision", async (route) => {
    const body = route.request().postDataJSON() as {
      model: string;
      messages: Array<{ content: unknown }>;
    };
    visionModel = body.model;
    expect(JSON.stringify(body.messages[1].content)).toContain("image_url");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        content: JSON.stringify({
          summary: "杯子主体正确，但杯口需要更圆滑。",
          issues: ["杯口倒角不明显"],
          confidence: 0.86
        })
      })
    });
  });

  await page.route("**/api/llm", async (route) => {
    const body = route.request().postDataJSON() as { stream?: boolean };
    llmStream = body.stream === true;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        'data: {"choices":[{"delta":{"content":"module cup() {"}}]}',
        "",
        'data: {"choices":[{"delta":{"content":" cylinder(h=40, r=18); } cup();"}}]}',
        "",
        "data: [DONE]",
        ""
      ].join("\n")
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /review/i }).click();

  await expect(page.getByText("Proposed Revision")).toBeVisible();
  await expect(page.locator(".resultPanel").getByText("杯子主体正确", { exact: false })).toBeVisible();
  expect(visionModel).toBe("mimo-v2.5");
  expect(llmStream).toBe(true);
});

test("generation requests streaming output and fills the editor", async ({ page }) => {
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
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        'data: {"choices":[{"delta":{"content":"module streamed"}}]}',
        "",
        'data: {"choices":[{"delta":{"content":"_cup() {}"}}]}',
        "",
        "data: [DONE]",
        ""
      ].join("\n")
    });
  });

  await page.goto("/");
  const requestPromise = page.waitForRequest("**/api/llm");
  await page.getByRole("button", { name: /^Generate$/i }).click();
  await requestPromise;

  await expect(page.locator(".codeEditor").first()).toHaveValue(/streamed_cup/);
  expect(streamRequested).toBe(true);
});

test("iterate again combines review feedback and user notes", async ({ page }) => {
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
  await page.locator(".iterationInput").fill("把把手再大一点");
  await page.getByRole("button", { name: /Iterate Again/i }).click();

  await expect(page.getByText("Proposed Revision")).toBeVisible();
  await expect(page.locator(".codeEditor.proposed")).toHaveValue(/revised/);
  expect(prompt).toContain("杯口太厚");
  expect(prompt).toContain("杯壁需要更薄");
  expect(prompt).toContain("把把手再大一点");
});
