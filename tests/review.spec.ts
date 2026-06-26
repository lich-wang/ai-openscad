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
    localStorage.setItem("ai-openscad.api-key", "sk-test");
    localStorage.setItem("ai-openscad.project", JSON.stringify(storedProject));
  }, project);

  let visionModel = "";

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
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        content:
          "module cup() { difference() { cylinder(h=40, r=18, $fn=96); cylinder(h=38, r=15, $fn=96); } } cup();"
      })
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /review/i }).click();

  await expect(page.getByText("Proposed Revision")).toBeVisible();
  await expect(page.locator(".resultPanel").getByText("杯子主体正确", { exact: false })).toBeVisible();
  expect(visionModel).toBe("mimo-v2.5");
});
