import { expect, test } from "@playwright/test";

const project = {
  id: "project-i18n-test",
  title: "I18n Test",
  requirement: "",
  codeModelId: "mimo-v2.5",
  visionModelId: "mimo-v2.5",
  currentCode: "",
  proposedCode: "",
  compilerOutput: "",
  review: null,
  views: { front: "", top: "", right: "" },
  iterations: [],
  promptTrace: [],
  updatedAt: "2026-06-26T00:00:00.000Z"
};

async function seedProject(page: import("@playwright/test").Page) {
  await page.addInitScript((storedProject) => {
    localStorage.setItem("ai-openscad.project", JSON.stringify(storedProject));
  }, project);
}

test.describe("browser locale", () => {
  test.describe("English", () => {
    test.use({ locale: "en-US" });

    test("shows English UI for non-Chinese browsers", async ({ page }) => {
      await seedProject(page);
      await page.goto("/");

      await expect(page.getByText("Text to code to model to visual review.")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Agent Run" })).toBeVisible();
      await expect(page.getByText("Tell the agent what to build")).toBeVisible();
      await expect(page.getByText("Vision Model")).toBeVisible();
      await expect(page.getByRole("button", { name: /^Generate$/ })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Agent Thinking" })).toHaveCount(0);
      await expect(page.getByText("Generate, compile, or review to see prompts here.")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "No key?" }).first()).toBeVisible();
    });
  });

  test.describe("Chinese", () => {
    test.use({ locale: "zh-CN" });

    test("shows Chinese UI for Chinese browsers", async ({ page }) => {
      await seedProject(page);
      await page.goto("/");

      await expect(page.getByText("文本生成代码，代码生成模型，再用视觉评审迭代。")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Agent 运行" })).toBeVisible();
      await expect(page.getByText("告诉 Agent 要做什么")).toBeVisible();
      await expect(page.getByText("图像识别模型")).toBeVisible();
      await expect(page.getByRole("button", { name: /^生成$/ })).toBeVisible();
      await expect(page.getByRole("heading", { name: "AI 思考" })).toHaveCount(0);
      await expect(page.getByText("生成、编译或评审后会在这里显示提示词。")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "没有 Key？" }).first()).toBeVisible();
    });
  });
});
