export type UserLanguage = "zh" | "en";

export function detectUserLanguage(text: string): UserLanguage {
  return /[\u3400-\u9fff]/.test(text) ? "zh" : "en";
}

export function buildLanguageInstruction(text: string): string {
  if (detectUserLanguage(text) === "zh") {
    return "Language skill: 用户输入是中文。所有自然语言反馈、评审总结、问题列表和 OpenSCAD 注释都要使用中文；OpenSCAD 语法本身保持合法。";
  }
  return "Language skill: The user wrote in English. Use English for natural-language feedback and OpenSCAD comments.";
}
