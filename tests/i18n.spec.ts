import { expect, test } from "@playwright/test";

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
const emptyViews = Object.fromEntries(viewKeys.map((key) => [key, ""]));

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
  views: emptyViews,
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

    test("shows Chinese UI for Chinese browsers", async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 920 });
      await seedProject(page);
      await page.goto("/");

      await expect(page.getByText("文本生成代码，代码生成模型，再用视觉评审迭代。")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Agent 运行" })).toBeVisible();
      await expect(page.getByText("告诉 Agent 要做什么")).toBeVisible();
      await expect(page.getByText("图像识别模型")).toBeVisible();
      const referenceButton = page.getByRole("button", { name: /^参考图片$/ });
      const optimizeButton = page.getByRole("button", { name: /^优化提示词$/ });
      const generateButton = page.getByRole("button", { name: /^生成$/ });
      await expect(generateButton).toBeVisible();
      await expect(referenceButton).toBeVisible();
      await expect(optimizeButton).toBeVisible();
      await expect(page.locator(".agentComposer").getByText("参考图片", { exact: true })).toHaveCount(1);
      await expect(page.locator(".agentComposer").getByText("优化提示词", { exact: true })).toHaveCount(1);
      const referenceBox = await referenceButton.boundingBox();
      const optimizeBox = await optimizeButton.boundingBox();
      const generateBox = await generateButton.boundingBox();
      expect(referenceBox).not.toBeNull();
      expect(optimizeBox).not.toBeNull();
      expect(generateBox).not.toBeNull();
      expect(referenceBox!.x).toBeLessThan(optimizeBox!.x);
      expect(optimizeBox!.x).toBeLessThan(generateBox!.x);
      expect(Math.abs(referenceBox!.y - generateBox!.y)).toBeLessThanOrEqual(2);
      expect(Math.abs(referenceBox!.y - optimizeBox!.y)).toBeLessThanOrEqual(2);
      const pageWidth = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth
      }));
      expect(pageWidth.scrollWidth).toBeLessThanOrEqual(pageWidth.clientWidth);
      await page.locator(".agentComposer").screenshot({
        path: testInfo.outputPath("chinese-prompt-actions-narrow.png")
      });
      await expect(page.getByRole("heading", { name: "AI 思考" })).toHaveCount(0);
      await expect(page.getByText("生成、编译或评审后会在这里显示提示词。")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "没有 Key？" }).first()).toBeVisible();
    });
  });
});
